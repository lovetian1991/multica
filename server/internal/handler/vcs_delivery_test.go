package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func seedDeliveryProject(t *testing.T) string {
	t.Helper()
	box := withVCSBox(t)
	conn := seedVCSConnection(t, context.Background(), box, "gitlab", "https://delivery.test")
	dbfx.Cleanup(t, "DELETE FROM vcs_connection WHERE id=$1", conn)
	return dbfx.Insert(t, "vcs_delivery_project", testutil.Cols{
		"workspace_id": testWorkspaceID, "connection_id": conn,
		"project_id": 7, "project_path": "team/app",
		"rules": `{"deployment_job":"deploy","allowed_hosts":["app.test"],"timeout_minutes":120}`,
	})
}

func registerDeliveryForTest(t *testing.T, issue, config string) map[string]any {
	t.Helper()
	var out map[string]any
	req := withURLParam(newRequest(http.MethodPost, "/api/issues/"+issue+"/deliveries", map[string]any{
		"project_config_id": config, "sha": strings.Repeat("A", 40), "ref": "feature",
	}), "id", issue)
	testutil.Call(t, testHandler.RegisterIssueDelivery, req).Want(http.StatusOK).JSON(&out)
	dbfx.Cleanup(t, "DELETE FROM vcs_delivery WHERE id=$1", out["id"])
	return out
}

func TestVCSDeliveryRegistrationIsScopedAndIdempotent(t *testing.T) {
	config := seedDeliveryProject(t)
	var projects struct {
		Projects []map[string]any `json:"projects"`
	}
	req := withURLParam(newRequest(http.MethodGet, "/unused", nil), "id", testWorkspaceID)
	testutil.Call(t, testHandler.ListVCSDeliveryProjects, req).Want(http.StatusOK).JSON(&projects)
	found := false
	for _, p := range projects.Projects {
		if p["id"] == config {
			found = p["instance_url"] == "https://delivery.test" && p["project_path"] == "team/app"
			if _, ok := p["access_token_encrypted"]; ok {
				t.Fatal("delivery project list exposed credentials")
			}
		}
	}
	if !found {
		t.Fatal("delivery project list must identify the actual remote instance and project")
	}
	issue := dbfx.Issue(t, "delivery registration")
	first := registerDeliveryForTest(t, issue, config)
	second := registerDeliveryForTest(t, issue, config)
	if first["id"] != second["id"] || first["sha"] != strings.Repeat("a", 40) {
		t.Fatalf("registration lost identity: %v / %v", first, second)
	}
	if _, ok := first["result"].(map[string]any); !ok {
		t.Fatal("result must be a JSON object, not base64")
	}
	if n := dbfx.Count(t, "SELECT count(*) FROM vcs_delivery WHERE issue_id=$1", issue); n != 1 {
		t.Fatalf("got %d deliveries after duplicate registration", n)
	}
	otherWS := dbfx.Workspace(t, "delivery isolation", "delivery-isolation")
	otherConfig := dbfx.Insert(t, "vcs_delivery_project", testutil.Cols{
		"workspace_id": otherWS, "connection_id": config, "project_id": 8,
		"project_path": "private/app", "rules": `{}`,
	})
	for _, tc := range []struct {
		project, sha string
		want         int
	}{
		{otherConfig, strings.Repeat("a", 40), http.StatusNotFound},
		{config, "short", http.StatusBadRequest},
		{"not-a-uuid", strings.Repeat("a", 40), http.StatusBadRequest},
	} {
		req := withURLParam(newRequest(http.MethodPost, "/unused", map[string]any{
			"project_config_id": tc.project, "sha": tc.sha, "ref": "feature",
		}), "id", issue)
		testutil.Call(t, testHandler.RegisterIssueDelivery, req).Want(tc.want)
	}
	otherIssue := dbfx.Issue(t, "private delivery", testutil.Cols{"workspace_id": otherWS})
	req = withURLParam(newRequest(http.MethodGet, "/unused", nil), "id", otherIssue)
	testutil.Call(t, testHandler.ListIssueDeliveries, req).Want(http.StatusNotFound)
}

func TestVCSDeliveryTerminalNotificationIsAtomicAndDoesNotDispatch(t *testing.T) {
	config := seedDeliveryProject(t)
	issue := dbfx.Issue(t, "delivery terminal", testutil.Cols{"status": "done"})
	dbfx.Cleanup(t, "DELETE FROM comment WHERE issue_id=$1", issue)
	out := registerDeliveryForTest(t, issue, config)
	id := out["id"].(string)
	dbfx.Exec(t, `UPDATE vcs_delivery SET status='deployed', pipeline_id=12,
		result='{"deployment_url":"https://app.test/","pipeline_url":"https://delivery.test/pipelines/12"}'
		WHERE id=$1`, id)
	rows, err := testHandler.Queries.ListIssueVCSDeliveries(context.Background(), db.ListIssueVCSDeliveriesParams{
		WorkspaceID: parseUUID(testWorkspaceID), IssueID: parseUUID(issue),
	})
	if err != nil || len(rows) != 1 {
		t.Fatalf("load delivery: %v (%d)", err, len(rows))
	}
	tasks := dbfx.Count(t, "SELECT count(*) FROM agent_task_queue WHERE issue_id=$1", issue)
	if err := testHandler.pollVCSDelivery(context.Background(), rows[0]); err != nil {
		t.Fatal(err)
	}
	if err := testHandler.pollVCSDelivery(context.Background(), rows[0]); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("duplicate stale notification must not write again: %v", err)
	}
	if n := dbfx.Count(t, "SELECT count(*) FROM comment WHERE issue_id=$1 AND author_type='system'", issue); n != 1 {
		t.Fatalf("want exactly one terminal comment, got %d", n)
	}
	if n := dbfx.Count(t, "SELECT count(*) FROM vcs_delivery WHERE id=$1 AND notified_at IS NOT NULL AND status='deployed'", id); n != 1 {
		t.Fatal("comment and terminal marker did not commit together")
	}
	if n := dbfx.Count(t, "SELECT count(*) FROM agent_task_queue WHERE issue_id=$1", issue); n != tasks {
		t.Fatal("delivery notification dispatched an agent")
	}
	var content, status string
	dbfx.QueryRow(t, "SELECT content FROM comment WHERE issue_id=$1 AND author_type='system'", issue).Scan(&content)
	dbfx.QueryRow(t, "SELECT status FROM issue WHERE id=$1", issue).Scan(&status)
	if !strings.Contains(content, "Awaiting user acceptance") || status != "done" {
		t.Fatal("notification must preserve issue status and distinguish acceptance")
	}
	req := testutil.WithURLParams(newRequest(http.MethodPost, "/unused", nil), "id", issue, "deliveryId", id)
	var resumed map[string]any
	testutil.Call(t, testHandler.RetryIssueDelivery, req).Want(http.StatusOK).JSON(&resumed)
	if resumed["terminal"] != false {
		t.Fatal("resume must clear terminal marker")
	}
	var pipeline int64
	dbfx.QueryRow(t, "SELECT pipeline_id FROM vcs_delivery WHERE id=$1", id).Scan(&pipeline)
	if pipeline != 12 {
		t.Fatal("resume must preserve exact pipeline binding")
	}
}

func TestVCSDeliveryProjectRulesAreSnapshot(t *testing.T) {
	config := seedDeliveryProject(t)
	issue := dbfx.Issue(t, "delivery snapshot")
	out := registerDeliveryForTest(t, issue, config)
	dbfx.Exec(t, `UPDATE vcs_delivery_project SET rules='{"deployment_job":"different"}' WHERE id=$1`, config)
	var rules json.RawMessage
	dbfx.QueryRow(t, "SELECT rules FROM vcs_delivery WHERE id=$1", out["id"]).Scan(&rules)
	if !strings.Contains(string(rules), `"deploy"`) {
		t.Fatal("changing project rules changed the registered delivery")
	}
	req := withURLParam(newRequest(http.MethodPost, "/unused", nil), "id", issue)
	testHandler.cfg.VCSIntegrationEnabled = false
	testutil.Call(t, testHandler.RegisterIssueDelivery, req).Want(http.StatusNotFound)
}
