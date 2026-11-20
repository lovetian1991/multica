package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
)

// ResolveDaemonGitLabCredential uses the workspace identity, including for
// shared workspaces. It is deliberately outside the agent task-token API.
func (h *Handler) ResolveDaemonGitLabCredential(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	workspaceID := chi.URLParam(r, "workspaceId")
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok || !h.requireDaemonWorkspaceAccess(w, r, workspaceID) {
		return
	}
	if !h.isVCSAvailable() || !h.isVCSConfigured() {
		writeError(w, http.StatusServiceUnavailable, "workspace GitLab connection is not configured")
		return
	}
	var req struct {
		RepoURL string `json:"repo_url"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req) != nil || req.RepoURL == "" {
		writeError(w, http.StatusBadRequest, "repo_url is required")
		return
	}
	connections, err := h.Queries.ListVCSConnectionsByWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load workspace GitLab connection")
		return
	}
	match := -1
	for i, conn := range connections {
		if conn.Provider == "gitlab" {
			if _, ok := vcs.RepositoryProject(req.RepoURL, conn.InstanceUrl); ok {
				if match >= 0 {
					writeError(w, http.StatusConflict, "multiple workspace GitLab connections match this repository")
					return
				}
				match = i
			}
		}
	}
	if match < 0 {
		writeError(w, http.StatusBadRequest, "configure a GitLab connection for this repository in the current workspace")
		return
	}
	conn := connections[match]
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil || token == "" {
		writeError(w, http.StatusServiceUnavailable, "workspace GitLab credential cannot be decrypted; reconnect in workspace settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"instance_url": conn.InstanceUrl, "access_token": token,
	})
}
