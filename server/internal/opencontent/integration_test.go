package opencontent

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLoginByAccount(t *testing.T) {
	const token = "12345678-1234-1234-1234-123456789012"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/flatsdk/api/services/Auth/UserLoginIntegrationByUserLoginName" || r.Method != http.MethodPost {
			t.Errorf("unexpected login route: %s %s", r.Method, r.URL.Path)
		}
		var request struct {
			LoginName      string `json:"loginName"`
			IntegrationKey string `json:"integrationKey"`
			ClientType     int    `json:"clientType"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.LoginName != "test.user" || request.IntegrationKey != "secret" || request.ClientType != 0 {
			t.Error("incorrect integration login payload")
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("integration login must not use API-key bearer authentication")
		}
		fmt.Fprintf(w, `{"result":0,"data":%q}`, token)
	}))
	defer upstream.Close()
	client, _ := NewClient(Config{})
	got, err := client.LoginByAccount(context.Background(), upstream.URL, "secret", "test.user")
	if err != nil || got != token {
		t.Fatalf("login failed: %v", err)
	}
}

func TestLoginByAccountRejectsErrorsWithoutLeakingCredentials(t *testing.T) {
	for _, response := range []string{
		`{"result":1,"msg":"secret","data":"secret"}`, `{"data":"12345678-1234-1234-1234-123456789012"}`,
		`{"result":0,"data":{"token":"secret"}}`, `{"result":0,"data":""}`, `not json`,
	} {
		t.Run(response, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, response)
			}))
			defer upstream.Close()
			client, _ := NewClient(Config{})
			_, err := client.LoginByAccount(context.Background(), upstream.URL, "secret", "test.user")
			if err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("expected a sanitized login error, got %v", err)
			}
		})
	}
}

func TestIntegrationLoginDoesNotFollowRedirects(t *testing.T) {
	redirected := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true }))
	defer target.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer upstream.Close()
	client, _ := NewClient(Config{})
	if _, err := client.LoginByAccount(context.Background(), upstream.URL, "secret", "user"); err == nil || redirected {
		t.Fatal("integration credentials must not follow redirects")
	}
}

func TestEncryptModelPayloadBindsCurrentToken(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	key := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	const token = "12345678-1234-1234-1234-123456789012"
	payload := []byte(`{"modelName":"workorder","id":"order-1"}`)
	body, err := encryptModelPayload(payload, token, key)
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, _ := base64.StdEncoding.DecodeString(string(body))
	plain, err := rsa.DecryptPKCS1v15(rand.Reader, privateKey, ciphertext)
	if err != nil || string(plain) != string(payload)+token {
		t.Fatal("model payload must use PKCS1 padding and append the current session token")
	}
}

func TestGetWorkOrderDetail(t *testing.T) {
	const token = "12345678-1234-1234-1234-123456789012"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/inbiz/api/services/modelengine/v3/business/selectData" || r.Method != http.MethodPost ||
			r.Header.Get("token") != token || r.Header.Get("appid") != "app-1" ||
			r.Header.Get("siteoutid") != "site-1" || r.Header.Get("Content-Type") != "text/plain;charset=UTF-8" {
			t.Error("incorrect detail request")
		}
		raw, _ := io.ReadAll(r.Body)
		ciphertext, err := base64.StdEncoding.DecodeString(string(raw))
		if err != nil || len(ciphertext) != 256 {
			t.Error("detail body must be a fresh RSA encrypted payload")
		}
		fmt.Fprint(w, `{"id":"order-1","title":"Title","description":"<p>Detail</p>"}`)
	}))
	defer upstream.Close()
	client, _ := NewClient(Config{})
	detail, err := client.GetWorkOrderDetail(context.Background(), upstream.URL, token, "app-1", "site-1", "order-1")
	if err != nil || string(detail["title"]) != `"Title"` {
		t.Fatalf("detail failed: %v", err)
	}
}
