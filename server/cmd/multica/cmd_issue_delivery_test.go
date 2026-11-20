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

func TestIssueDeliveryCLIIntegrate(t *testing.T) {
	t.Chdir(t.TempDir())
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Merge  bool   `json:"merge"`
			Target string `json:"target_ref"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.Method != "POST" || !strings.HasSuffix(r.URL.Path, "/deliveries/delivery-1/integrate") ||
			body.Merge != (calls == 2) || (body.Merge && body.Target != "prod-9.1") {
			t.Errorf("incorrect integration request: %+v %s", body, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"integration":{"state":"preview"}}`))
	}))
	defer srv.Close()
	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_TOKEN", "test-token")
	for _, flags := range [][]string{nil, {"--merge", "--target", "prod-9.1"}, {"--merge"}} {
		cmd := newIssueDeliveryCommand()
		cmd.SetArgs(append([]string{"integrate", "a57c0511-1ebc-471d-a314-438ca16cc75d", "delivery-1"}, flags...))
		err := cmd.Execute()
		if (err != nil) != (len(flags) == 1) {
			t.Fatalf("flags %v: %v", flags, err)
		}
	}
	if calls != 2 {
		t.Fatalf("missing target must not send a merge request, calls=%d", calls)
	}
}

func TestIssueDeliveryCLIRepository(t *testing.T) {
	t.Chdir(t.TempDir())
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["repository_url"] != "git@git.test:team/app.git" || body["sha"] != strings.Repeat("a", 40) || body["ref"] != "feature" {
			t.Errorf("incorrect repository registration: %+v", body)
		}
		if _, exists := body["project_config_id"]; exists {
			t.Error("automatic registration must not require a configuration ID")
		}
		_, _ = w.Write([]byte(`{"id":"delivery-1"}`))
	}))
	defer srv.Close()
	t.Setenv("MULTICA_SERVER_URL", srv.URL)
	t.Setenv("MULTICA_WORKSPACE_ID", "ws-1")
	t.Setenv("MULTICA_TOKEN", "test-token")
	for _, extra := range [][]string{
		{"--repo", "git@git.test:team/app.git"},
		{"--repo", "git@git.test:team/app.git", "--project-config-id", "config-1"},
		{},
	} {
		cmd := newIssueDeliveryCommand()
		cmd.SetArgs(append([]string{"register", "a57c0511-1ebc-471d-a314-438ca16cc75d", "--sha", strings.Repeat("a", 40), "--ref", "feature"}, extra...))
		err := cmd.Execute()
		if (err == nil) != (len(extra) == 2) {
			t.Fatalf("unexpected flag validation for %v: %v", extra, err)
		}
	}
	if calls != 1 {
		t.Fatalf("invalid flags sent a platform request: %d", calls)
	}
}
