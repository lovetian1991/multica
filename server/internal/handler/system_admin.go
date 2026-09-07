package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/util"
)

// requireSystemAdmin enforces the deployment-level allowlist for system
// management routes. The empty allowlist intentionally fails closed.
func (h *Handler) requireSystemAdmin(w http.ResponseWriter, r *http.Request) bool {
	if isMachineCredentialActor(r) {
		writeError(w, http.StatusForbidden, "this endpoint is only available to human actors")
		return false
	}

	userID := strings.TrimSpace(requestUserID(r))
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return false
	}
	userUUID, err := util.ParseUUID(userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return false
	}
	user, err := h.Queries.GetUser(r.Context(), userUUID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusForbidden, "system administrator access required")
			return false
		}
		writeError(w, http.StatusInternalServerError, "failed to verify system administrator access")
		return false
	}

	for _, allowedEmail := range h.cfg.SystemAdminEmails {
		if strings.EqualFold(strings.TrimSpace(allowedEmail), strings.TrimSpace(user.Email)) {
			return true
		}
	}
	writeError(w, http.StatusForbidden, "system administrator access required")
	return false
}
