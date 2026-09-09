package opencontent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
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

type Operation string

const (
	OperationAuthPublicKey  Operation = "auth-public-key"
	OperationFileList       Operation = "file-list"
	OperationFileInfo       Operation = "file-info"
	OperationFolderInfo     Operation = "folder-info"
	OperationFolderTree     Operation = "folder-tree"
	OperationCreateFolder   Operation = "create-folder"
	OperationUserInfo       Operation = "user-info"
	OperationPersonalFolder Operation = "personal-folder"
	OperationUploadCheck    Operation = "upload-check"
	OperationUpload         Operation = "upload"
	OperationUploadMulti    Operation = "upload-multi"
	OperationDownloadCheck  Operation = "download-check"
	OperationDownloadStatus Operation = "download-status"
	OperationDownload       Operation = "download"
)

type upstreamRoute struct {
	method string
	path   string
}

var routes = map[Operation]upstreamRoute{
	OperationAuthPublicKey:  {method: http.MethodGet, path: "/inbiz/auth/api/Auth/GetLoginRsaPublicKey"},
	OperationFileList:       {method: http.MethodPost, path: "/FlatDms/v800/Document/DocList/GetFolderChildren"},
	OperationFileInfo:       {method: http.MethodGet, path: "/flatsdk/api/services/DocList/GetFileByIdOrGuid"},
	OperationFolderInfo:     {method: http.MethodPost, path: "/flatsdk/api/services/DocList/GetFolderByGuidOrId"},
	OperationFolderTree:     {method: http.MethodPost, path: "/FlatDms/v800/Document/FolderTree/GetChildrenFolderTreeNodes"},
	OperationCreateFolder:   {method: http.MethodPost, path: "/flatsdk/api/services/TemplateCreate/CreateFolder"},
	OperationUserInfo:       {method: http.MethodPost, path: "/flatsdk/api/services/User/GetUserInfoByToken"},
	OperationPersonalFolder: {method: http.MethodPost, path: "/flatsdk/api/services/User/GetTopPersonalFolderId"},
	OperationUploadCheck:    {method: http.MethodPost, path: "/FlatDms/V800/Transport/Upload/CheckAndCreateDocInfo"},
	OperationUpload:         {method: http.MethodPost, path: "/document/upload"},
	OperationUploadMulti:    {method: http.MethodPost, path: "/document/uploadMultiTd"},
	OperationDownloadCheck:  {method: http.MethodPost, path: "/FlatDms/V800/Transport/Download/DownloadCheck"},
	OperationDownloadStatus: {method: http.MethodPost, path: "/FlatDms/V800/Transport/Download/GetFormatConvertStatus"},
	OperationDownload:       {method: http.MethodGet, path: "/downLoad/index"},
}

var (
	ErrDisabled         = errors.New("OpenContent is not configured")
	ErrUnknownOperation = errors.New("unsupported OpenContent operation")
	ErrCredentialQuery  = errors.New("OpenContent credentials must be sent as a Bearer header")
	ErrResponseTooLarge = errors.New("OpenContent response exceeds configured limit")
)

type Client struct {
	baseURL           string
	timeoutClient     *http.Client
	maxResponseBytes  int64
	maxUploadBytes    int64
	allowedExtensions []string
}

func NewClient(cfg Config) (*Client, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		timeout := cfg.Timeout
		if timeout <= 0 {
			timeout = defaultTimeout
		}
		maxResponseBytes := cfg.MaxResponseBytes
		if maxResponseBytes <= 0 {
			maxResponseBytes = defaultMaxResponseBytes
		}
		return &Client{
			timeoutClient:    &http.Client{Timeout: timeout},
			maxResponseBytes: maxResponseBytes,
		}, nil
	}
	return &Client{
		baseURL:           strings.TrimRight(cfg.BaseURL, "/"),
		timeoutClient:     &http.Client{Timeout: cfg.Timeout},
		maxResponseBytes:  cfg.MaxResponseBytes,
		maxUploadBytes:    cfg.MaxUploadBytes,
		allowedExtensions: append([]string(nil), cfg.AllowedExtensions...),
	}, nil
}

func (c *Client) Enabled() bool { return c != nil && c.baseURL != "" }

func (c *Client) MaxUploadBytes() int64 {
	if c == nil || c.maxUploadBytes <= 0 {
		return 0
	}
	return c.maxUploadBytes
}

func (c *Client) AllowedExtensions() []string {
	if c == nil {
		return nil
	}
	return append([]string(nil), c.allowedExtensions...)
}

func (c *Client) ValidateUpload(body []byte, contentType string) error {
	if c == nil || c.maxUploadBytes <= 0 {
		return fmt.Errorf("OpenContent upload is not configured")
	}
	return ValidateMultipartUpload(body, contentType, c.maxUploadBytes, c.allowedExtensions)
}

func (c *Client) ValidateUploadCheck(body []byte) error {
	if c == nil || c.maxUploadBytes <= 0 {
		return fmt.Errorf("OpenContent upload is not configured")
	}
	return ValidateUploadCheck(body, c.maxUploadBytes, c.allowedExtensions)
}

func (c *Client) MethodFor(operation Operation) (string, bool) {
	route, ok := routes[operation]
	if !ok {
		return "", false
	}
	return route.method, true
}

func (c *Client) Do(ctx context.Context, operation Operation, body []byte, query url.Values, headers http.Header) (*http.Response, error) {
	if !c.Enabled() {
		return nil, ErrDisabled
	}
	route, ok := routes[operation]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownOperation, operation)
	}
	cleanQuery, err := sanitizeQuery(query)
	if err != nil {
		return nil, err
	}
	// 下载操作不限制响应大小
	skipResponseLimit := operation == OperationDownload
	return c.do(ctx, route, body, cleanQuery, headers, skipResponseLimit, c.baseURL)
}

// DoWithSettings calls the upstream API using a dynamic base URL. OpenContent
// requires the integration key to be RSA-encrypted with its current public key
// before it is sent as a Bearer credential.
func (c *Client) DoWithSettings(ctx context.Context, operation Operation, body []byte, query url.Values, baseURL, integrationKey string) (*http.Response, error) {
	if c == nil || c.timeoutClient == nil {
		return nil, ErrDisabled
	}
	route, ok := routes[operation]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownOperation, operation)
	}
	cleanQuery, err := sanitizeQuery(query)
	if err != nil {
		return nil, err
	}
	authorization, err := c.settingsAuthorization(ctx, baseURL, integrationKey)
	if err != nil {
		return nil, err
	}
	headers := http.Header{}
	headers.Set("Authorization", authorization)
	skipResponseLimit := false
	return c.do(ctx, route, body, cleanQuery, headers, skipResponseLimit, baseURL)
}

type authPublicKeyResponse struct {
	Data struct {
		PublicKey string `json:"PublicKey"`
		Algorithm string `json:"Algorithm"`
		Padding   string `json:"Padding"`
	} `json:"data"`
}

func (c *Client) settingsAuthorization(ctx context.Context, baseURL, integrationKey string) (string, error) {
	publicKeyRoute := routes[OperationAuthPublicKey]
	resp, err := c.do(ctx, publicKeyRoute, nil, nil, nil, false, baseURL)
	if err != nil {
		return "", fmt.Errorf("fetch OpenContent auth public key: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("OpenContent auth public key returned HTTP %d", resp.StatusCode)
	}
	var payload authPublicKeyResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode OpenContent auth public key: %w", err)
	}
	if strings.TrimSpace(payload.Data.PublicKey) == "" {
		return "", errors.New("OpenContent auth public key response is missing data.PublicKey")
	}
	block, _ := pem.Decode([]byte(payload.Data.PublicKey))
	if block == nil {
		return "", errors.New("OpenContent auth public key is not PEM encoded")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parse OpenContent auth public key: %w", err)
	}
	publicKey, ok := parsed.(*rsa.PublicKey)
	if !ok {
		return "", fmt.Errorf("OpenContent auth public key is %T, want RSA", parsed)
	}
	ciphertext, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, publicKey, []byte(integrationKey), nil)
	if err != nil {
		return "", fmt.Errorf("encrypt OpenContent API key: %w", err)
	}
	return "Bearer " + base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (c *Client) do(ctx context.Context, route upstreamRoute, body []byte, query url.Values, headers http.Header, skipResponseLimit bool, baseURL string) (*http.Response, error) {
	base, err := url.Parse(baseURL)
	if err != nil || base.Host == "" || base.Scheme != "http" && base.Scheme != "https" {
		return nil, fmt.Errorf("invalid OpenContent URL")
	}
	u := *base
	u.Path = strings.TrimRight(base.Path, "/") + route.path
	u.RawQuery = cloneValues(query).Encode()

	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, route.method, u.String(), reader)
	if err != nil {
		return nil, err
	}
	for key, values := range headers {
		if !forwardableHeader(key) {
			continue
		}
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	if len(body) > 0 && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.timeoutClient.Do(req)
	if err != nil {
		return nil, err
	}
	// 下载操作不限制响应大小
	if skipResponseLimit {
		return resp, nil
	}
	if resp.ContentLength > c.maxResponseBytes {
		resp.Body.Close()
		return nil, ErrResponseTooLarge
	}
	resp.Body = &limitedReadCloser{
		reader: io.LimitReader(resp.Body, c.maxResponseBytes+1),
		closer: resp.Body,
		limit:  c.maxResponseBytes,
	}
	return resp, nil
}

type limitedReadCloser struct {
	reader   io.Reader
	closer   io.Closer
	limit    int64
	read     int64
	exceeded bool
}

func (r *limitedReadCloser) Read(p []byte) (int, error) {
	if r.exceeded {
		return 0, ErrResponseTooLarge
	}
	remaining := r.limit - r.read
	if remaining < 0 {
		return 0, ErrResponseTooLarge
	}
	readBuffer := p
	if int64(len(readBuffer)) > remaining+1 {
		readBuffer = readBuffer[:remaining+1]
	}
	n, err := r.reader.Read(readBuffer)
	if int64(n) > remaining {
		r.read = r.limit
		r.exceeded = true
		return int(remaining), ErrResponseTooLarge
	}
	r.read += int64(n)
	return n, err
}

func (r *limitedReadCloser) Close() error { return r.closer.Close() }

func forwardableHeader(key string) bool {
	switch {
	case strings.EqualFold(key, "Authorization"), strings.EqualFold(key, "Accept"):
		return true
	case strings.EqualFold(key, "Accept-Encoding"), strings.EqualFold(key, "Content-Type"):
		return true
	case strings.EqualFold(key, "User-Agent"):
		return true
	default:
		return false
	}
}

func sanitizeQuery(values url.Values) (url.Values, error) {
	result := cloneValues(values)
	for key := range result {
		switch strings.ToLower(key) {
		case "token", "checktoken", "apikey", "authorization", "password":
			return nil, ErrCredentialQuery
		}
	}
	return result, nil
}

func cloneValues(values url.Values) url.Values {
	result := make(url.Values)
	for key, items := range values {
		result[key] = append([]string(nil), items...)
	}
	return result
}
