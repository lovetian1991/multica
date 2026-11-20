package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/workorder"
)

func TestProductCodeClaim(t *testing.T) {
	if testHandler == nil {
		t.Fatal("database is required for product code claim regression tests")
	}
	ctx := context.Background()
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name(), "slug": "claim-product"})
	version := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "V9", "enabled": true})
	const repoURL = "https://git.example.test/opencontent.git"
	newClaim := func() AgentTaskResponse {
		return AgentTaskResponse{
			ProductID: product, ProductVersionID: version,
			Repos: []RepoData{{URL: repoURL, Ref: "main"}},
		}
	}
	t.Run("missing configuration stops instead of using main", func(t *testing.T) {
		claim := newClaim()
		testHandler.applyProductVersionToClaim(ctx, "test", &claim)
		if claim.WorkOrderError == "" || len(claim.Repos) != 0 || len(claim.WorkOrderPlan) != 0 {
			t.Fatalf("missing configuration retained a fallback: %+v", claim)
		}
	})
	dbfx.InsertNoID(t, "product_version_code", testutil.Cols{
		"version_id": version,
		"config":     `{"modules":[{"key":"app","repo_url":"` + repoURL + `","ref":"prod-9.1.0.0"}],"dependencies":[]}`,
	}, "version_id=$1", version)
	t.Run("ordinary product task uses product branch", func(t *testing.T) {
		issue := dbfx.Issue(t, "Product task without project", testutil.Cols{"product_id": product, "product_version_id": version})
		claim := newClaim()
		claim.IssueID, claim.WorkspaceID = issue, testWorkspaceID
		testHandler.applyProductVersionToClaim(ctx, "test", &claim)
		var plan workorder.Plan
		if err := json.Unmarshal(claim.WorkOrderPlan, &plan); err != nil {
			t.Fatalf("no execution plan: %s (%v)", claim.WorkOrderError, err)
		}
		if claim.WorkOrderError != "" || len(plan.Repos) != 1 || plan.Repos[0].Ref != "prod-9.1.0.0" ||
			plan.Repos[0].BaseRef != "prod-9.1.0.0" || claim.Repos[0].Ref != "prod-9.1.0.0" {
			t.Fatalf("wrong product baseline: %+v %+v", claim, plan)
		}
		child := dbfx.Issue(t, "Product child", testutil.Cols{"parent_issue_id": issue})
		inherited := AgentTaskResponse{IssueID: child, WorkspaceID: testWorkspaceID}
		testHandler.applyProductVersionToClaim(ctx, "child", &inherited)
		if inherited.ProductVersionID != version || len(inherited.Repos) != 1 || inherited.Repos[0].Ref != "prod-9.1.0.0" {
			t.Fatalf("child lost product baseline: %+v", inherited)
		}
	})
	t.Run("runtime claim ships product execution plan", func(t *testing.T) {
		var agentID, runtimeID string
		dbfx.QueryRow(t, `SELECT id, runtime_id FROM agent WHERE workspace_id=$1 LIMIT 1`, testWorkspaceID).Scan(&agentID, &runtimeID)
		issue := dbfx.Issue(t, "Product runtime task", testutil.Cols{"product_id": product, "product_version_id": version})
		dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issue})
		req := withURLParam(newOwnerDaemonRequest(http.MethodPost, "/api/daemon/runtimes/"+runtimeID+"/claim", nil), "runtimeId", runtimeID)
		var response struct {
			Task *AgentTaskResponse `json:"task"`
		}
		testutil.Call(t, testHandler.ClaimTaskByRuntime, req).Want(http.StatusOK).JSON(&response)
		if response.Task == nil {
			t.Fatal("runtime did not receive a task")
		}
		claim := response.Task
		if claim.WorkOrderError != "" || len(claim.WorkOrderPlan) == 0 || len(claim.Repos) != 1 || claim.Repos[0].Ref != "prod-9.1.0.0" {
			t.Fatalf("runtime lost product code configuration: %+v", claim)
		}
	})
	t.Run("explicit project ref overrides baseline", func(t *testing.T) {
		claim := newClaim()
		claim.ProjectResources = []ProjectResourceData{{
			ResourceType: "github_repo",
			ResourceRef:  json.RawMessage(`{"url":"` + repoURL + `","ref":"proj-customer-v9"}`),
		}}
		testHandler.applyProductVersionToClaim(ctx, "test", &claim)
		if claim.WorkOrderError != "" || len(claim.Repos) != 1 || claim.Repos[0].Ref != "proj-customer-v9" {
			t.Fatalf("project override lost: %+v", claim)
		}
	})
	t.Run("project ref cannot default to main", func(t *testing.T) {
		claim := newClaim()
		claim.ProjectResources = []ProjectResourceData{{
			ResourceType: "github_repo", ResourceRef: json.RawMessage(`{"url":"` + repoURL + `"}`),
		}}
		testHandler.applyProductVersionToClaim(ctx, "test", &claim)
		if !strings.Contains(claim.WorkOrderError, "explicit valid branch") || len(claim.Repos) != 0 {
			t.Fatalf("project silently defaulted: %+v", claim)
		}
	})
	t.Run("frozen plan stays authoritative", func(t *testing.T) {
		claim := newClaim()
		claim.WorkOrderPlan = json.RawMessage(`{"repos":[{"ref":"frozen-release"}]}`)
		before := string(claim.WorkOrderPlan)
		testHandler.applyProductVersionToClaim(ctx, "test", &claim)
		if string(claim.WorkOrderPlan) != before {
			t.Fatalf("frozen manifest replaced: %s", claim.WorkOrderPlan)
		}
	})
	t.Run("unbound task keeps workspace behavior", func(t *testing.T) {
		claim := AgentTaskResponse{Repos: []RepoData{{URL: repoURL, Ref: "main"}}}
		testHandler.applyProductVersionToClaim(ctx, "test", &claim)
		if claim.WorkOrderError != "" || len(claim.Repos) != 1 || claim.Repos[0].Ref != "main" || len(claim.WorkOrderPlan) != 0 {
			t.Fatalf("unbound task changed: %+v", claim)
		}
	})
}
