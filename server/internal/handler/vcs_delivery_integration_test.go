package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestDeliveryIntegrationTarget(t *testing.T) {
	for _, tc := range []struct {
		name  string
		repos []RepoData
		want  string
	}{
		{"product version", []RepoData{{URL: "http://git.test/team/app.git", Ref: "prod-9.1"}}, "prod-9.1"},
		{"customer project", []RepoData{{URL: "git@git.test:team/app.git", Ref: "proj-kehu-9.1"}}, "proj-kehu-9.1"},
		{"no main fallback", []RepoData{{URL: "http://git.test/team/app.git"}}, ""},
		{"wrong repository", []RepoData{{URL: "http://git.test/private/app.git", Ref: "main"}}, ""},
		{"wrong instance", []RepoData{{URL: "http://other.test/team/app.git", Ref: "main"}}, ""},
		{"ambiguous", []RepoData{{URL: "http://git.test/team/app.git", Ref: "v1"}, {URL: "http://git.test/team/app.git", Ref: "v2"}}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := deliveryIntegrationTarget(tc.repos, "http://git.test", "team/app")
			if got != tc.want || (err != nil) != (tc.want == "") {
				t.Fatalf("target=%q err=%v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestDeliveryIntegrationTracksMergedCommitAndPreservesEvidence(t *testing.T) {
	sha, mergedSHA := strings.Repeat("a", 40), strings.Repeat("b", 40)
	merged, mergeCalls := false, 0
	var remote string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mr := map[string]any{"iid": 2, "source_project_id": 7, "target_project_id": 7, "source_branch": "feature",
			"target_branch": "prod-9.1", "sha": sha, "state": "opened", "web_url": remote + "/team/app/-/merge_requests/2"}
		if merged {
			mr["state"], mr["merge_commit_sha"] = "merged", mergedSHA
		}
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/merge_requests"):
			if merged {
				_ = json.NewEncoder(w).Encode([]any{mr})
			} else {
				fmt.Fprint(w, "[]")
			}
		case strings.HasSuffix(r.URL.Path, "/repository/branches/feature"):
			if merged {
				http.NotFound(w, r)
			} else {
				fmt.Fprintf(w, `{"name":"feature","commit":{"id":%q}}`, sha)
			}
		case strings.HasSuffix(r.URL.Path, "/repository/branches/prod-9.1"):
			fmt.Fprintf(w, `{"name":"prod-9.1","commit":{"id":%q}}`, mergedSHA)
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/merge_requests"):
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(mr)
		case r.Method == "PUT" && strings.HasSuffix(r.URL.Path, "/merge_requests/2/merge"):
			merged, mergeCalls = true, mergeCalls+1
			mr["state"], mr["merge_commit_sha"] = "merged", mergedSHA
			_ = json.NewEncoder(w).Encode(mr)
		case strings.HasSuffix(r.URL.Path, "/pipelines"):
			if r.URL.Query().Get("sha") != mergedSHA || r.URL.Query().Get("ref") != "prod-9.1" || r.URL.Query().Get("source") != "push" {
				t.Error("integration CI must match merged target commit, not feature CI")
			}
			fmt.Fprint(w, "[]")
		default:
			t.Errorf("unexpected GitLab operation: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	remote = server.URL
	config := seedDeliveryProject(t)
	dbfx.Exec(t, "UPDATE vcs_connection SET instance_url=$2 WHERE id=(SELECT connection_id FROM vcs_delivery_project WHERE id=$1)", config, remote)
	issue := dbfx.Issue(t, "integrated delivery")
	dbfx.Cleanup(t, "DELETE FROM vcs_delivery WHERE issue_id=$1", issue)
	source := registerDeliveryForTest(t, issue, config)
	project := dbfx.Project(t, "integrated product")
	dbfx.Exec(t, "UPDATE issue SET project_id=$2 WHERE id=$1", issue, project)
	resource, _ := json.Marshal(map[string]string{"url": remote + "/team/app.git", "ref": "prod-9.1"})
	dbfx.Insert(t, "project_resource", testutil.Cols{"project_id": project, "workspace_id": testWorkspaceID,
		"resource_type": "github_repo", "resource_ref": string(resource)})
	for range 2 {
		var response map[string]any
		request := testutil.WithURLParams(newRequest(http.MethodPost, "/unused",
			map[string]any{"merge": true, "target_ref": "prod-9.1"}), "id", issue, "deliveryId", source["id"].(string))
		testutil.Call(t, testHandler.IntegrateIssueDelivery, request).Want(http.StatusOK).JSON(&response)
		delivery := response["delivery"].(map[string]any)
		if delivery["sha"] != mergedSHA || delivery["ref"] != "prod-9.1" {
			t.Fatalf("incorrect integrated delivery: %v", response)
		}
	}
	if mergeCalls != 1 || dbfx.Count(t, "SELECT count(*) FROM vcs_delivery WHERE issue_id=$1", issue) != 2 {
		t.Fatal("repeated integration must not duplicate merges or target tracking")
	}
	rows, err := testHandler.Queries.ListIssueVCSDeliveries(context.Background(), db.ListIssueVCSDeliveriesParams{
		WorkspaceID: parseUUID(testWorkspaceID), IssueID: parseUUID(issue),
	})
	if err != nil {
		t.Fatal(err)
	}
	target := rows[0]
	if err := testHandler.pollVCSDelivery(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	var result string
	dbfx.QueryRow(t, "SELECT result::text FROM vcs_delivery WHERE id=$1", uuidToString(target.ID)).Scan(&result)
	if !strings.Contains(result, `"source_cleanup": "deleted"`) || !strings.Contains(result, `"merge_request_iid": 2`) {
		t.Fatalf("poll erased integration evidence: %s", result)
	}
	dbfx.Exec(t, "UPDATE vcs_delivery SET notified_at=now(), status='timed_out' WHERE id=$1", uuidToString(target.ID))
	request := testutil.WithURLParams(newRequest(http.MethodPost, "/unused", nil), "id", issue, "deliveryId", uuidToString(target.ID))
	testutil.Call(t, testHandler.RetryIssueDelivery, request).Want(http.StatusOK)
	dbfx.QueryRow(t, "SELECT result::text FROM vcs_delivery WHERE id=$1", uuidToString(target.ID)).Scan(&result)
	if !strings.Contains(result, `"merge_request_iid": 2`) {
		t.Fatalf("resume erased integration evidence: %s", result)
	}
}

func TestDeliveryIntegrationPreviewIsScopedAndNeverDefaultsMain(t *testing.T) {
	config := seedDeliveryProject(t)
	issue := dbfx.Issue(t, "integration preview")
	source := registerDeliveryForTest(t, issue, config)
	id := source["id"].(string)
	project := dbfx.Project(t, "integration project")
	dbfx.Exec(t, "UPDATE issue SET project_id=$2 WHERE id=$1", issue, project)
	dbfx.Insert(t, "project_resource", testutil.Cols{
		"project_id": project, "workspace_id": testWorkspaceID, "resource_type": "github_repo",
		"resource_ref": `{"url":"https://delivery.test/team/app.git","ref":"prod-9.1"}`,
	})
	request := func(targetIssue, delivery string, body any) *http.Request {
		return testutil.WithURLParams(newRequest(http.MethodPost, "/unused", body), "id", targetIssue, "deliveryId", delivery)
	}
	var preview map[string]any
	testutil.Call(t, testHandler.IntegrateIssueDelivery, request(issue, id, map[string]any{})).Want(http.StatusOK).JSON(&preview)
	plan := preview["integration"].(map[string]any)
	if plan["state"] != "preview" || plan["target_ref"] != "prod-9.1" || plan["source_sha"] != strings.Repeat("a", 40) {
		t.Fatalf("incorrect preview: %v", preview)
	}
	testutil.Call(t, testHandler.IntegrateIssueDelivery, request(issue, id, map[string]any{"merge": true, "target_ref": "main"})).Want(http.StatusConflict)
	other := dbfx.Issue(t, "unrelated integration issue")
	testutil.Call(t, testHandler.IntegrateIssueDelivery, request(other, id, map[string]any{})).Want(http.StatusNotFound)
	dbfx.Exec(t, "UPDATE issue SET status='cancelled' WHERE id=$1", issue)
	testutil.Call(t, testHandler.IntegrateIssueDelivery, request(issue, id, map[string]any{"merge": true, "target_ref": "prod-9.1"})).Want(http.StatusConflict)
	dbfx.Exec(t, "UPDATE issue SET status='todo' WHERE id=$1", issue)
	dbfx.Exec(t, "DELETE FROM project_resource WHERE project_id=$1", project)
	testutil.Call(t, testHandler.IntegrateIssueDelivery, request(issue, id, map[string]any{})).Want(http.StatusConflict)
}
