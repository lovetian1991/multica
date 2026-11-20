package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveProductCodePlanUsesConnectedCatalog(t *testing.T) {
	codeReads := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer operator-token" {
			t.Error("catalog request lost profile credential")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/products":
			_ = json.NewEncoder(w).Encode(map[string]any{"products": []map[string]string{
				{"id": "oc", "name": "Opencontent", "slug": "oc"},
				{"id": "inbiz", "name": "Inbiz", "slug": "inbiz"},
			}})
		case "/api/products/oc/versions", "/api/products/inbiz/versions":
			id := strings.Split(r.URL.Path, "/")[3]
			_ = json.NewEncoder(w).Encode(map[string]any{"versions": []map[string]any{
				{"id": id + "-85", "name": "v8.5.0.0", "enabled": true},
				{"id": id + "-disabled", "name": "v9", "enabled": false},
			}})
		case "/api/products/oc/versions/oc-85/code":
			codeReads["oc"]++
			_, _ = w.Write([]byte(`{"modules":[{"key":"main","repo_url":"git@example.test:oc.git","ref":"prod-8.5.0.0"}],"dependencies":["inbiz-85"]}`))
		case "/api/products/inbiz/versions/inbiz-85/code":
			codeReads["inbiz"]++
			_, _ = w.Write([]byte(`{"modules":[{"key":"Backend","repo_url":"git@example.test:backend.git","ref":"dev-8.5.0.0-hotfix"},{"key":"Frontend","repo_url":"git@example.test:frontend.git","ref":"dev-8.5.0.0-hotfix"}],"dependencies":["oc-85"]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClient(server.URL)
	client.SetToken("operator-token")
	plan, err := client.ResolveProductCodePlan(context.Background(), "oc-85")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Repos) != 3 || codeReads["oc"] != 1 || codeReads["inbiz"] != 1 {
		t.Fatalf("recursive dependency was omitted or duplicated: %+v; reads=%v", plan, codeReads)
	}
	for i, want := range []struct{ dir, ref string }{
		{"code/oc/v8.5.0.0/main", "prod-8.5.0.0"},
		{"code/inbiz/v8.5.0.0/Backend", "dev-8.5.0.0-hotfix"},
		{"code/inbiz/v8.5.0.0/Frontend", "dev-8.5.0.0-hotfix"},
	} {
		if got := plan.Repos[i]; got.Directory != want.dir || got.Ref != want.ref || got.RefSource != "baseline" {
			t.Fatalf("checkout %d lost configured directory or baseline: %+v", i, got)
		}
	}
	if _, err := client.ResolveProductCodePlan(context.Background(), "oc-disabled"); err == nil {
		t.Fatal("disabled version was accepted")
	}
}

func TestProductPrepareRejectsInvalidOperatorRequests(t *testing.T) {
	client := NewClient("http://unused.example.test")
	client.SetToken("operator-token")
	d := &Daemon{client: client, workspaces: map[string]*workspaceState{}}
	for _, tc := range []struct {
		name, method, token, body string
		status                    int
	}{
		{"method", http.MethodGet, "operator-token", "", http.StatusMethodNotAllowed},
		{"no credential", http.MethodPost, "", `{}`, http.StatusUnauthorized},
		{"task credential", http.MethodPost, "mat_task-token", `{}`, http.StatusUnauthorized},
		{"invalid UUID", http.MethodPost, "operator-token", `{"workspace_id":"bad","version_id":"bad"}`, http.StatusBadRequest},
		{"unwatched workspace", http.MethodPost, "operator-token", `{"workspace_id":"3783fad5-02b4-43d3-8a1b-13e5e435ecc4","version_id":"53853451-9617-4ad9-a5ee-4c81f6818732"}`, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "/repo/prepare-product", strings.NewReader(tc.body))
			if tc.token != "" {
				r.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			d.productPrepareHandler()(w, r)
			if w.Code != tc.status {
				t.Fatalf("got HTTP %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}
}
