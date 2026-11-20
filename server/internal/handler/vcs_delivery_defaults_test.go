package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func preserveDeliverySettings(t *testing.T) {
	t.Helper()
	var raw []byte
	dbfx.QueryRow(t, "SELECT settings FROM workspace WHERE id=$1", testWorkspaceID).Scan(&raw)
	t.Cleanup(func() {
		dbfx.Exec(t, "UPDATE workspace SET settings=$2 WHERE id=$1", testWorkspaceID, raw)
	})
}

func saveDeliveryDefaultsForTest(t *testing.T, enabled bool, prefix string) vcsDeliveryDefaults {
	t.Helper()
	var result vcsDeliveryDefaults
	req := withURLParam(newRequest(http.MethodPut, "/unused", map[string]any{
		"enabled": enabled, "rules": map[string]any{"url_prefix": prefix, "allowed_hosts": []string{}},
	}), "id", testWorkspaceID)
	testutil.Call(t, testHandler.SaveVCSDeliveryDefaults, req).Want(http.StatusOK).JSON(&result)
	return result
}

func TestVCSDeliveryDefaultsAreWorkspaceScoped(t *testing.T) {
	withVCSBox(t)
	preserveDeliverySettings(t)
	dbfx.Exec(t, `UPDATE workspace SET settings='{"unrelated":{"keep":true}}' WHERE id=$1`, testWorkspaceID)
	var initial vcsDeliveryDefaults
	req := withURLParam(newRequest(http.MethodGet, "/unused", nil), "id", testWorkspaceID)
	testutil.Call(t, testHandler.GetVCSDeliveryDefaults, req).Want(http.StatusOK).JSON(&initial)
	if !initial.Enabled || !initial.Rules.AutoDiscover || initial.Rules.AllowedHosts == nil || initial.Rules.PipelineSource != "push" {
		t.Fatalf("invalid token-only defaults: %+v", initial)
	}
	otherWS := dbfx.Workspace(t, "other delivery defaults", "other-delivery-defaults")
	var before []byte
	dbfx.QueryRow(t, "SELECT settings FROM workspace WHERE id=$1", otherWS).Scan(&before)
	saved := saveDeliveryDefaultsForTest(t, true, "DEPLOY_URL=")
	if saved.Rules.URLPrefix != "DEPLOY_URL=" || !saved.Rules.AutoDiscover || saved.Rules.DeploymentJob != "" || saved.Rules.AllowedHosts == nil || len(saved.Rules.AllowedHosts) != 0 {
		t.Fatalf("save lost automatic rules: %+v", saved)
	}
	var keep bool
	dbfx.QueryRow(t, "SELECT (settings->'unrelated'->>'keep')::boolean FROM workspace WHERE id=$1", testWorkspaceID).Scan(&keep)
	if !keep {
		t.Fatal("saving defaults overwrote unrelated settings")
	}
	var after []byte
	dbfx.QueryRow(t, "SELECT settings FROM workspace WHERE id=$1", otherWS).Scan(&after)
	if string(before) != string(after) {
		t.Fatal("saving defaults modified a different workspace")
	}
	req = withURLParam(newRequest(http.MethodPut, "/unused", map[string]any{
		"enabled": true, "rules": map[string]any{"allowed_hosts": []string{"*.test"}},
	}), "id", testWorkspaceID)
	testutil.Call(t, testHandler.SaveVCSDeliveryDefaults, req).Want(http.StatusBadRequest)
	for _, body := range []any{nil, map[string]any{}, map[string]any{"enabled": true}, map[string]any{"rules": map[string]any{}}} {
		req = withURLParam(newRequest(http.MethodPut, "/unused", body), "id", testWorkspaceID)
		testutil.Call(t, testHandler.SaveVCSDeliveryDefaults, req).Want(http.StatusBadRequest)
	}
}

func TestVCSDeliveryRepositoryResolvesAndSnapshotsDefaults(t *testing.T) {
	box := withVCSBox(t)
	preserveDeliverySettings(t)
	saveDeliveryDefaultsForTest(t, true, "FIRST=")
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet || r.URL.EscapedPath() != "/api/v4/projects/team%2Fapp" || r.Header.Get("PRIVATE-TOKEN") == "" {
			t.Errorf("invalid project lookup %s %s", r.Method, r.URL.EscapedPath())
		}
		fmt.Fprint(w, `{"id":7,"path_with_namespace":"team/app"}`)
	}))
	defer provider.Close()
	conn := seedVCSConnection(t, context.Background(), box, "gitlab", provider.URL)
	dbfx.Cleanup(t, "DELETE FROM vcs_connection WHERE id=$1", conn)
	dbfx.Cleanup(t, "DELETE FROM vcs_delivery_project WHERE connection_id=$1", conn)
	issue := dbfx.Issue(t, "automatic delivery")
	register := func(sha string, want int) map[string]any {
		t.Helper()
		req := withURLParam(newRequest(http.MethodPost, "/unused", map[string]any{
			"repository_url": provider.URL + "/team/app.git", "sha": strings.Repeat(sha, 40), "ref": "feature",
		}), "id", issue)
		call := testutil.Call(t, testHandler.RegisterIssueDelivery, req).Want(want)
		var result map[string]any
		if want == http.StatusOK {
			call.JSON(&result)
			dbfx.Cleanup(t, "DELETE FROM vcs_delivery WHERE id=$1", result["id"])
		}
		return result
	}
	first := register("a", http.StatusOK)
	config := first["project_config_id"].(string)
	project, err := testHandler.Queries.GetVCSDeliveryProject(context.Background(), db.GetVCSDeliveryProjectParams{
		ID: parseUUID(config), WorkspaceID: parseUUID(testWorkspaceID),
	})
	if err != nil || !deliveryInheritsDefaults(project.Rules) {
		t.Fatalf("automatic project did not inherit defaults: %+v %v", project, err)
	}
	saveDeliveryDefaultsForTest(t, true, "SECOND=")
	duplicate := register("a", http.StatusOK)
	if duplicate["id"] != first["id"] {
		t.Fatal("repository registration must be idempotent")
	}
	second := register("b", http.StatusOK)
	for _, tc := range []struct {
		id     any
		prefix string
	}{{first["id"], "FIRST="}, {second["id"], "SECOND="}} {
		var raw []byte
		dbfx.QueryRow(t, "SELECT rules FROM vcs_delivery WHERE id=$1", tc.id).Scan(&raw)
		var rules vcs.DeliveryRules
		if json.Unmarshal(raw, &rules) != nil || rules.URLPrefix != tc.prefix || rules.AllowedHosts == nil || len(rules.AllowedHosts) != 0 {
			t.Fatalf("delivery rules were not snapshotted: %s", raw)
		}
	}
	dbfx.Exec(t, `UPDATE vcs_delivery_project SET rules='{"deployment_job":"specific","allowed_hosts":["app.test"]}' WHERE id=$1`, config)
	third := register("c", http.StatusOK)
	var override string
	dbfx.QueryRow(t, "SELECT rules->>'deployment_job' FROM vcs_delivery WHERE id=$1", third["id"]).Scan(&override)
	if override != "specific" {
		t.Fatal("repository resolution overwrote an existing project override")
	}
	saveDeliveryDefaultsForTest(t, false, "DISABLED=")
	before := calls
	register("d", http.StatusBadRequest)
	if calls != before {
		t.Fatal("disabled auto tracking contacted GitLab")
	}
}

func TestVCSDeliveryRepositoryRejectsUnmatchedConnectionsAndInvalidEvidence(t *testing.T) {
	withVCSBox(t)
	preserveDeliverySettings(t)
	saveDeliveryDefaultsForTest(t, true, "URL=")
	issue := dbfx.Issue(t, "invalid automatic delivery")
	for _, body := range []map[string]any{
		{"repository_url": "git@unconfigured.test:team/app.git", "sha": strings.Repeat("a", 40), "ref": "feature"},
		{"repository_url": "git@unconfigured.test:team/app.git", "project_config_id": "config", "sha": strings.Repeat("a", 40), "ref": "feature"},
		{"repository_url": "git@unconfigured.test:team/app.git", "sha": "short", "ref": "feature"},
		{"sha": strings.Repeat("a", 40), "ref": "feature"},
	} {
		req := withURLParam(newRequest(http.MethodPost, "/unused", body), "id", issue)
		testutil.Call(t, testHandler.RegisterIssueDelivery, req).Want(http.StatusBadRequest)
	}
}
