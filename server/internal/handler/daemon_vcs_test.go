package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestDaemonGitLabUsesCurrentWorkspaceConnection(t *testing.T) {
	box := withVCSBox(t)
	conn := seedVCSConnection(t, context.Background(), box, "gitlab", "https://workspace-git.test")
	dbfx.Cleanup(t, "DELETE FROM vcs_connection WHERE id=$1", conn)
	// A shared workspace intentionally uses its configured account, not the
	// current caller's account or the member who originally connected it.
	dbfx.Exec(t, "UPDATE vcs_connection SET connected_by_id=NULL WHERE id=$1", conn)
	request := func(remote, workspace string) *http.Request {
		return withURLParam(newRequest(http.MethodPost, "/unused", map[string]string{"repo_url": remote}), "workspaceId", workspace)
	}
	var out map[string]string
	testutil.Call(t, testHandler.ResolveDaemonGitLabCredential,
		request("git@workspace-git.test:standard/product.git", testWorkspaceID)).Want(http.StatusOK).JSON(&out)
	if out["access_token"] != "tok" || out["instance_url"] != "https://workspace-git.test" {
		t.Fatal("workspace credential was not resolved")
	}
	w := httptest.NewRecorder()
	testHandler.ResolveDaemonGitLabCredential(w, request("https://other.test/standard/product.git", testWorkspaceID))
	if w.Code != http.StatusBadRequest || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), `"access_token"`) {
		t.Fatal("unconfigured host received a workspace credential")
	}
	other := dbfx.Workspace(t, "Private", "private-fork-check", testutil.Cols{})
	w = httptest.NewRecorder()
	testHandler.ResolveDaemonGitLabCredential(w, request("https://workspace-git.test/standard/product.git", other))
	if w.Code == http.StatusOK {
		t.Fatal("credential resolver crossed the membership boundary")
	}
}
