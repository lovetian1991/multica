package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func (h *Handler) requireVCSDelivery(w http.ResponseWriter) bool {
	if !h.isVCSAvailable() {
		writeError(w, http.StatusNotFound, "vcs integration is unavailable")
		return false
	}
	if !h.isVCSConfigured() {
		writeFeatureDisabled(w, "vcs_not_configured", "vcs integration is not configured")
		return false
	}
	return true
}

func deliveryProjectResponse(p db.VcsDeliveryProject, instanceURL string) map[string]any {
	return map[string]any{
		"id": uuidToString(p.ID), "connection_id": uuidToString(p.ConnectionID),
		"instance_url": instanceURL,
		"project_id":   p.ProjectID, "project_path": p.ProjectPath, "rules": json.RawMessage(p.Rules),
	}
}

func deliveryResponse(d db.VcsDelivery) map[string]any {
	return map[string]any{
		"id": uuidToString(d.ID), "project_config_id": uuidToString(d.ProjectConfigID),
		"project_path": d.ProjectPath, "sha": d.Sha, "ref": d.Ref,
		"status": d.Status, "result": json.RawMessage(d.Result),
		"created_at": timestampToString(d.CreatedAt), "updated_at": timestampToString(d.UpdatedAt),
		"terminal": d.NotifiedAt.Valid,
	}
}

func (h *Handler) ListVCSDeliveryProjects(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	ws, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListVCSDeliveryProjects(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list delivery projects")
		return
	}
	connections, err := h.Queries.ListVCSConnectionsByWorkspace(r.Context(), ws)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load delivery connections")
		return
	}
	instances := make(map[pgtype.UUID]string, len(connections))
	for _, conn := range connections {
		instances[conn.ID] = conn.InstanceUrl
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, deliveryProjectResponse(row, instances[row.ConnectionID]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}

func (h *Handler) SaveVCSDeliveryProject(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	ws, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	var req struct {
		ConnectionID string            `json:"connection_id"`
		ProjectID    int64             `json:"project_id"`
		Rules        vcs.DeliveryRules `json:"rules"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	connID, ok := parseUUIDOrBadRequest(w, req.ConnectionID, "connection_id")
	if !ok {
		return
	}
	if req.ProjectID <= 0 {
		writeError(w, http.StatusBadRequest, "project_id must be positive")
		return
	}
	if err := req.Rules.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), connID)
	if err != nil || conn.WorkspaceID != ws || conn.Provider != "gitlab" {
		writeError(w, http.StatusNotFound, "GitLab connection not found")
		return
	}
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not decrypt GitLab credential")
		return
	}
	client := vcs.GitLabDeliveryClient{InstanceURL: conn.InstanceUrl, Token: token}
	projectPath, err := client.Project(r.Context(), req.ProjectID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	rules, _ := json.Marshal(req.Rules)
	p, err := h.Queries.UpsertVCSDeliveryProject(r.Context(), db.UpsertVCSDeliveryProjectParams{
		WorkspaceID: ws, ID: connID, ProjectID: req.ProjectID, ProjectPath: projectPath, Rules: rules,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save delivery project")
		return
	}
	writeJSON(w, http.StatusOK, deliveryProjectResponse(p, conn.InstanceUrl))
}

func (h *Handler) DeleteVCSDeliveryProject(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	ws, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "projectId"), "project id")
	if !ok {
		return
	}
	if err := h.Queries.DeleteVCSDeliveryProject(r.Context(), db.DeleteVCSDeliveryProjectParams{ID: id, WorkspaceID: ws}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete delivery project")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListIssueDeliveries(w http.ResponseWriter, r *http.Request) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if !h.isVCSAvailable() || !h.isVCSConfigured() {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "deliveries": []any{}})
		return
	}
	rows, err := h.Queries.ListIssueVCSDeliveries(r.Context(), db.ListIssueVCSDeliveriesParams{
		WorkspaceID: issue.WorkspaceID, IssueID: issue.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list deliveries")
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, deliveryResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": true, "deliveries": out})
}

var deliverySHA = regexp.MustCompile(`^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$`)

func (h *Handler) RegisterIssueDelivery(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	var req struct {
		ProjectConfigID string `json:"project_config_id"`
		SHA             string `json:"sha"`
		Ref             string `json:"ref"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	id, ok := parseUUIDOrBadRequest(w, req.ProjectConfigID, "project_config_id")
	if !ok {
		return
	}
	req.SHA, req.Ref = strings.TrimSpace(req.SHA), strings.TrimSpace(req.Ref)
	if !deliverySHA.MatchString(req.SHA) || req.Ref == "" || len(req.Ref) > 255 || strings.ContainsAny(req.Ref, "\r\n\x00") {
		writeError(w, http.StatusBadRequest, "full commit sha and ref are required")
		return
	}
	p, err := h.Queries.GetVCSDeliveryProject(r.Context(), db.GetVCSDeliveryProjectParams{ID: id, WorkspaceID: issue.WorkspaceID})
	if err != nil {
		writeError(w, http.StatusNotFound, "delivery project not found")
		return
	}
	var rules vcs.DeliveryRules
	if json.Unmarshal(p.Rules, &rules) != nil || rules.Validate() != nil {
		writeError(w, http.StatusConflict, "delivery project rules are invalid")
		return
	}
	d, err := h.Queries.RegisterVCSDelivery(r.Context(), db.RegisterVCSDeliveryParams{
		WorkspaceID: issue.WorkspaceID, IssueID: issue.ID, ProjectConfigID: p.ID,
		Sha: strings.ToLower(req.SHA), Ref: req.Ref,
		DeadlineAt: pgtype.Timestamptz{Time: time.Now().Add(time.Duration(rules.TimeoutMinutes) * time.Minute), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "delivery project or connection no longer exists")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register delivery")
		return
	}
	writeJSON(w, http.StatusOK, deliveryResponse(d))
}

// Resume tracking only; never retries a GitLab job or clicks a manual action.
func (h *Handler) RetryIssueDelivery(w http.ResponseWriter, r *http.Request) {
	if !h.requireVCSDelivery(w) {
		return
	}
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "deliveryId"), "delivery id")
	if !ok {
		return
	}
	d, err := h.Queries.RetryVCSDelivery(r.Context(), db.RetryVCSDeliveryParams{
		ID: id, WorkspaceID: issue.WorkspaceID, IssueID: issue.ID,
		DeadlineAt: pgtype.Timestamptz{Time: time.Now().Add(2 * time.Hour), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "delivery not found or already tracking")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resume tracking")
		return
	}
	writeJSON(w, http.StatusOK, deliveryResponse(d))
}

func (h *Handler) TickVCSDeliveries(ctx context.Context) error {
	if !h.isVCSAvailable() || !h.isVCSConfigured() {
		return nil
	}
	rows, err := h.Queries.ListDueVCSDeliveries(ctx)
	if err != nil {
		return err
	}
	for _, d := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := h.pollVCSDelivery(ctx, d); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	return nil
}

func (h *Handler) pollVCSDelivery(ctx context.Context, d db.VcsDelivery) error {
	var result vcs.DeliveryResult
	_ = json.Unmarshal(d.Result, &result)
	result.PipelineID = d.PipelineID
	status := d.Status
	if !vcs.DeliveryTerminal(status) {
		switch {
		case time.Now().After(d.DeadlineAt.Time):
			status, result.Reason = "timed_out", "Tracking deadline reached. Resume tracking after checking GitLab."
		default:
			var rules vcs.DeliveryRules
			conn, err := h.Queries.GetVCSConnectionByID(ctx, d.ConnectionID)
			if err != nil {
				return err
			}
			if conn.WorkspaceID != d.WorkspaceID || conn.Provider != "gitlab" {
				status, result.Reason = "blocked", "Delivery connection is no longer a GitLab connection in this workspace."
				break
			}
			token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
			if err != nil {
				status, result.Reason = "blocked", "GitLab credential could not be opened. Reconfigure the connection before resuming tracking."
				break
			}
			if json.Unmarshal(d.Rules, &rules) != nil || rules.Validate() != nil {
				status, result.Reason = "blocked", "Invalid delivery rules."
				break
			}
			pollCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
			nextStatus, nextResult, checkErr := (vcs.GitLabDeliveryClient{InstanceURL: conn.InstanceUrl, Token: token}).Check(
				pollCtx, d.ProjectID, d.Sha, d.Ref, d.PipelineID, rules,
			)
			cancel()
			if checkErr != nil {
				if nextResult.PipelineID > 0 {
					result.PipelineID = nextResult.PipelineID
				}
				result.Reason = checkErr.Error()
				status = "retrying"
				if errors.Is(checkErr, vcs.ErrUnauthorized) {
					status = "blocked"
				}
			} else {
				status, result = nextStatus, nextResult
			}
		}
	}
	b, _ := json.Marshal(result)
	params := db.UpdateVCSDeliveryParams{
		ID: d.ID, WorkspaceID: d.WorkspaceID, PipelineID: result.PipelineID, Status: status, Result: b,
	}
	if !vcs.DeliveryTerminal(status) {
		_, err := h.Queries.UpdateVCSDelivery(ctx, params)
		return err
	}
	starter, ok := h.DB.(txStarter)
	if !ok {
		return errors.New("delivery notification requires transactions")
	}
	tx, err := starter.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	if _, err = q.UpdateVCSDelivery(ctx, params); err != nil {
		return err
	}
	if _, err = q.MarkVCSDeliveryNotified(ctx, db.MarkVCSDeliveryNotifiedParams{ID: d.ID, WorkspaceID: d.WorkspaceID}); err != nil {
		return err
	}
	content := fmt.Sprintf("GitLab delivery: %s\nProject: %s\nCommit: %s\nRef: %s", status, d.ProjectPath, d.Sha, d.Ref)
	if result.PipelineURL != "" {
		content += "\nPipeline: " + result.PipelineURL
	}
	if result.JobURL != "" {
		content += "\nJob: " + result.JobURL
	}
	if result.DeploymentURL != "" {
		content += "\nDeployment: " + result.DeploymentURL + "\nAwaiting user acceptance; CI success is not business acceptance."
	}
	if result.Reason != "" {
		content += "\n" + result.Reason
	}
	created, err := q.CreateComment(ctx, db.CreateCommentParams{
		ID: dbid.NewV7(), IssueID: d.IssueID, WorkspaceID: d.WorkspaceID,
		AuthorType: "system", AuthorID: pgtype.UUID{Valid: true}, Content: content, Type: "system",
	})
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	c := created.Comment()
	// Publish directly, without user-comment dispatch or agent mentions.
	h.publish(protocol.EventCommentCreated, uuidToString(d.WorkspaceID), "system", "", map[string]any{
		"comment": map[string]any{
			"id": uuidToString(c.ID), "issue_id": uuidToString(c.IssueID), "author_type": c.AuthorType,
			"author_id": uuidToString(c.AuthorID), "content": c.Content, "type": c.Type, "revision": c.Revision,
		}, "issue_revision": created.IssueRevision,
	})
	return nil
}
