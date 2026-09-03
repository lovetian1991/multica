package opencontent

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestClientForwardsBearerToFixedRoute(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/flatsdk/api/services/DocList/GetFileByIdOrGuid" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer api-key" {
			t.Errorf("authorization = %q", got)
		}
		if got := r.Header.Get("X-User-ID"); got != "" {
			t.Errorf("X-User-ID was forwarded: %q", got)
		}
		_, _ = io.WriteString(w, `{"result":0}`)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		Enabled:           true,
		BaseURL:           server.URL,
		Timeout:           time.Second,
		MaxUploadBytes:    1024,
		MaxResponseBytes:  1024,
		AllowedExtensions: []string{".txt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(context.Background(), OperationFileInfo, nil, url.Values{"fileIdOrGuid": {"123"}}, http.Header{
		"Authorization": {"Bearer api-key"},
		"X-User-ID":     {"must-not-forward"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
}

func TestClientRejectsUnknownOperation(t *testing.T) {
	client, err := NewClient(Config{Enabled: true, BaseURL: "https://oc.example.test", Timeout: time.Second, MaxUploadBytes: 1024, MaxResponseBytes: 1024, AllowedExtensions: []string{".txt"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Do(context.Background(), Operation("raw-path"), nil, nil, http.Header{"Authorization": {"Bearer api-key"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported OpenContent operation") {
		t.Fatalf("error = %v", err)
	}
}
