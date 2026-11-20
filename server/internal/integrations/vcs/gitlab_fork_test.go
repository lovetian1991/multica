package vcs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEnsurePersonalFork(t *testing.T) {
	for _, mode := range []string{"existing", "create", "collision", "wrong upstream", "wrong namespace", "wrong clone host", "wrong upstream clone", "forbidden", "import failed"} {
		t.Run(mode, func(t *testing.T) {
			writes := 0
			var host string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("PRIVATE-TOKEN") != "workspace-token" {
					t.Error("workspace credential missing")
				}
				switch r.URL.Path {
				case "/api/v4/user":
					fmt.Fprint(w, `{"id":4,"username":"alice"}`)
				case "/api/v4/projects/team/app":
					clone := host + "/team/app.git"
					if mode == "wrong upstream clone" {
						clone = host + "/other/app.git"
					}
					fmt.Fprintf(w, `{"id":9,"path":"app","path_with_namespace":"team/app","http_url_to_repo":%q,"namespace":{"full_path":"team","kind":"group"}}`, clone)
				case "/api/v4/projects/alice/app", "/api/v4/projects/9/fork":
					if mode == "create" && r.Method == http.MethodGet {
						http.NotFound(w, r)
						return
					}
					if r.Method == http.MethodPost {
						writes++
						var body map[string]any
						_ = json.NewDecoder(r.Body).Decode(&body)
						if body["namespace"] != "alice" {
							t.Error("fork must use workspace GitLab user's namespace")
						}
						w.WriteHeader(http.StatusCreated)
					}
					if mode == "forbidden" {
						w.WriteHeader(http.StatusForbidden)
						return
					}
					parent, namespace, clone, status := `{"id":9}`, "alice", host+"/alice/app.git", "finished"
					switch mode {
					case "collision":
						parent = "null"
					case "wrong upstream":
						parent = `{"id":10}`
					case "wrong namespace":
						namespace = "bob"
					case "wrong clone host":
						clone = "https://other.test/alice/app.git"
					case "import failed":
						status = "failed"
					}
					fmt.Fprintf(w, `{"id":120,"path":"app","path_with_namespace":"alice/app","http_url_to_repo":%q,"import_status":%q,"namespace":{"full_path":%q,"kind":"user"},"forked_from_project":%s}`, clone, status, namespace, parent)
				default:
					t.Errorf("unexpected provider operation %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			host = server.URL
			client := GitLabDeliveryClient{InstanceURL: host, Token: "workspace-token"}
			result, err := client.EnsurePersonalFork(context.Background(), host+"/team/app.git")
			if mode == "existing" || mode == "create" {
				if err != nil || result.Fork.ID != 120 || result.Upstream.ID != 9 {
					t.Fatalf("fork=%+v err=%v", result, err)
				}
			} else if err == nil {
				t.Fatal("unsafe fork accepted")
			}
			expectedWrites := 0
			if mode == "create" {
				expectedWrites = 1
			}
			if writes != expectedWrites {
				t.Fatalf("unexpected fork writes: %d", writes)
			}
		})
	}
}

func TestSubmitForkMergeRequest(t *testing.T) {
	for _, mode := range []string{"create", "replay", "wrong target", "wrong sha", "permission"} {
		t.Run(mode, func(t *testing.T) {
			posts := 0
			sha := strings.Repeat("a", 40)
			mr := GitLabForkMergeRequest{IID: 3, SourceProjectID: 120, TargetProjectID: 9,
				SourceBranch: "agent/dev/task", TargetBranch: "prod-8.5.0.0", SHA: sha, State: "opened"}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v4/projects/120/merge_requests" {
					t.Errorf("must not merge, approve, or mutate upstream: %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
					return
				}
				if r.Method == http.MethodGet {
					if mode == "replay" {
						_ = json.NewEncoder(w).Encode([]GitLabForkMergeRequest{mr})
					} else {
						fmt.Fprint(w, "[]")
					}
					return
				}
				posts++
				if mode == "permission" {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if body["target_project_id"] != float64(9) || body["target_branch"] != "prod-8.5.0.0" || body["remove_source_branch"] != true {
					t.Errorf("wrong review request: %v", body)
				}
				if mode == "wrong target" {
					mr.TargetProjectID = 120
				}
				if mode == "wrong sha" {
					mr.SHA = strings.Repeat("b", 40)
				}
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(mr)
			}))
			defer server.Close()
			mr.WebURL = server.URL + "/team/app/-/merge_requests/3"
			fork := GitLabPersonalFork{Upstream: GitLabForkProject{ID: 9}, Fork: GitLabForkProject{ID: 120}}
			fork.Fork.ForkedFrom = &struct {
				ID int64 `json:"id"`
			}{9}
			got, err := (GitLabDeliveryClient{InstanceURL: server.URL}).SubmitForkMergeRequest(
				context.Background(), fork, mr.SourceBranch, mr.TargetBranch, sha, "TASK-1")
			if mode == "create" || mode == "replay" {
				if err != nil || got.IID != 3 {
					t.Fatalf("review=%+v err=%v", got, err)
				}
			} else if err == nil {
				t.Fatal("invalid review accepted")
			}
			if mode == "replay" && posts != 0 {
				t.Fatal("replay created another MR")
			}
		})
	}
}
