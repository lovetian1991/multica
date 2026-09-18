package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func insertBoundProduct(t *testing.T, name string) (productID, versionID string) {
	t.Helper()
	productID = dbfx.Insert(t, "product", testutil.Cols{
		"name":        name,
		"description": "Repo lives at G:/aicode/multica. Watch auth middleware.",
	})
	versionID = dbfx.Insert(t, "product_version", testutil.Cols{
		"product_id": productID,
		"name":       "8.6.0.0",
		"directory":  "G:/aicode/multica",
		"remark":     "Main line. Do not touch generated sqlc files.",
		"folder_id":  "",
		"enabled":    true,
	})
	return productID, versionID
}

func TestCreateProjectStoresProductVersion(t *testing.T) {
	productID, versionID := insertBoundProduct(t, "Bound Product")

	w := httptest.NewRecorder()
	testHandler.CreateProject(w, newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title":              "zzbindprod project",
		"product_id":         productID,
		"product_version_id": versionID,
	}))
	created := decodeProject(t, w, http.StatusCreated)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, created.ID)
	})
	if created.ProductID == nil || *created.ProductID != productID {
		t.Fatalf("create product_id = %v, want %s", created.ProductID, productID)
	}
	if created.ProductVersionID == nil || *created.ProductVersionID != versionID {
		t.Fatalf("create product_version_id = %v, want %s", created.ProductVersionID, versionID)
	}

	w = httptest.NewRecorder()
	getReq := withURLParam(newRequest("GET", "/api/projects/"+created.ID, nil), "id", created.ID)
	testHandler.GetProject(w, getReq)
	got := decodeProject(t, w, http.StatusOK)
	if got.ProductID == nil || *got.ProductID != productID || got.ProductVersionID == nil || *got.ProductVersionID != versionID {
		t.Fatalf("get binding = (%v, %v), want (%s, %s)", got.ProductID, got.ProductVersionID, productID, versionID)
	}

	w = httptest.NewRecorder()
	testHandler.SearchProjects(w, newRequest("GET", "/api/projects/search?q=zzbindprod", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("search status = %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Projects []SearchProjectResponse `json:"projects"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode search: %v", err)
	}
	var found *SearchProjectResponse
	for i := range resp.Projects {
		if resp.Projects[i].ID == created.ID {
			found = &resp.Projects[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("created project not in search results: %s", w.Body.String())
	}
	if found.ProductID == nil || *found.ProductID != productID {
		t.Fatalf("search product_id = %v, want %s", found.ProductID, productID)
	}
	if found.ProductVersionID == nil || *found.ProductVersionID != versionID {
		t.Fatalf("search product_version_id = %v, want %s", found.ProductVersionID, versionID)
	}

	w = httptest.NewRecorder()
	clearReq := withURLParam(newRequest("PUT", "/api/projects/"+created.ID, map[string]any{
		"product_id":         "",
		"product_version_id": "",
	}), "id", created.ID)
	testHandler.UpdateProject(w, clearReq)
	cleared := decodeProject(t, w, http.StatusOK)
	if cleared.ProductID != nil || cleared.ProductVersionID != nil {
		t.Fatalf("clear binding = (%v, %v), want (nil, nil)", cleared.ProductID, cleared.ProductVersionID)
	}
}

func TestCreateIssueInheritsProjectProductVersion(t *testing.T) {
	productID, versionID := insertBoundProduct(t, "Issue Bound Product")
	w := httptest.NewRecorder()
	testHandler.CreateProject(w, newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title":              "zzbindissue project",
		"product_id":         productID,
		"product_version_id": versionID,
	}))
	project := decodeProject(t, w, http.StatusCreated)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, project.ID)
	})

	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":      "inherits project product",
		"project_id": project.ID,
	})
	created := testutil.Call(t, testHandler.CreateIssue, req).Want(http.StatusCreated)
	var issue IssueResponse
	if err := json.NewDecoder(created.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() {
		cleanupReq := withURLParam(newRequest("DELETE", "/api/issues/"+issue.ID, nil), "id", issue.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	})
	if issue.ProductID == nil || *issue.ProductID != productID {
		t.Fatalf("issue product_id = %v, want %s", issue.ProductID, productID)
	}
	if issue.ProductVersionID == nil || *issue.ProductVersionID != versionID {
		t.Fatalf("issue product_version_id = %v, want %s", issue.ProductVersionID, versionID)
	}
}

func TestCreateIssueEmptyProductInheritsFromProject(t *testing.T) {
	productID, versionID := insertBoundProduct(t, "Empty String Product")
	w := httptest.NewRecorder()
	testHandler.CreateProject(w, newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title":              "zzbindempty project",
		"product_id":         productID,
		"product_version_id": versionID,
	}))
	project := decodeProject(t, w, http.StatusCreated)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, project.ID)
	})

	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":              "empty product strings inherit",
		"project_id":         project.ID,
		"product_id":         "",
		"product_version_id": "",
	})
	created := testutil.Call(t, testHandler.CreateIssue, req).Want(http.StatusCreated)
	var issue IssueResponse
	if err := json.NewDecoder(created.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() {
		cleanupReq := withURLParam(newRequest("DELETE", "/api/issues/"+issue.ID, nil), "id", issue.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	})
	if issue.ProductID == nil || *issue.ProductID != productID {
		t.Fatalf("issue product_id = %v, want %s", issue.ProductID, productID)
	}
	if issue.ProductVersionID == nil || *issue.ProductVersionID != versionID {
		t.Fatalf("issue product_version_id = %v, want %s", issue.ProductVersionID, versionID)
	}
}

func TestCreateIssueExplicitProductDoesNotInherit(t *testing.T) {
	projectProductID, projectVersionID := insertBoundProduct(t, "Project Product")
	issueProductID, issueVersionID := insertBoundProduct(t, "Issue Product")
	w := httptest.NewRecorder()
	testHandler.CreateProject(w, newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title":              "zzbindexplicit project",
		"product_id":         projectProductID,
		"product_version_id": projectVersionID,
	}))
	project := decodeProject(t, w, http.StatusCreated)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, project.ID)
	})

	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":              "keeps explicit product",
		"project_id":         project.ID,
		"product_id":         issueProductID,
		"product_version_id": issueVersionID,
	})
	created := testutil.Call(t, testHandler.CreateIssue, req).Want(http.StatusCreated)
	var issue IssueResponse
	if err := json.NewDecoder(created.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() {
		cleanupReq := withURLParam(newRequest("DELETE", "/api/issues/"+issue.ID, nil), "id", issue.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	})
	if issue.ProductID == nil || *issue.ProductID != issueProductID {
		t.Fatalf("issue product_id = %v, want %s", issue.ProductID, issueProductID)
	}
	if issue.ProductVersionID == nil || *issue.ProductVersionID != issueVersionID {
		t.Fatalf("issue product_version_id = %v, want %s", issue.ProductVersionID, issueVersionID)
	}
}

func TestCreateIssueWithoutProjectBindingLeavesProductUnset(t *testing.T) {
	w := httptest.NewRecorder()
	testHandler.CreateProject(w, newRequest("POST", "/api/projects?workspace_id="+testWorkspaceID, map[string]any{
		"title": "zzbindnone project",
	}))
	project := decodeProject(t, w, http.StatusCreated)
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM project WHERE id = $1`, project.ID)
	})

	req := newRequest("POST", "/api/issues?workspace_id="+testWorkspaceID, map[string]any{
		"title":      "no product on project",
		"project_id": project.ID,
	})
	created := testutil.Call(t, testHandler.CreateIssue, req).Want(http.StatusCreated)
	var issue IssueResponse
	if err := json.NewDecoder(created.Body).Decode(&issue); err != nil {
		t.Fatalf("decode issue: %v", err)
	}
	t.Cleanup(func() {
		cleanupReq := withURLParam(newRequest("DELETE", "/api/issues/"+issue.ID, nil), "id", issue.ID)
		testHandler.DeleteIssue(httptest.NewRecorder(), cleanupReq)
	})
	if issue.ProductID != nil || issue.ProductVersionID != nil {
		t.Fatalf("issue binding = (%v, %v), want (nil, nil)", issue.ProductID, issue.ProductVersionID)
	}
}
