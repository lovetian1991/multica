package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestValidateOCAccount(t *testing.T) {
	for _, value := range []string{"yong.tian", " user.name ", ""} {
		got, err := validateOCAccount(value)
		if err != nil || got != strings.TrimSpace(value) {
			t.Fatalf("unexpected account normalization: %q %v", got, err)
		}
	}
	for _, value := range []string{"user\nname", "user\x00name", strings.Repeat("a", 257)} {
		if _, err := validateOCAccount(value); err == nil {
			t.Fatal("invalid account accepted")
		}
	}
}

func TestUpdateWorkspaceOCAccountPreservesKey(t *testing.T) {
	wsID := dbfx.Insert(t, "workspace", testutil.Cols{
		"name": "OC account test", "slug": "handler-oc-account",
		"settings": `{"oc_key_encrypted":"existing-ciphertext","unrelated":true}`,
	})
	dbfx.Insert(t, "member", testutil.Cols{
		"workspace_id": wsID, "user_id": testUserID, "role": "owner",
	})
	req := withURLParam(newRequest(http.MethodPatch, "/api/workspaces/"+wsID,
		map[string]any{"oc_account": " yong.tian "}), "id", wsID)
	var response WorkspaceResponse
	testutil.Call(t, testHandler.UpdateWorkspace, req).Want(http.StatusOK).JSON(&response)
	settings, ok := response.Settings.(map[string]any)
	if !ok || settings["oc_account"] != "yong.tian" || !response.OCKeyConfigured {
		t.Fatalf("account update response is incorrect: configured=%v", response.OCKeyConfigured)
	}
	if _, exposed := settings["oc_key_encrypted"]; exposed {
		t.Fatal("encrypted key leaked in workspace response")
	}
	readSettings := func() map[string]any {
		t.Helper()
		var raw []byte
		dbfx.QueryRow(t, `SELECT settings FROM workspace WHERE id = $1`, wsID).Scan(&raw)
		var stored map[string]any
		if err := json.Unmarshal(raw, &stored); err != nil {
			t.Fatal(err)
		}
		return stored
	}
	stored := readSettings()
	if stored["oc_key_encrypted"] != "existing-ciphertext" || stored["unrelated"] != true {
		t.Fatal("account update changed existing settings")
	}
	invalid := withURLParam(newRequest(http.MethodPatch, "/api/workspaces/"+wsID,
		map[string]any{"oc_account": "invalid\naccount"}), "id", wsID)
	testutil.Call(t, testHandler.UpdateWorkspace, invalid).Want(http.StatusBadRequest)
	generic := withURLParam(newRequest(http.MethodPatch, "/api/workspaces/"+wsID,
		map[string]any{"settings": map[string]any{"oc_account": "bypass\nvalidation"}}), "id", wsID)
	testutil.Call(t, testHandler.UpdateWorkspace, generic).Want(http.StatusOK)
	if readSettings()["oc_account"] != "yong.tian" {
		t.Fatal("invalid or generic settings update overwrote the account")
	}
}
