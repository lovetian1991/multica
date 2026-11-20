package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func deliveryIntegrationTarget(repos []RepoData, instance, projectPath string) (string, error) {
	target := ""
	for _, repo := range repos {
		path, ok := vcs.RepositoryProject(repo.URL, instance)
		if !ok || path != projectPath {
			continue
		}
		if !workorder.ValidateRef(repo.Ref) {
			return "", errors.New("configured repository requires an explicit valid target branch")
		}
		if target != "" && target != repo.Ref {
			return "", errors.New("repository has multiple configured version branches; resolve the ambiguity before merging")
		}
		target = repo.Ref
	}
	if target == "" {
		return "", errors.New("no matching product version or project target branch is configured; main is never selected automatically")
	}
	return target, nil
}

func (h *Handler) integrationRepos(ctx context.Context, issue db.Issue) ([]RepoData, error) {
	project, err := h.resolveClaimProjectContext(ctx, issue.ProjectID, issue.WorkspaceID)
	if err != nil {
		return nil, err
	}
	resp := AgentTaskResponse{IssueID: uuidToString(issue.ID), WorkspaceID: uuidToString(issue.WorkspaceID)}
	project.applyTo(&resp)
	if issue.ProductID.Valid {
		resp.ProductID = uuidToString(issue.ProductID)
	}
	if issue.ProductVersionID.Valid {
		resp.ProductVersionID = uuidToString(issue.ProductVersionID)
	}
	inheritClaimProductFromProject(&resp, project)
	h.applyWorkOrderToClaim(ctx, &resp)
	h.applyProductCodeToClaim(ctx, &resp)
	if resp.WorkOrderError != "" {
		return nil, errors.New(resp.WorkOrderError)
	}
	if len(resp.WorkOrderPlan) > 0 {
		return resp.Repos, nil
	}
	// Workspace repository hints alone are not authority to merge a product.
	var repos []RepoData
	for _, resource := range resp.ProjectResources {
		if resource.ResourceType == "github_repo" {
			var repo RepoData
			if json.Unmarshal(resource.ResourceRef, &repo) == nil {
				repos = append(repos, repo)
			}
		}
	}
	return repos, nil
}

// A preview has no provider-side effects. Merging requires the exact target
// shown by the preview, while the source identity always comes from storage.
func (h *Handler) IntegrateIssueDelivery(w http.ResponseWriter, r *http.Request) {
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
	if issue.Status == "cancelled" {
		writeError(w, http.StatusConflict, "cancelled issues cannot be integrated")
		return
	}
	var req struct {
		Merge     bool   `json:"merge"`
		TargetRef string `json:"target_ref"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&req) != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	source, err := h.Queries.GetIssueVCSDelivery(r.Context(), db.GetIssueVCSDeliveryParams{
		ID: id, WorkspaceID: issue.WorkspaceID, IssueID: issue.ID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "delivery not found")
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), source.ConnectionID)
	if err != nil || conn.WorkspaceID != issue.WorkspaceID || conn.Provider != "gitlab" {
		writeError(w, http.StatusConflict, "delivery GitLab connection is unavailable")
		return
	}
	repos, err := h.integrationRepos(r.Context(), issue)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	target, err := deliveryIntegrationTarget(repos, conn.InstanceUrl, source.ProjectPath)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if source.Ref == target || !deliverySHA.MatchString(source.Sha) {
		writeError(w, http.StatusConflict, "delivery is already on the configured target or has no verified commit")
		return
	}
	plan := vcs.DeliveryIntegration{SourceRef: source.Ref, SourceSHA: source.Sha, TargetRef: target, State: "preview", SourceCleanup: "retained"}
	if !req.Merge {
		writeJSON(w, http.StatusOK, map[string]any{"integration": plan})
		return
	}
	if req.TargetRef != target {
		writeError(w, http.StatusConflict, "confirm the current configured target branch before merging")
		return
	}
	var rules vcs.DeliveryRules
	if json.Unmarshal(source.Rules, &rules) != nil || rules.Validate() != nil {
		writeError(w, http.StatusConflict, "delivery CI rules are invalid")
		return
	}
	rules.PipelineSource = "push"
	token, err := h.openVCSSecret(conn.AccessTokenEncrypted)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not open GitLab credential")
		return
	}
	mergeCtx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	plan, err = (vcs.GitLabDeliveryClient{InstanceURL: conn.InstanceUrl, Token: token}).MergeDelivery(
		mergeCtx, source.ProjectID, plan, fmt.Sprintf("%s [Multica delivery]", issue.Title))
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if plan.State != "merged" {
		writeJSON(w, http.StatusOK, map[string]any{"integration": plan})
		return
	}
	if !deliverySHA.MatchString(plan.MergeSHA) {
		writeError(w, http.StatusBadGateway, "merge completed but GitLab did not return a full integration commit; retry this delivery to recover tracking")
		return
	}
	rawRules, _ := json.Marshal(rules)
	result, _ := json.Marshal(map[string]any{"integration": plan})
	d, err := h.Queries.RegisterVCSDelivery(r.Context(), db.RegisterVCSDeliveryParams{
		WorkspaceID: issue.WorkspaceID, IssueID: issue.ID, ProjectConfigID: source.ProjectConfigID,
		Rules: rawRules, Sha: strings.ToLower(plan.MergeSHA), Ref: target, Result: result,
		DeadlineAt: pgtype.Timestamptz{Time: time.Now().Add(time.Duration(rules.TimeoutMinutes) * time.Minute), Valid: true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "merge completed but CI tracking was not saved; retry this delivery to recover tracking")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"integration": plan, "delivery": deliveryResponse(d)})
}
