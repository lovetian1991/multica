package handler

import (
	"log/slog"
	"net/http"

	"github.com/multica-ai/multica/server/internal/logger"
)

// ListSystemWorkspaces returns the deployment-wide workspace directory for
// system administrators. It intentionally does not use the membership query:
// system management must be able to reach workspaces the administrator has
// not joined.
func (h *Handler) ListSystemWorkspaces(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}

	workspaces, err := h.Queries.ListAllWorkspaces(r.Context())
	if err != nil {
		slog.Warn("ListSystemWorkspaces failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list workspaces")
		return
	}

	response := make([]WorkspaceResponse, len(workspaces))
	for i, workspace := range workspaces {
		response[i] = h.workspaceToResponse(workspace)
	}
	writeJSON(w, http.StatusOK, response)
}
