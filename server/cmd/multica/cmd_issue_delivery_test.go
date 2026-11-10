package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIssueDeliveryCLI(t *testing.T) {
	const issue = "a57c0511-1ebc-471d-a314-438ca16cc75d"
	for _, action := range []string{"projects", "list", "register", "resume"} {
		t.Run(action, func(t *testing.T) {
			t.Chdir(t.TempDir())
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Workspace-ID") != "ws-1" {
					t.Error("existing platform authentication must be reused")
				}
				wantMethod, wantPath := "GET", "/api/issues/"+issue+"/deliveries"
				if action == "projects" {
					wantPath = "/api/workspaces/ws-1/vcs/delivery-projects"
				}
				if action == "resume" {
					wantMethod, wantPath = "POST", wantPath+"/delivery-1/resume"
				}
				if action == "register" {
					wantMethod = "POST"
					var body map[string]string
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					if body["project_config_id"] != "config-1" || body["sha"] != strings.Repeat("a", 40) || body["ref"] != "feature/one" {
						t.Errorf("incorrect registration: %+v", body)
					}
				}
				if r.Method != wantMethod || r.URL.Path != wantPath {
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
				_, _ = w.Write([]byte(`{"id":"delivery-1"}`))
			}))
			defer srv.Close()
			t.Setenv("MULTICA_SERVER_URL", srv.URL)
			t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
			t.Setenv("MULTICA_TOKEN", "test-token")
			args := []string{action}
			if action != "projects" {
				args = append(args, issue)
			}
			if action == "register" {
				args = append(args, "--project-config-id", "config-1", "--sha", strings.Repeat("a", 40), "--ref", "feature/one")
			}
			if action == "resume" {
				args = append(args, "delivery-1")
			}
			cmd := newIssueDeliveryCommand()
			cmd.SetArgs(args)
			if err := cmd.Execute(); err != nil {
				t.Fatal(err)
			}
			if calls != 1 {
				t.Fatalf("want one platform request, got %d", calls)
			}
		})
	}
}

func TestIssueDeliveryCLIRequiresRegistrationEvidence(t *testing.T) {
	cmd := newIssueDeliveryCommand()
	cmd.SetArgs([]string{"register", "issue"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("missing project, commit and ref must be rejected")
	}
}
