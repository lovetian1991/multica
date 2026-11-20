package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type vcsDeliveryDefaults struct {
	Enabled bool              `json:"enabled"`
	Rules   vcs.DeliveryRules `json:"rules"`
}

func (h *Handler) loadVCSDeliveryDefaults(ctx context.Context, ws pgtype.UUID) (vcsDeliveryDefaults, error) {
	defaults := vcsDeliveryDefaults{Enabled: true, Rules: vcs.DeliveryRules{AutoDiscover: true}}
	w, err := h.Queries.GetWorkspace(ctx, ws)
	if err != nil {
		return defaults, err
	}
	var settings map[string]json.RawMessage
	if err := json.Unmarshal(w.Settings, &settings); err != nil {
		return defaults, err
	}
	if raw, ok := settings["gitlab_delivery_defaults"]; ok {
		if err := json.Unmarshal(raw, &defaults); err != nil {
			return defaults, err
		}
	}
	defaults.Rules.AutoDiscover = true
	return defaults, defaults.Rules.Validate()
}

func (h *Handler) GetVCSDeliveryDefaults(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	ws, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	defaults, err := h.loadVCSDeliveryDefaults(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read CI tracking defaults")
		return
	}
	writeJSON(w, http.StatusOK, defaults)
}

func (h *Handler) SaveVCSDeliveryDefaults(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	ws, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	var req struct {
		Enabled *bool              `json:"enabled"`
		Rules   *vcs.DeliveryRules `json:"rules"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req) != nil || req.Enabled == nil || req.Rules == nil {
		writeError(w, http.StatusBadRequest, "invalid CI tracking defaults")
		return
	}
	defaults := vcsDeliveryDefaults{Enabled: *req.Enabled, Rules: *req.Rules}
	defaults.Rules.AutoDiscover = true
	if err := defaults.Rules.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	raw, _ := json.Marshal(defaults)
	if _, err := h.Queries.SaveVCSDeliveryDefaults(r.Context(), db.SaveVCSDeliveryDefaultsParams{
		WorkspaceID: ws, Defaults: raw,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save CI tracking defaults")
		return
	}
	writeJSON(w, http.StatusOK, defaults)
}

func deliveryInheritsDefaults(raw []byte) bool {
	var rules struct {
		Inherit bool `json:"inherit_defaults"`
	}
	_ = json.Unmarshal(raw, &rules)
	return rules.Inherit
}

func (h *Handler) resolveDeliveryRepository(ctx context.Context, ws pgtype.UUID, remote string) (db.VcsDeliveryProject, error) {
	var empty db.VcsDeliveryProject
	defaults, err := h.loadVCSDeliveryDefaults(ctx, ws)
	if err != nil {
		return empty, errors.New("could not load CI tracking defaults")
	}
	if !defaults.Enabled {
		return empty, errors.New("automatic repository tracking is disabled in workspace settings")
	}
	connections, err := h.Queries.ListVCSConnectionsByWorkspace(ctx, ws)
	if err != nil {
		return empty, errors.New("could not load GitLab connections")
	}
	var matches []db.VcsConnection
	var projectPath string
	for _, conn := range connections {
		if path, ok := vcs.RepositoryProject(remote, conn.InstanceUrl); conn.Provider == "gitlab" && ok {
			matches = append(matches, conn)
			projectPath = path
		}
	}
	if len(matches) != 1 {
		return empty, errors.New("repository must match exactly one GitLab connection in this workspace")
	}
	conn := matches[0]
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil {
		return empty, errors.New("could not open GitLab credential")
	}
	id, path, err := (vcs.GitLabDeliveryClient{InstanceURL: conn.InstanceUrl, Token: token}).ResolveProject(ctx, projectPath)
	if err != nil {
		return empty, err
	}
	return h.Queries.EnsureVCSDeliveryProject(ctx, db.EnsureVCSDeliveryProjectParams{
		WorkspaceID: ws, ID: conn.ID, ProjectID: id, ProjectPath: path,
	})
}
