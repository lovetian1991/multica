package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestWorkOrderCustomerProjectMaintenance(t *testing.T) {
	path := "/api/system/work-orders/projects"
	request := func(method, id string, body any) *http.Request {
		req := newRequest(method, path, body)
		if id != "" {
			req = withURLParam(req, "projectId", id)
		}
		return req
	}
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = nil
	t.Cleanup(func() { testHandler.cfg.SystemAdminEmails = previous })
	testutil.Call(t, testHandler.CreateCustomerProject, request(http.MethodPost, "", map[string]string{"name": t.Name()})).Want(http.StatusForbidden)
	testutil.Call(t, testHandler.RenameCustomerProject, request(http.MethodPatch, testWorkspaceID, map[string]string{"name": t.Name()})).Want(http.StatusForbidden)
	testutil.Call(t, testHandler.DeleteCustomerProject, request(http.MethodDelete, testWorkspaceID, nil)).Want(http.StatusForbidden)
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	for _, name := range []string{" ", strings.Repeat("x", 257)} {
		testutil.Call(t, testHandler.CreateCustomerProject, request(http.MethodPost, "", map[string]string{"name": name})).Want(http.StatusBadRequest)
	}
	var project struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	testutil.Call(t, testHandler.CreateCustomerProject, request(http.MethodPost, "", map[string]string{"name": "  " + t.Name() + "  "})).Want(http.StatusCreated).JSON(&project)
	dbfx.Cleanup(t, "DELETE FROM customer_project WHERE id=$1", project.ID)
	dbfx.Cleanup(t, "DELETE FROM work_order_project_branch WHERE project_id=$1", project.ID)
	if project.Name != t.Name() || project.ID == "" {
		t.Fatalf("invalid project: %+v", project)
	}
	testutil.Call(t, testHandler.CreateCustomerProject, request(http.MethodPost, "", map[string]string{"name": strings.ToLower(t.Name())})).Want(http.StatusConflict)
	duplicate := dbfx.Insert(t, "customer_project", testutil.Cols{"name": t.Name() + " other"})
	testutil.Call(t, testHandler.RenameCustomerProject, request(http.MethodPatch, project.ID, map[string]string{"name": t.Name() + " other"})).Want(http.StatusConflict)
	testutil.Call(t, testHandler.RenameCustomerProject, request(http.MethodPatch, "invalid", map[string]string{"name": "Name"})).Want(http.StatusBadRequest)
	testutil.Call(t, testHandler.DeleteCustomerProject, request(http.MethodDelete, testWorkspaceID, nil)).Want(http.StatusNotFound)
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name(), "slug": "test-customer-maintenance"})
	version := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "V1", "enabled": true})
	dbfx.InsertNoID(t, "product_version_code", testutil.Cols{
		"version_id": version, "config": `{"modules":[{"key":"main","repo_url":"https://git.example.test/main.git","ref":"legacy"}],"dependencies":[]}`,
	}, "version_id=$1", version)
	testutil.Call(t, testHandler.SaveWorkOrderProject, request(http.MethodPut, "", map[string]any{
		"project_id": project.ID, "version_id": version, "refs": map[string]string{version + "/main": "customer/v1"},
	})).Want(http.StatusOK)
	renamed := t.Name() + " renamed"
	testutil.Call(t, testHandler.RenameCustomerProject, request(http.MethodPatch, project.ID, map[string]string{"name": renamed})).Want(http.StatusOK).JSON(&project)
	row, err := testHandler.Queries.GetCustomerProject(context.Background(), parseUUID(project.ID))
	if err != nil || row.Name != renamed || row.ProductVersionID != parseUUID(version) ||
		dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1 AND ref='customer/v1'", project.ID) != 1 {
		t.Fatalf("rename changed version or branches: %+v %v", row, err)
	}
	order := seedWorkOrder(t, testUserID)
	edit := orderEdit(order)
	edit.ProductVersionID = version
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+order.ID, order.ID, "member", edit)).Want(http.StatusOK).JSON(&order)
	testutil.Call(t, testHandler.RegisterWorkOrderProject, orderRequest(http.MethodPost, "/api/work-orders/"+order.ID+"/project", order.ID, "member", map[string]any{
		"name": renamed, "updated_at": order.UpdatedAt,
	})).Want(http.StatusOK).JSON(&order)
	if order.CustomerProjectID != project.ID {
		t.Fatal("work order did not reuse the manually maintained project")
	}
	testutil.Call(t, testHandler.DeleteCustomerProject, request(http.MethodDelete, project.ID, nil)).Want(http.StatusConflict)
	if dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1", project.ID) != 1 {
		t.Fatal("failed deletion removed branch configuration")
	}
	edit = orderEdit(order)
	edit.CustomerProjectID = ""
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+order.ID, order.ID, "member", edit)).Want(http.StatusOK)
	testutil.Call(t, testHandler.DeleteCustomerProject, request(http.MethodDelete, project.ID, nil)).Want(http.StatusOK)
	if dbfx.Count(t, "SELECT count(*) FROM customer_project WHERE id=$1", project.ID) != 0 ||
		dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1", project.ID) != 0 ||
		dbfx.Count(t, "SELECT count(*) FROM customer_project WHERE id=$1", duplicate) != 1 {
		t.Fatal("deletion did not clean only the selected project and its branches")
	}
	testutil.Call(t, testHandler.DeleteCustomerProject, request(http.MethodDelete, project.ID, nil)).Want(http.StatusNotFound)
}

func TestWorkOrderProjectRegistrationAndVersionHistory(t *testing.T) {
	ctx := context.Background()
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name(), "slug": "test-project-registration"})
	version := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "V1", "enabled": true})
	next := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "V2", "enabled": true})
	dependencyProduct := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name() + " dependency", "slug": "test-project-dependency"})
	dependency := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": dependencyProduct, "name": "D1", "enabled": true})
	dbfx.InsertNoID(t, "product_version_code", testutil.Cols{
		"version_id": dependency, "config": `{"modules":[{"key":"lib","repo_url":"https://git.example.test/lib.git","ref":"legacy"}],"dependencies":[]}`,
	}, "version_id=$1", dependency)
	for _, id := range []string{version, next} {
		dependencies := []string{}
		if id == next {
			dependencies = append(dependencies, dependency)
		}
		config, err := json.Marshal(workorder.Config{
			Modules: []workorder.Module{
				{Key: "api", RepoURL: "https://git.example.test/api.git", Ref: "legacy"},
				{Key: "web", RepoURL: "https://git.example.test/web.git", Ref: "legacy"},
			},
			Dependencies: dependencies,
		})
		if err != nil {
			t.Fatal(err)
		}
		dbfx.InsertNoID(t, "product_version_code", testutil.Cols{
			"version_id": id, "config": string(config),
		}, "version_id=$1", id)
	}
	order := seedWorkOrder(t, testUserID)
	edit := orderEdit(order)
	edit.ProductVersionID = version
	edit.BranchOverrides = map[string]string{version + "/api": "customer/first"}
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+order.ID, order.ID, "member", edit)).Want(http.StatusOK).JSON(&order)
	register := func(o workOrderResponse, remember bool, want int, out *workOrderResponse) {
		t.Helper()
		call := testutil.Call(t, testHandler.RegisterWorkOrderProject, orderRequest(http.MethodPost, "/api/work-orders/"+o.ID+"/project", o.ID, "member", map[string]any{
			"name": t.Name(), "updated_at": o.UpdatedAt, "remember_refs": remember,
		})).Want(want)
		if out != nil {
			call.JSON(out)
		}
	}
	var registered workOrderResponse
	register(order, true, http.StatusOK, &registered)
	if registered.CustomerProjectID == "" {
		t.Fatal("confirmation did not register the project")
	}
	project := registered.CustomerProjectID
	dbfx.Cleanup(t, "DELETE FROM customer_project WHERE id=$1", project)
	dbfx.Cleanup(t, "DELETE FROM work_order_project_branch WHERE project_id=$1", project)
	register(order, true, http.StatusConflict, nil)
	assertProjectVersion := func(id string) {
		t.Helper()
		row, err := testHandler.Queries.GetCustomerProject(ctx, parseUUID(project))
		if err != nil || row.ProductVersionID != parseUUID(id) || row.ProductID != parseUUID(product) {
			t.Fatalf("project did not retain its product binding: %+v %v", row, err)
		}
	}
	assertProjectVersion(version)
	bindings, err := testHandler.Queries.ListWorkOrderProjectBranches(ctx, parseUUID(project))
	if err != nil || len(bindings) != 1 || bindings[0].ModuleKey != "api" {
		t.Fatalf("unconfigured modules should inherit the baseline: %+v %v", bindings, err)
	}
	otherOwner := dbfx.User(t, "Other project order", "other-project-order@multica.test")
	second := seedWorkOrder(t, otherOwner)
	temporary, err := json.Marshal(map[string]string{version + "/api": "order/temporary"})
	if err != nil {
		t.Fatal(err)
	}
	dbfx.Exec(t, "UPDATE work_order SET assignee_id=$2, product_version_id=$3, branch_overrides=$4 WHERE id=$1", second.ID, testUserID, version, string(temporary))
	row, err := testHandler.Queries.GetWorkOrder(ctx, db.GetWorkOrderParams{ID: parseUUID(second.ID), WorkspaceID: parseUUID(testWorkspaceID)})
	if err != nil {
		t.Fatal(err)
	}
	second = workOrderToResponse(row)
	var reused workOrderResponse
	register(second, false, http.StatusOK, &reused)
	if reused.CustomerProjectID != project || dbfx.Count(t, "SELECT count(*) FROM customer_project WHERE name=$1", t.Name()) != 1 {
		t.Fatal("the source project was imported more than once")
	}
	unchanged, err := testHandler.Queries.ListWorkOrderProjectBranches(ctx, parseUUID(project))
	if err != nil || len(unchanged) != 1 || unchanged[0].ID != bindings[0].ID || unchanged[0].Ref != "customer/first" {
		t.Fatalf("ticket-only overrides changed persistent project branches: %+v %v", unchanged, err)
	}
	var baseline workorder.Plan
	testutil.Call(t, testHandler.GetWorkOrderProjectBaseline, orderRequest(http.MethodGet, "/api/work-orders/project-baseline?version_id="+next, "", "member", nil)).Want(http.StatusOK).JSON(&baseline)
	if len(baseline.Repos) != 3 {
		t.Fatalf("project maintenance did not expand dependent modules: %+v", baseline)
	}
	save := func(id string, refs map[string]string, role string, want int) {
		t.Helper()
		testutil.Call(t, testHandler.SaveWorkOrderProject, orderRequest(http.MethodPut, "/api/work-orders/projects", "", role,
			map[string]any{"project_id": project, "version_id": id, "refs": refs})).Want(want)
	}
	save(next, map[string]string{next + "/api": "customer/second"}, "member", http.StatusForbidden)
	save(next, map[string]string{next + "/api": "customer/second"}, "admin", http.StatusForbidden)
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	t.Cleanup(func() { testHandler.cfg.SystemAdminEmails = previous })
	save(next, map[string]string{next + "/missing": "bad"}, "admin", http.StatusBadRequest)
	assertProjectVersion(version)
	save(next, map[string]string{next + "/api": "customer/second", dependency + "/lib": "customer/dependency"}, "admin", http.StatusOK)
	assertProjectVersion(next)
	var versionBranches struct {
		Projects []struct {
			ID       string `json:"id"`
			Branches []struct {
				VersionID string `json:"version_id"`
				ModuleKey string `json:"module_key"`
				Ref       string `json:"ref"`
			} `json:"branches"`
		} `json:"projects"`
		Total int `json:"total"`
	}
	testutil.Call(t, testHandler.ListWorkOrderVersionBranches,
		newRequest(http.MethodGet, "/api/system/work-orders/version-branches?version_id="+next, nil)).
		Want(http.StatusOK).JSON(&versionBranches)
	if versionBranches.Total != 1 || len(versionBranches.Projects) != 1 || versionBranches.Projects[0].ID != project ||
		len(versionBranches.Projects[0].Branches) != 2 {
		t.Fatalf("version branch overview = %+v", versionBranches)
	}
	refs := map[string]string{}
	for _, branch := range versionBranches.Projects[0].Branches {
		refs[branch.VersionID+"/"+branch.ModuleKey] = branch.Ref
	}
	if refs[next+"/api"] != "customer/second" || refs[dependency+"/lib"] != "customer/dependency" {
		t.Fatalf("version branch overview refs = %+v", refs)
	}
	register(reused, false, http.StatusOK, &reused)
	assertProjectVersion(next)
	if dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1", project) != 3 ||
		dbfx.Count(t, "SELECT count(*) FROM project_resource WHERE project_id=$1", project) != 0 {
		t.Fatal("switching versions overwrote historical branch resources")
	}
	save(version, map[string]string{}, "admin", http.StatusOK)
	if dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1 AND version_id=$2", project, version) != 0 ||
		dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1 AND version_id=$2", project, next) != 1 ||
		dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1 AND version_id=$2", project, dependency) != 1 {
		t.Fatal("restoring the baseline affected another version")
	}
	other := dbfx.Workspace(t, "Other project scope", "other-project-scope")
	dbfx.Member(t, other, testUserID, "owner")
	req := orderRequest(http.MethodPut, "/api/work-orders/projects", "", "admin",
		map[string]any{"project_id": project, "version_id": version, "refs": map[string]string{}})
	req = req.WithContext(middleware.SetMemberContext(req.Context(), other, db.Member{WorkspaceID: parseUUID(other), UserID: parseUUID(testUserID), Role: "admin"}))
	testutil.Call(t, testHandler.SaveWorkOrderProject, req).Want(http.StatusOK)
	testutil.Call(t, testHandler.SaveWorkOrderProject, newRequest(http.MethodPut, "/api/system/work-orders/projects",
		map[string]any{"project_id": project, "version_id": version, "refs": map[string]string{version + "/api": "shared/v1"}})).Want(http.StatusOK)
	var shared struct {
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	testutil.Call(t, testHandler.ListCustomerProjects, newRequest(http.MethodGet, "/api/system/work-orders/projects", nil)).Want(http.StatusOK).JSON(&shared)
	found := false
	for _, p := range shared.Projects {
		found = found || p.ID == project
	}
	if !found {
		t.Fatal("the global catalog required a workspace")
	}
	previousSetting, settingErr := testHandler.Queries.GetWorkOrderSetting(ctx)
	if _, err := testHandler.Queries.SaveWorkOrderSetting(ctx, "test-global-project-root"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if settingErr == nil {
			_, _ = testHandler.Queries.SaveWorkOrderSetting(ctx, previousSetting.KbRootID)
		} else {
			dbfx.Exec(t, "DELETE FROM work_order_setting")
		}
	})
	for _, workspace := range []string{testWorkspaceID, other} {
		orderID := dbfx.Insert(t, "work_order", testutil.Cols{
			"workspace_id": workspace, "external_id": t.Name() + workspace, "title": "Shared project order",
			"assignee_id": testUserID, "created_by": testUserID, "updated_by": testUserID,
		})
		dbfx.Cleanup(t, "DELETE FROM work_order_event WHERE work_order_id=$1", orderID)
		row, err := testHandler.Queries.GetWorkOrder(ctx, db.GetWorkOrderParams{ID: parseUUID(orderID), WorkspaceID: parseUUID(workspace)})
		if err != nil {
			t.Fatal(err)
		}
		edit := orderEdit(workOrderToResponse(row))
		edit.ProductVersionID, edit.CustomerProjectID = version, project
		request := orderRequest(http.MethodPut, "/api/work-orders/"+orderID, orderID, "member", edit)
		request = request.WithContext(middleware.SetMemberContext(request.Context(), workspace, db.Member{WorkspaceID: parseUUID(workspace), UserID: parseUUID(testUserID), Role: "member"}))
		testutil.Call(t, testHandler.UpdateWorkOrder, request).Want(http.StatusOK)
		optionsRequest := orderRequest(http.MethodGet, "/api/work-orders/options", "", "member", nil)
		optionsRequest = optionsRequest.WithContext(middleware.SetMemberContext(optionsRequest.Context(), workspace, db.Member{WorkspaceID: parseUUID(workspace), UserID: parseUUID(testUserID), Role: "member"}))
		var options struct {
			Projects []struct {
				ID string `json:"id"`
			} `json:"projects"`
		}
		testutil.Call(t, testHandler.GetWorkOrderOptions, optionsRequest).Want(http.StatusOK).JSON(&options)
		found := false
		for _, p := range options.Projects {
			found = found || p.ID == project
		}
		if !found {
			t.Fatalf("workspace %s cannot select the global customer project", workspace)
		}
		planRequest := orderRequest(http.MethodGet, "/api/work-orders/project-baseline?version_id="+version, "", "member", nil)
		planRequest = planRequest.WithContext(middleware.SetMemberContext(planRequest.Context(), workspace, db.Member{WorkspaceID: parseUUID(workspace), UserID: parseUUID(testUserID), Role: "member"}))
		testutil.Call(t, testHandler.GetWorkOrderProjectBaseline, planRequest).Want(http.StatusOK)
		previewRequest := orderRequest(http.MethodPost, "/api/work-orders/"+orderID+"/preview", orderID, "member", nil)
		previewRequest = previewRequest.WithContext(middleware.SetMemberContext(previewRequest.Context(), workspace, db.Member{WorkspaceID: parseUUID(workspace), UserID: parseUUID(testUserID), Role: "member"}))
		var plan workorder.Plan
		testutil.Call(t, testHandler.PreviewWorkOrderPlan, previewRequest).Want(http.StatusOK).JSON(&plan)
		if len(plan.Repos) != 2 || plan.Repos[0].Ref != "shared/v1" || plan.Repos[0].RefSource != "project" ||
			plan.Repos[1].Ref != "legacy" || plan.Repos[1].RefSource != "baseline" {
			t.Fatalf("workspace %s did not resolve the shared project branches: %+v", workspace, plan)
		}
	}
	deleteRequest := withURLParam(newRequest(http.MethodDelete, "/api/workspaces/"+other, nil), "id", other)
	testutil.Call(t, testHandler.DeleteWorkspace, deleteRequest).Want(http.StatusNoContent)
	if dbfx.Count(t, "SELECT count(*) FROM work_order WHERE workspace_id=$1", other) != 0 {
		t.Fatal("workspace deletion retained local work orders")
	}
	assertProjectVersion(version)
	remaining, err := testHandler.Queries.ListWorkOrderProjectBranches(ctx, parseUUID(project))
	if err != nil || len(remaining) != 3 {
		t.Fatalf("workspace deletion removed global project branches: %+v %v", remaining, err)
	}
}

func orderRequest(method, path, id, role string, body any) *http.Request {
	req := newRequest(method, path, body)
	req = req.WithContext(middleware.SetMemberContext(req.Context(), testWorkspaceID, db.Member{
		WorkspaceID: parseUUID(testWorkspaceID), UserID: parseUUID(testUserID), Role: role,
	}))
	if id != "" {
		req = withURLParam(req, "orderId", id)
	}
	return req
}

func seedWorkOrder(t *testing.T, owner string) workOrderResponse {
	t.Helper()
	id := dbfx.Insert(t, "work_order", testutil.Cols{
		"workspace_id": testWorkspaceID, "external_id": "test-" + t.Name() + "-" + owner,
		"title": "Legacy repair", "assignee_id": owner,
		"created_by": testUserID, "updated_by": testUserID,
	})
	dbfx.Cleanup(t, "DELETE FROM work_order_event WHERE work_order_id=$1", id)
	row, err := testHandler.Queries.GetWorkOrder(context.Background(), db.GetWorkOrderParams{
		ID: parseUUID(id), WorkspaceID: parseUUID(testWorkspaceID),
	})
	if err != nil {
		t.Fatal(err)
	}
	return workOrderToResponse(row)
}

func orderEdit(o workOrderResponse) updateWorkOrderRequest {
	return updateWorkOrderRequest{
		AssigneeID: o.AssigneeID, ProductVersionID: o.ProductVersionID,
		CustomerProjectID: o.CustomerProjectID, Draft: o.Draft,
		BranchOverrides: o.BranchOverrides, Stage: o.Stage, UpdatedAt: o.UpdatedAt,
	}
}

func TestWorkOrderPersonalPermissions(t *testing.T) {
	other := dbfx.User(t, "Other order owner", "other-order-owner@multica.test")
	dbfx.Member(t, testWorkspaceID, other, "member")
	mine, theirs := seedWorkOrder(t, testUserID), seedWorkOrder(t, other)
	var list struct {
		Orders    []workOrderResponse `json:"orders"`
		CanManage bool                `json:"can_manage"`
	}
	req := orderRequest(http.MethodGet, "/api/work-orders?all=true&assignee_id="+other, "", "member", nil)
	testutil.Call(t, testHandler.ListWorkOrders, req).Want(http.StatusOK).JSON(&list)
	if list.CanManage || len(list.Orders) != 1 || list.Orders[0].ID != mine.ID {
		t.Fatalf("member escaped own inventory: %+v", list)
	}
	testutil.Call(t, testHandler.GetWorkOrder, orderRequest(http.MethodGet, "/api/work-orders/"+theirs.ID, theirs.ID, "member", nil)).Want(http.StatusNotFound)
	testutil.Call(t, testHandler.RegisterWorkOrderProject, orderRequest(http.MethodPost, "/api/work-orders/"+theirs.ID+"/project", theirs.ID, "member", nil)).Want(http.StatusNotFound)
	edit := orderEdit(mine)
	edit.AssigneeID = other
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+mine.ID, mine.ID, "member", edit)).Want(http.StatusForbidden)
	testutil.Call(t, testHandler.ImportWorkOrder, orderRequest(http.MethodPost, "/api/work-orders", "", "member", nil)).Want(http.StatusForbidden)
	testutil.Call(t, testHandler.GetWorkOrderSettings, orderRequest(http.MethodGet, "/api/work-orders/settings", "", "member", nil)).Want(http.StatusForbidden)
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+mine.ID, mine.ID, "admin", edit)).Want(http.StatusOK)
	testutil.Call(t, testHandler.GetWorkOrder, orderRequest(http.MethodGet, "/api/work-orders/"+mine.ID, mine.ID, "member", nil)).Want(http.StatusNotFound)
	req = orderRequest(http.MethodGet, "/api/work-orders?all=true", "", "admin", nil)
	testutil.Call(t, testHandler.ListWorkOrders, req).Want(http.StatusOK).JSON(&list)
	if !list.CanManage || len(list.Orders) != 2 {
		t.Fatalf("administrator could not see all work orders: %+v", list)
	}
	otherWS := dbfx.Workspace(t, "Other order workspace", "other-order-workspace")
	req = orderRequest(http.MethodGet, "/api/work-orders/"+theirs.ID, theirs.ID, "admin", nil)
	req = req.WithContext(middleware.SetMemberContext(req.Context(), otherWS, db.Member{
		WorkspaceID: parseUUID(otherWS), UserID: parseUUID(testUserID), Role: "admin",
	}))
	testutil.Call(t, testHandler.GetWorkOrder, req).Want(http.StatusNotFound)
	testutil.Call(t, testHandler.ListWorkOrders, orderRequest(http.MethodGet, "/api/system/work-orders?workspace_id="+testWorkspaceID, "", "owner", nil)).Want(http.StatusForbidden)
}

func TestWorkOrderPaginationAndSearch(t *testing.T) {
	prefix := t.Name()
	for i := 0; i < 21; i++ {
		dbfx.Insert(t, "work_order", testutil.Cols{
			"workspace_id": testWorkspaceID, "external_id": fmt.Sprintf("%s-%02d", prefix, i),
			"title": prefix + " Repair", "assignee_id": testUserID,
			"description": "Full source content", "draft": "Keep my draft",
			"created_by": testUserID, "updated_by": testUserID,
		})
	}
	type inventory struct {
		Orders   []workOrderResponse `json:"orders"`
		Total    int                 `json:"total"`
		PageSize int                 `json:"page_size"`
	}
	list := func(search string, page int) inventory {
		t.Helper()
		var result inventory
		path := fmt.Sprintf("/api/work-orders?search=%s&page=%d&page_size=20&summary=true", url.QueryEscape(search), page)
		testutil.Call(t, testHandler.ListWorkOrders, orderRequest(http.MethodGet, path, "", "member", nil)).
			Want(http.StatusOK).JSON(&result)
		return result
	}
	first, second := list(prefix, 1), list(prefix, 2)
	if first.Total != 21 || first.PageSize != 20 || len(first.Orders) != 20 || second.Total != 21 || len(second.Orders) != 1 {
		t.Fatalf("unexpected pages: first=%d/%d second=%d/%d size=%d", len(first.Orders), first.Total, len(second.Orders), second.Total, first.PageSize)
	}
	seen := map[string]bool{}
	for _, order := range first.Orders {
		seen[order.ID] = true
		if order.Description != "" || order.Draft != "" || string(order.ExecutionPlan) != "null" {
			t.Fatal("list contains full work order content")
		}
	}
	if seen[second.Orders[0].ID] {
		t.Fatal("pages overlap")
	}
	exact := list(prefix+"-00", 1)
	if exact.Total != 1 || len(exact.Orders) != 1 || exact.Orders[0].ExternalID != prefix+"-00" {
		t.Fatal("external id search did not apply before pagination")
	}
	if empty := list(prefix+"-missing", 1); empty.Total != 0 || len(empty.Orders) != 0 {
		t.Fatal("search returned unrelated work orders")
	}
	var detail struct {
		Order workOrderResponse `json:"order"`
	}
	id := first.Orders[0].ID
	testutil.Call(t, testHandler.GetWorkOrder, orderRequest(http.MethodGet, "/api/work-orders/"+id, id, "member", nil)).
		Want(http.StatusOK).JSON(&detail)
	if detail.Order.Description != "Full source content" || detail.Order.Draft != "Keep my draft" {
		t.Fatal("detail content was lost by list projection")
	}
}

func TestWorkOrderReimportPreservesLocalEdits(t *testing.T) {
	body := importWorkOrderRequest{ExternalID: t.Name(), Title: "Source title", AssigneeID: testUserID}
	var first workOrderResponse
	testutil.Call(t, testHandler.ImportWorkOrder, orderRequest(http.MethodPost, "/api/work-orders", "", "owner", body)).Want(http.StatusOK).JSON(&first)
	dbfx.Cleanup(t, "DELETE FROM work_order WHERE id=$1", first.ID)
	dbfx.Cleanup(t, "DELETE FROM work_order_event WHERE work_order_id=$1", first.ID)
	edit := orderEdit(first)
	edit.Draft, edit.Stage = "Keep the local repair notes", "processing"
	var updated workOrderResponse
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+first.ID, first.ID, "member", edit)).Want(http.StatusOK).JSON(&updated)
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+first.ID, first.ID, "member", edit)).Want(http.StatusConflict)
	body.Title, body.Description, body.AssigneeID = "Refreshed source", "New source description", ""
	var imported workOrderResponse
	testutil.Call(t, testHandler.ImportWorkOrder, orderRequest(http.MethodPost, "/api/work-orders", "", "owner", body)).Want(http.StatusOK).JSON(&imported)
	if imported.ID != first.ID || imported.Draft != updated.Draft || imported.AssigneeID != testUserID ||
		imported.Stage != "processing" || imported.Description != body.Description {
		t.Fatalf("source refresh overwrote local fields: %+v", imported)
	}
}

func TestWorkOrderConversionFreezesPlanAndPropagatesToChildren(t *testing.T) {
	ctx := context.Background()
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name(), "slug": "test-conversion"})
	version := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "V6", "enabled": true})
	dbfx.InsertNoID(t, "product_version_code", testutil.Cols{
		"version_id": version, "config": `{"modules":[{"key":"api","repo_url":"https://git.example.test/ecm/api.git","ref":"legacy/v6"}],"dependencies":[]}`,
	}, "version_id=$1", version)
	previous, rootErr := testHandler.Queries.GetWorkOrderSetting(ctx)
	if _, err := testHandler.Queries.SaveWorkOrderSetting(ctx, "test-shared-root"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if rootErr == nil {
			_, _ = testHandler.Queries.SaveWorkOrderSetting(ctx, previous.KbRootID)
		} else {
			dbfx.Exec(t, "DELETE FROM work_order_setting")
		}
	})
	project := dbfx.Project(t, "Dedicated order execution")
	dbfx.InsertNoID(t, "work_order_workspace", testutil.Cols{
		"workspace_id": testWorkspaceID, "execution_project_id": project,
	}, "workspace_id=$1", testWorkspaceID)
	order := seedWorkOrder(t, testUserID)
	edit := orderEdit(order)
	edit.ProductVersionID = version
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+order.ID, order.ID, "member", edit)).Want(http.StatusOK)
	var result struct {
		IssueID string `json:"issue_id"`
	}
	convert := func() {
		testutil.Call(t, testHandler.ConvertWorkOrder, orderRequest(http.MethodPost, "/api/work-orders/"+order.ID+"/convert", order.ID, "member", nil)).Want(http.StatusOK).JSON(&result)
	}
	convert()
	firstIssue := result.IssueID
	dbfx.Cleanup(t, "DELETE FROM issue WHERE id=$1", firstIssue)
	convert()
	if firstIssue == "" || result.IssueID != firstIssue || dbfx.Count(t, "SELECT count(*) FROM work_order_event WHERE work_order_id=$1 AND action='convert'", order.ID) != 1 {
		t.Fatal("conversion was not idempotent")
	}
	issue, err := testHandler.Queries.GetIssue(ctx, parseUUID(firstIssue))
	if err != nil || issue.Status != "backlog" || issue.ProjectID != parseUUID(project) || issue.AssigneeID.Valid {
		t.Fatalf("conversion started an unintended squad or workflow: %+v %v", issue, err)
	}
	child := dbfx.Issue(t, "Work order child", testutil.Cols{"parent_issue_id": firstIssue})
	claim := AgentTaskResponse{WorkspaceID: testWorkspaceID, IssueID: child}
	testHandler.applyWorkOrderToClaim(ctx, &claim)
	var plan workorder.Plan
	if err := json.Unmarshal(claim.WorkOrderPlan, &plan); err != nil || len(claim.Repos) != 1 || claim.Repos[0].Ref != "legacy/v6" || claim.WorkOrderError != "" {
		t.Fatalf("child lost frozen execution plan: %+v %v", claim, err)
	}
	var detail struct {
		Order workOrderResponse `json:"order"`
	}
	testutil.Call(t, testHandler.GetWorkOrder, orderRequest(http.MethodGet, "/api/work-orders/"+order.ID, order.ID, "member", nil)).Want(http.StatusOK).JSON(&detail)
	edit = orderEdit(detail.Order)
	edit.BranchOverrides = map[string]string{version + "/api": "other-branch"}
	testutil.Call(t, testHandler.UpdateWorkOrder, orderRequest(http.MethodPut, "/api/work-orders/"+order.ID, order.ID, "member", edit)).Want(http.StatusConflict)
}

func TestWorkOrderCodeConfigurationBelongsToProduct(t *testing.T) {
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	t.Cleanup(func() { testHandler.cfg.SystemAdminEmails = previous })
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name()})
	other := dbfx.Insert(t, "product", testutil.Cols{"name": "Other configuration product"})
	version := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "Legacy"})
	config := workorder.Config{Modules: []workorder.Module{{Key: "api", RepoURL: "https://git.example.test/api.git", Ref: "v6"}}}
	dbfx.Cleanup(t, "DELETE FROM product_version_code WHERE version_id=$1", version)
	request := func(method, productID string, body any) *http.Request {
		req := newRequest(method, "/api/system/products/"+productID+"/versions/"+version+"/code", body)
		return withURLParams(req, "id", productID, "versionId", version)
	}
	testutil.Call(t, testHandler.GetVersionCode, request(http.MethodGet, other, nil)).Want(http.StatusNotFound)
	testutil.Call(t, testHandler.SaveVersionCode, request(http.MethodPut, other, config)).Want(http.StatusNotFound)
	testutil.Call(t, testHandler.SaveVersionCode, request(http.MethodPut, product, config)).Want(http.StatusOK)
	var saved workorder.Config
	testutil.Call(t, testHandler.GetVersionCode, request(http.MethodGet, product, nil)).Want(http.StatusOK).JSON(&saved)
	if len(saved.Modules) != 1 || saved.Modules[0].Ref != "v6" {
		t.Fatalf("configuration did not round-trip: %+v", saved)
	}
	if _, err := testHandler.Queries.DeleteProductVersion(context.Background(), parseUUID(version)); err != nil {
		t.Fatal(err)
	}
	if dbfx.Count(t, "SELECT count(*) FROM product_version_code WHERE version_id=$1", version) != 0 {
		t.Fatal("version deletion retained its code configuration")
	}
}

func TestWorkOrderDependencyValidationBeforeSave(t *testing.T) {
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	t.Cleanup(func() { testHandler.cfg.SystemAdminEmails = previous })
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name()})
	other := dbfx.Insert(t, "product", testutil.Cols{"name": "Dependency product"})
	root := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "v6"})
	dep := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": other, "name": "v3"})
	second := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": other, "name": "v4"})
	config := workorder.Config{Modules: []workorder.Module{{Key: "main", RepoURL: "https://git.example.test/main.git", Ref: "legacy", Directory: "backend"}}}
	save := func(productID, versionID string, c workorder.Config, want int) {
		t.Helper()
		req := withURLParams(newRequest(http.MethodPut, "/api/system/products/"+productID+"/versions/"+versionID+"/code", c), "id", productID, "versionId", versionID)
		testutil.Call(t, testHandler.SaveVersionCode, req).Want(want)
	}
	for _, id := range []string{root, dep, second} {
		dbfx.Cleanup(t, "DELETE FROM product_version_code WHERE version_id=$1", id)
	}
	save(other, dep, config, http.StatusOK)
	save(other, second, config, http.StatusOK)
	config.Dependencies = []string{dep}
	save(product, root, config, http.StatusOK)
	config.Dependencies = []string{root}
	save(other, dep, config, http.StatusOK)
	var mutual workorder.Config
	dependencyRequest := withURLParams(newRequest(http.MethodGet, "/code", nil), "id", other, "versionId", dep)
	testutil.Call(t, testHandler.GetVersionCode, dependencyRequest).Want(http.StatusOK).JSON(&mutual)
	if len(mutual.Dependencies) != 1 || mutual.Dependencies[0] != root {
		t.Fatalf("mutual dependency was not saved: %+v", mutual)
	}
	config.Dependencies = []string{dep, second}
	save(product, root, config, http.StatusBadRequest)
	config.Dependencies = []string{dep, dep}
	save(product, root, config, http.StatusBadRequest)
	var saved workorder.Config
	req := withURLParams(newRequest(http.MethodGet, "/api/system/products/"+product+"/versions/"+root+"/code", nil), "id", product, "versionId", root)
	testutil.Call(t, testHandler.GetVersionCode, req).Want(http.StatusOK).JSON(&saved)
	if len(saved.Dependencies) != 1 || saved.Dependencies[0] != dep || saved.Modules[0].Directory != "backend" {
		t.Fatalf("invalid dependency update changed saved baseline: %+v", saved)
	}
}

func TestWorkOrderDependenciesCanBeMaintainedBeforeRepositories(t *testing.T) {
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	t.Cleanup(func() { testHandler.cfg.SystemAdminEmails = previous })
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name(), "slug": "test-staged-ecm"})
	other := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name() + " dependency", "slug": "test-staged-inbiz"})
	root := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": product, "name": "v6", "enabled": true})
	dep := dbfx.Insert(t, "product_version", testutil.Cols{"product_id": other, "name": "v3", "enabled": true})
	for _, id := range []string{root, dep} {
		dbfx.Cleanup(t, "DELETE FROM product_version_code WHERE version_id=$1", id)
	}
	save := func(productID, versionID string, c workorder.Config, want int) {
		t.Helper()
		req := withURLParams(newRequest(http.MethodPut, "/api/system/products/"+productID+"/versions/"+versionID+"/code", c), "id", productID, "versionId", versionID)
		testutil.Call(t, testHandler.SaveVersionCode, req).Want(want)
	}
	config := workorder.Config{Dependencies: []string{dep}}
	save(product, root, config, http.StatusOK)
	plan, err := testHandler.workOrderProjectBaseline(context.Background(), parseUUID(root))
	if err != nil || len(plan.Repos) != 0 || len(plan.MissingVersions) != 2 {
		t.Fatalf("maintenance should report both incomplete versions: %+v %v", plan, err)
	}
	config.Modules = []workorder.Module{{Key: "main", RepoURL: "https://git.example.test/ecm.git", Ref: "legacy/v6"}}
	save(product, root, config, http.StatusOK)
	plan, err = testHandler.workOrderProjectBaseline(context.Background(), parseUUID(root))
	if err != nil || len(plan.Repos) != 1 || len(plan.MissingVersions) != 1 || plan.MissingVersions[0].ProductName != t.Name()+" dependency" {
		t.Fatalf("maintenance should retain ECM and identify its incomplete dependency: %+v %v", plan, err)
	}
	project := dbfx.Insert(t, "customer_project", testutil.Cols{"name": t.Name()})
	dbfx.Cleanup(t, "DELETE FROM work_order_project_branch WHERE project_id=$1", project)
	testutil.Call(t, testHandler.SaveWorkOrderProject, newRequest(http.MethodPut, "/api/system/work-orders/projects", map[string]any{
		"project_id": project, "version_id": root, "refs": map[string]string{root + "/main": "proj-acme-v6"},
	})).Want(http.StatusOK)
	if dbfx.Count(t, "SELECT count(*) FROM work_order_project_branch WHERE project_id=$1 AND ref='proj-acme-v6'", project) != 1 {
		t.Fatal("configured project branch was not saved")
	}
	var unchanged workorder.Config
	req := withURLParams(newRequest(http.MethodGet, "/code", nil), "id", product, "versionId", root)
	testutil.Call(t, testHandler.GetVersionCode, req).Want(http.StatusOK).JSON(&unchanged)
	if len(unchanged.Modules) != 1 || unchanged.Modules[0].Ref != "legacy/v6" {
		t.Fatalf("project save changed the product baseline: %+v", unchanged)
	}
	if _, err := workorder.Resolve(context.Background(), root, "", nil, nil, testHandler.loadWorkOrderVersion); err == nil ||
		!strings.Contains(err.Error(), t.Name()+" dependency / 版本 v3") {
		t.Fatalf("execution should still block the incomplete dependency: %v", err)
	}
	save(other, dep, workorder.Config{Dependencies: []string{root}}, http.StatusOK)
	plan, err = testHandler.workOrderProjectBaseline(context.Background(), parseUUID(dep))
	if err != nil || len(plan.Repos) != 1 || len(plan.MissingVersions) != 1 || plan.MissingVersions[0].VersionID != dep {
		t.Fatalf("incomplete cyclic baseline should visit each version once: %+v %v", plan, err)
	}
	save(other, dep, workorder.Config{
		Modules:      []workorder.Module{{Key: "main", RepoURL: "https://git.example.test/inbiz.git", Ref: "legacy/v3"}},
		Dependencies: []string{root},
	}, http.StatusOK)
	plan, err = testHandler.workOrderProjectBaseline(context.Background(), parseUUID(root))
	if err != nil || len(plan.Repos) != 2 || plan.Repos[0].Directory != "code/test-staged-ecm/v6/main" || plan.Repos[1].Directory != "code/test-staged-inbiz/v3/main" {
		t.Fatalf("completed repositories did not expand the saved dependency: %+v %v", plan, err)
	}
	for _, id := range []string{root, dep} {
		plan, err = workorder.Resolve(context.Background(), id, "", nil, nil, testHandler.loadWorkOrderVersion)
		if err != nil || len(plan.Repos) != 2 || len(plan.MissingVersions) != 0 {
			t.Fatalf("execution from either cyclic product should include both repositories once: %+v %v", plan, err)
		}
	}
}
