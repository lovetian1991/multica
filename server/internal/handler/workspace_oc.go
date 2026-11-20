package handler

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func validateOCAccount(raw string) (string, error) {
	if utf8.RuneCountInString(raw) > 256 {
		return "", errors.New("OC account is too long")
	}
	for _, ch := range raw {
		if unicode.IsControl(ch) {
			return "", errors.New("OC account cannot contain control characters")
		}
	}
	return strings.TrimSpace(raw), nil
}

func (h *Handler) workspaceOCSession(ctx context.Context, workspace db.Workspace) (string, string, error) {
	settings, err := workspaceSettingsMap(workspace.Settings)
	if err != nil {
		return "", "", errors.New("failed to read workspace OC settings")
	}
	account := workspaceSettingString(settings, "oc_account")
	if account == "" {
		return "", "", errors.New("configure the OC account in workspace settings first")
	}
	global, err := h.Queries.GetSystemSettings(ctx)
	if err != nil || global.KbEnvironmentUrl == "" || global.OcIntegrationKeyEncrypted == "" {
		return "", "", errors.New("configure the OC environment URL and integration key in system settings first")
	}
	if h.SystemSettingsSecretBox == nil {
		return "", "", errors.New("system settings encryption is not configured")
	}
	sealed, err := base64.StdEncoding.DecodeString(global.OcIntegrationKeyEncrypted)
	if err != nil {
		return "", "", errors.New("failed to decrypt OC integration key; configure it again")
	}
	key, err := h.SystemSettingsSecretBox.Open(sealed)
	if err != nil {
		return "", "", errors.New("failed to decrypt OC integration key; configure it again")
	}
	token, err := h.OpenContent.LoginByAccount(ctx, global.KbEnvironmentUrl, string(key), account)
	return global.KbEnvironmentUrl, token, err
}

func (h *Handler) CheckWorkspaceOC(w http.ResponseWriter, r *http.Request) {
	id, ok := parseUUIDOrBadRequest(w, workspaceIDFromURL(r, "id"), "workspace id")
	if !ok {
		return
	}
	workspace, err := h.Queries.GetWorkspace(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	if _, _, err := h.workspaceOCSession(r.Context(), workspace); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]bool{"connected": true})
}
