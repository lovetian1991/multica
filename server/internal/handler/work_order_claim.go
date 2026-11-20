package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) applyWorkOrderToClaim(ctx context.Context, resp *AgentTaskResponse) {
	if resp.IssueID == "" || resp.WorkspaceID == "" {
		return
	}
	issueID, err := parseUUIDLoose(resp.IssueID)
	if err != nil {
		return
	}
	workspaceID, err := parseUUIDLoose(resp.WorkspaceID)
	if err != nil {
		return
	}
	for depth := 0; depth < 64; depth++ {
		order, err := h.Queries.GetWorkOrderByIssue(ctx, db.GetWorkOrderByIssueParams{
			IssueID: issueID, WorkspaceID: workspaceID,
		})
		if err == nil {
			var plan workorder.Plan
			if json.Unmarshal(order.ExecutionPlan, &plan) != nil || len(plan.Repos) == 0 {
				resp.WorkOrderError = "work order execution manifest is missing or invalid"
				return
			}
			plan.PersonalFork = true
			resp.WorkOrderPlan, err = json.Marshal(plan)
			if err != nil {
				resp.WorkOrderError = "failed to encode work order execution manifest"
				return
			}
			resp.Repos = []RepoData{}
			resp.ProjectResources = nil
			for _, repo := range plan.Repos {
				resp.Repos = append(resp.Repos, RepoData{URL: repo.RepoURL, Ref: repo.Ref})
			}
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			resp.WorkOrderError = "failed to load work order execution manifest"
			return
		}
		issue, err := h.Queries.GetIssue(ctx, issueID)
		if err != nil || issue.WorkspaceID != workspaceID {
			resp.WorkOrderError = "failed to load issue product execution context"
			return
		}
		if resp.ProductVersionID == "" && issue.ProductVersionID.Valid &&
			(resp.ProductID == "" || resp.ProductID == uuidToString(issue.ProductID)) {
			resp.ProductVersionID = uuidToString(issue.ProductVersionID)
			resp.ProductID = uuidToString(issue.ProductID)
		}
		if !issue.ParentIssueID.Valid {
			return
		}
		issueID = issue.ParentIssueID
	}
	resp.WorkOrderError = "issue ancestry exceeds the work order execution limit"
}

func (h *Handler) applyProductCodeToClaim(ctx context.Context, resp *AgentTaskResponse) {
	if len(resp.WorkOrderPlan) > 0 || resp.WorkOrderError != "" || strings.TrimSpace(resp.ProductVersionID) == "" {
		return
	}
	// Workspace defaults must never survive a failed product baseline resolution.
	resp.Repos = []RepoData{}
	resources := resp.ProjectResources
	resp.ProjectResources = nil
	for _, resource := range resources {
		if resource.ResourceType != "github_repo" && resource.ResourceType != "local_directory" {
			resp.ProjectResources = append(resp.ProjectResources, resource)
		}
	}
	fail := func(err error) {
		resp.WorkOrderError = "failed to resolve product version repositories: " + err.Error()
	}
	load := func(ctx context.Context, id string) (workorder.Version, error) {
		version, err := h.loadWorkOrderVersion(ctx, id)
		if err == nil && id == resp.ProductVersionID && resp.ProductID != "" && version.ProductID != resp.ProductID {
			return version, fmt.Errorf("selected version does not belong to the selected product")
		}
		return version, err
	}
	plan, err := workorder.Resolve(ctx, resp.ProductVersionID, "", nil, nil, load)
	if err != nil {
		fail(err)
		return
	}
	plan.PersonalFork = true
	// Explicit project repositories override the matching product baseline only.
	for _, resource := range resources {
		if resource.ResourceType != "github_repo" {
			continue
		}
		var repo RepoData
		if err := json.Unmarshal(resource.ResourceRef, &repo); err != nil || !workorder.ValidateRef(repo.Ref) {
			fail(fmt.Errorf("project repository requires an explicit valid branch, tag or SHA"))
			return
		}
		matched := false
		for i := range plan.Repos {
			if strings.TrimSuffix(plan.Repos[i].RepoURL, ".git") == strings.TrimSuffix(repo.URL, ".git") {
				plan.Repos[i].Ref, plan.Repos[i].RefSource = repo.Ref, "ticket"
				matched = true
			}
		}
		if !matched {
			fail(fmt.Errorf("project repository does not match the product version configuration"))
			return
		}
	}
	data, err := json.Marshal(plan)
	if err != nil {
		fail(err)
		return
	}
	resp.WorkOrderPlan = data
	for _, repo := range plan.Repos {
		resp.Repos = append(resp.Repos, RepoData{URL: repo.RepoURL, Ref: repo.Ref})
	}
}
