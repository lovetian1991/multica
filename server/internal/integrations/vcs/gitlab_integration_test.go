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

func TestMergeDeliveryGuardsAndReplay(t *testing.T) {
	for _, mode := range []string{"merge", "replay", "changed", "protected", "default", "missing target", "conflict", "wrong project", "wrong SHA", "advanced after merge"} {
		t.Run(mode, func(t *testing.T) {
			sha, mergedSHA := strings.Repeat("a", 40), strings.Repeat("b", 40)
			writes, merged := 0, mode == "replay"
			mr := integrationMR{IID: 2, SourceProjectID: 7, TargetProjectID: 7,
				SourceBranch: "feature/task", TargetBranch: "prod-9.1", SHA: sha, State: "opened"}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("PRIVATE-TOKEN") != "test-token" {
					t.Error("missing provider credential")
				}
				if r.Method != http.MethodGet {
					writes++
				}
				switch {
				case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/merge_requests"):
					if r.URL.Query().Get("target_branch") != "prod-9.1" || r.URL.Query().Get("source_branch") != "feature/task" {
						t.Error("incorrect merge request scope")
					}
					if mode == "replay" {
						mr.State, mr.MergeCommitSHA = "merged", mergedSHA
						_ = json.NewEncoder(w).Encode([]integrationMR{mr})
					} else {
						fmt.Fprint(w, "[]")
					}
				case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/repository/branches/feature/task"):
					if merged && mode != "advanced after merge" {
						http.NotFound(w, r)
						return
					}
					head := sha
					if mode == "changed" || merged {
						head = mergedSHA
					}
					fmt.Fprintf(w, `{"name":"feature/task","protected":%t,"default":%t,"commit":{"id":%q}}`, mode == "protected", mode == "default", head)
				case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/repository/branches/prod-9.1"):
					if mode == "missing target" {
						http.NotFound(w, r)
						return
					}
					fmt.Fprintf(w, `{"name":"prod-9.1","commit":{"id":%q}}`, mergedSHA)
				case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/merge_requests"):
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["remove_source_branch"] != true || body["target_branch"] != "prod-9.1" || body["source_branch"] != "feature/task" {
						t.Errorf("incorrect MR: %v", body)
					}
					if mode == "wrong project" {
						mr.TargetProjectID = 8
					}
					if mode == "wrong SHA" {
						mr.SHA = mergedSHA
					}
					w.WriteHeader(http.StatusCreated)
					_ = json.NewEncoder(w).Encode(mr)
				case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/merge_requests/2/merge"):
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["sha"] != sha || body["should_remove_source_branch"] != true {
						t.Errorf("missing reviewed-head guard: %v", body)
					}
					if mode == "conflict" {
						w.WriteHeader(http.StatusMethodNotAllowed)
						fmt.Fprint(w, `{"error":"private provider detail"}`)
						return
					}
					merged, mr.State, mr.MergeCommitSHA = true, "merged", mergedSHA
					_ = json.NewEncoder(w).Encode(mr)
				default:
					t.Errorf("unexpected provider operation %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			mr.WebURL = server.URL + "/team/app/-/merge_requests/2"
			got, err := (GitLabDeliveryClient{InstanceURL: server.URL, Token: "test-token"}).MergeDelivery(
				context.Background(), 7, DeliveryIntegration{SourceRef: "feature/task", SourceSHA: sha, TargetRef: "prod-9.1"}, "Task")
			switch mode {
			case "merge", "replay", "advanced after merge":
				cleanup := "deleted"
				if mode == "advanced after merge" {
					cleanup = "retained"
				}
				if err != nil || got.State != "merged" || got.MergeSHA != mergedSHA || got.SourceCleanup != cleanup {
					t.Fatalf("integration=%+v err=%v", got, err)
				}
				if mode == "replay" && writes != 0 {
					t.Fatal("replay must recover without merging or deleting again")
				}
			case "conflict":
				if err != nil || got.State != "blocked" || got.MergeRequestURL == "" || got.SourceCleanup != "retained" || strings.Contains(got.Reason, "private") {
					t.Fatalf("conflict must preserve MR and branch: %+v / %v", got, err)
				}
			default:
				if err == nil || merged {
					t.Fatalf("unsafe merge: %+v / %v", got, err)
				}
				if mode != "wrong project" && mode != "wrong SHA" && writes != 0 {
					t.Fatal("unsafe source/target must not create an MR")
				}
			}
		})
	}
}
