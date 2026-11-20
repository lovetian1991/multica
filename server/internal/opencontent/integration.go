package opencontent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// InBiz model payloads use a different key and padding from API-key authentication.
const modelPayloadPublicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA15Udev90rWa4k5QT8qONJy48xeknAh/PLe9y7fWXTL6TJWpsCWP+OCBwcEAvOfgXWRsJRtHkuanz1Y9JktwcNGXQrvZSxUy4aParyiYgGZd4HsZrlbR29eEj32TkAQ2svjOjs0UlEDbQKKpw0pC0QOcgz7NZTkAwNm8xJGwqa4moqj4Izlo0UaeJVkaJhUAdgpmrtvq9Kq1ooo2RQ40pVOkGoCw8rpnq8hRxLbdacHsuvR/eE1InHu6M2tL9bUva9Cs0AHLWlNhaVgw75ymDzw8g8lzK82GSuFvWERbde9Tzae3m+JWOTEQU7atigXMJvJU7U6nnRgal0Xsk21BCOwIDAQAB
-----END PUBLIC KEY-----`

func (c *Client) integrationRequest(ctx context.Context, baseURL, path string, body []byte, headers http.Header) ([]byte, error) {
	if c == nil || c.timeoutClient == nil {
		return nil, ErrDisabled
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid OC environment URL")
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("failed to create OC request")
	}
	req.Header = headers.Clone()
	client := *c.timeoutClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("OC request failed; check environment URL and network")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OC returned HTTP %d; check account, permissions and integration settings", resp.StatusCode)
	}
	limit := c.maxResponseBytes
	if limit <= 0 {
		limit = defaultMaxResponseBytes
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, errors.New("invalid or oversized OC response")
	}
	return raw, nil
}

func (c *Client) LoginByAccount(ctx context.Context, baseURL, integrationKey, account string) (string, error) {
	if strings.TrimSpace(integrationKey) == "" || strings.TrimSpace(account) == "" {
		return "", errors.New("OC integration key and workspace account are required")
	}
	body, _ := json.Marshal(map[string]any{
		"loginName": account, "integrationKey": integrationKey, "clientType": 0,
	})
	raw, err := c.integrationRequest(ctx, baseURL,
		"/flatsdk/api/services/Auth/UserLoginIntegrationByUserLoginName", body,
		http.Header{"Content-Type": {"application/json"}})
	if err != nil {
		return "", err
	}
	var out struct {
		Result *int   `json:"result"`
		Data   string `json:"data"`
	}
	if json.Unmarshal(raw, &out) != nil || out.Result == nil || *out.Result != 0 ||
		len(out.Data) != 36 || strings.ContainsAny(out.Data, "\r\n\x00") {
		// Upstream errors may echo credentials, so never return the raw body.
		return "", errors.New("OC integration login failed; check workspace account and system integration key")
	}
	return out.Data, nil
}

func encryptModelPayload(payload []byte, token, publicKey string) ([]byte, error) {
	block, _ := pem.Decode([]byte(publicKey))
	if block == nil {
		return nil, errors.New("invalid InBiz model public key")
	}
	key, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, errors.New("invalid InBiz model public key")
	}
	rsaKey, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("InBiz model public key must be RSA")
	}
	// ApiSecurity verifies the final 36 bytes against the token request header.
	plain := append(append([]byte(nil), payload...), []byte(token)...)
	encrypted, err := rsa.EncryptPKCS1v15(rand.Reader, rsaKey, plain)
	if err != nil {
		return nil, errors.New("failed to encrypt InBiz model request")
	}
	return []byte(base64.StdEncoding.EncodeToString(encrypted)), nil
}

func (c *Client) GetWorkOrderDetail(ctx context.Context, baseURL, token, appID, siteOutID, id string) (map[string]json.RawMessage, error) {
	if appID == "" || id == "" || len(token) != 36 {
		return nil, errors.New("OC work order appid, token and id are required")
	}
	payload, _ := json.Marshal(map[string]string{"modelName": "workorder", "id": id})
	body, err := encryptModelPayload(payload, token, modelPayloadPublicKey)
	if err != nil {
		return nil, err
	}
	raw, err := c.integrationRequest(ctx, baseURL, "/inbiz/api/services/modelengine/v3/business/selectData", body,
		http.Header{"Content-Type": {"text/plain;charset=UTF-8"}, "Token": {token}, "Appid": {appID}, "Siteoutid": {siteOutID}})
	if err != nil {
		return nil, err
	}
	var detail map[string]json.RawMessage
	var returnedID string
	if json.Unmarshal(raw, &detail) != nil || json.Unmarshal(detail["id"], &returnedID) != nil || returnedID != id {
		return nil, errors.New("OC detail response does not match the requested work order")
	}
	return detail, nil
}
