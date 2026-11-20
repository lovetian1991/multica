package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type workOrderScope struct {
	workspace pgtype.UUID
	actor     pgtype.UUID
	manager   bool
}

const workOrderPageSize = 20

func (h *Handler) workOrderScope(w http.ResponseWriter, r *http.Request) (workOrderScope, bool) {
	var scope workOrderScope
	if isMachineCredentialActor(r) {
		writeError(w, http.StatusForbidden, "work order maintenance requires a human actor")
		return scope, false
	}
	actor, ok := parseUUIDOrBadRequest(w, requestUserID(r), "user id")
	if !ok {
		return scope, false
	}
	scope.actor = actor
	if strings.HasPrefix(r.URL.Path, "/api/system/") {
		if !h.requireSystemAdmin(w, r) {
			return scope, false
		}
		id, ok := parseUUIDOrBadRequest(w, r.URL.Query().Get("workspace_id"), "workspace id")
		if !ok {
			return scope, false
		}
		if _, err := h.Queries.GetWorkspace(r.Context(), id); err != nil {
			writeError(w, http.StatusNotFound, "workspace not found")
			return scope, false
		}
		scope.workspace, scope.manager = id, true
		return scope, true
	}
	member, ok := middleware.MemberFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusForbidden, "workspace membership required")
		return scope, false
	}
	scope.workspace = member.WorkspaceID
	scope.manager = member.Role == "owner" || member.Role == "admin"
	return scope, true
}

func workOrderManager(w http.ResponseWriter, scope workOrderScope) bool {
	if !scope.manager {
		writeError(w, http.StatusForbidden, "work order administrator access required")
	}
	return scope.manager
}

func decodeWorkOrderBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024*1024)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid work order request")
		return false
	}
	return true
}

type workOrderResponse struct {
	ID                string            `json:"id"`
	WorkspaceID       string            `json:"workspace_id"`
	Source            string            `json:"source"`
	ExternalID        string            `json:"external_id"`
	Title             string            `json:"title"`
	Description       string            `json:"description"`
	SourceStatus      string            `json:"source_status"`
	SourceProduct     string            `json:"source_product"`
	SourceVersion     string            `json:"source_version"`
	SourceProject     string            `json:"source_project"`
	SourceBranch      string            `json:"source_branch"`
	ProductVersionID  string            `json:"product_version_id"`
	CustomerProjectID string            `json:"customer_project_id"`
	AssigneeID        string            `json:"assignee_id"`
	Draft             string            `json:"draft"`
	BranchOverrides   map[string]string `json:"branch_overrides"`
	Stage             string            `json:"stage"`
	IssueID           string            `json:"issue_id"`
	ExecutionPlan     json.RawMessage   `json:"execution_plan"`
	UpdatedAt         string            `json:"updated_at"`
}

func workOrderToResponse(row db.WorkOrder) workOrderResponse {
	overrides := map[string]string{}
	_ = json.Unmarshal(row.BranchOverrides, &overrides)
	plan := json.RawMessage(row.ExecutionPlan)
	if len(plan) == 0 {
		plan = json.RawMessage("null")
	}
	return workOrderResponse{
		ID: uuidToString(row.ID), WorkspaceID: uuidToString(row.WorkspaceID),
		Source: row.Source, ExternalID: row.ExternalID, Title: row.Title,
		Description: row.Description, SourceStatus: row.SourceStatus,
		SourceProduct: row.SourceProduct, SourceVersion: row.SourceVersion,
		SourceProject: row.SourceProject, SourceBranch: row.SourceBranch,
		ProductVersionID:  uuidToString(row.ProductVersionID),
		CustomerProjectID: uuidToString(row.CustomerProjectID),
		AssigneeID:        uuidToString(row.AssigneeID), Draft: row.Draft,
		BranchOverrides: overrides, Stage: row.Stage, IssueID: uuidToString(row.IssueID),
		ExecutionPlan: plan, UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano),
	}
}

func (h *Handler) ListWorkOrders(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	assignee := scope.actor
	if scope.manager && r.URL.Query().Get("all") == "true" {
		assignee = pgtype.UUID{}
		if raw := r.URL.Query().Get("assignee_id"); raw != "" {
			assignee, ok = parseUUIDOrBadRequest(w, raw, "assignee id")
			if !ok {
				return
			}
		}
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		page = 100000
	}
	pageSize := 50
	if raw := r.URL.Query().Get("page_size"); raw != "" {
		var err error
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 || pageSize > 100 {
			writeError(w, http.StatusBadRequest, "invalid page size")
			return
		}
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if len(search) > 256 {
		writeError(w, http.StatusBadRequest, "search is too long")
		return
	}
	rows, err := h.Queries.ListWorkOrders(r.Context(), db.ListWorkOrdersParams{
		WorkspaceID: scope.workspace, AssigneeID: assignee, Search: search,
		Limit: int32(pageSize), Offset: int32((page - 1) * pageSize),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load work orders")
		return
	}
	total, err := h.Queries.CountWorkOrders(r.Context(), db.CountWorkOrdersParams{
		WorkspaceID: scope.workspace, AssigneeID: assignee, Search: search,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to count work orders")
		return
	}
	out := make([]workOrderResponse, len(rows))
	for i, row := range rows {
		out[i] = workOrderToResponse(row)
		if r.URL.Query().Get("summary") == "true" {
			out[i].Description, out[i].Draft = "", ""
			out[i].ExecutionPlan = json.RawMessage("null")
			out[i].BranchOverrides = map[string]string{}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"orders": out, "total": total, "can_manage": scope.manager,
		"page": page, "page_size": pageSize,
	})
}

func (h *Handler) loadWorkOrder(w http.ResponseWriter, r *http.Request, scope workOrderScope) (db.WorkOrder, bool) {
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "orderId"), "work order id")
	if !ok {
		return db.WorkOrder{}, false
	}
	row, err := h.Queries.GetWorkOrder(r.Context(), db.GetWorkOrderParams{ID: id, WorkspaceID: scope.workspace})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !scope.manager && row.AssigneeID != scope.actor) {
		writeError(w, http.StatusNotFound, "work order not found")
		return row, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load work order")
		return row, false
	}
	return row, true
}

func (h *Handler) GetWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	row, ok := h.loadWorkOrder(w, r, scope)
	if !ok {
		return
	}
	events, err := h.Queries.ListWorkOrderEvents(r.Context(), db.ListWorkOrderEventsParams{
		WorkOrderID: row.ID, WorkspaceID: scope.workspace,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load work order history")
		return
	}
	if events == nil {
		events = []db.WorkOrderEvent{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"order": workOrderToResponse(row), "events": events})
}

type importWorkOrderRequest struct {
	ExternalID       string `json:"external_id"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	SourceStatus     string `json:"source_status"`
	SourceProduct    string `json:"source_product"`
	SourceVersion    string `json:"source_version"`
	SourceProject    string `json:"source_project"`
	SourceBranch     string `json:"source_branch"`
	AssigneeID       string `json:"assignee_id"`
	ProductVersionID string `json:"product_version_id"`
}

func (h *Handler) ImportWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok || !workOrderManager(w, scope) {
		return
	}
	var req importWorkOrderRequest
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" || len(req.Title) > 1000 ||
		strings.TrimSpace(req.ExternalID) == "" || len(req.ExternalID) > 256 || len(req.Description) > 500000 {
		writeError(w, http.StatusBadRequest, "external id and title are required; work order fields exceed their limits")
		return
	}
	assignee, ok := h.workOrderAssignee(w, r, scope, req.AssigneeID)
	if !ok {
		return
	}
	version, ok := h.workOrderVersion(w, r, req.ProductVersionID)
	if !ok {
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import work order")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	row, err := q.ImportWorkOrder(r.Context(), db.ImportWorkOrderParams{
		WorkspaceID: scope.workspace, Source: "manual", ExternalID: strings.TrimSpace(req.ExternalID),
		Title: strings.TrimSpace(req.Title), Description: req.Description,
		SourceStatus: req.SourceStatus, SourceProduct: req.SourceProduct, SourceVersion: req.SourceVersion,
		SourceProject: req.SourceProject, SourceBranch: req.SourceBranch,
		AssigneeID: assignee, ProductVersionID: version, CreatedBy: scope.actor,
	})
	if err == nil {
		err = q.AddWorkOrderEvent(r.Context(), db.AddWorkOrderEventParams{
			WorkOrderID: row.ID, WorkspaceID: scope.workspace, ActorID: scope.actor,
			Action: "import", Detail: []byte("{}"),
		})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import work order")
		return
	}
	writeJSON(w, http.StatusOK, workOrderToResponse(row))
}

func (h *Handler) workOrderAssignee(w http.ResponseWriter, r *http.Request, scope workOrderScope, raw string) (pgtype.UUID, bool) {
	if raw == "" {
		return pgtype.UUID{}, true
	}
	id, ok := parseUUIDOrBadRequest(w, raw, "assignee id")
	if !ok {
		return id, false
	}
	if _, err := h.Queries.GetMemberByUserAndWorkspace(r.Context(), db.GetMemberByUserAndWorkspaceParams{
		UserID: id, WorkspaceID: scope.workspace,
	}); err != nil {
		writeError(w, http.StatusBadRequest, "assignee must be a member of this workspace")
		return id, false
	}
	return id, true
}

func (h *Handler) workOrderVersion(w http.ResponseWriter, r *http.Request, raw string) (pgtype.UUID, bool) {
	if raw == "" {
		return pgtype.UUID{}, true
	}
	id, ok := parseUUIDOrBadRequest(w, raw, "product version id")
	if !ok {
		return id, false
	}
	v, err := h.Queries.GetProductVersion(r.Context(), id)
	if err != nil || !v.Enabled {
		writeError(w, http.StatusBadRequest, "product version is unavailable")
		return id, false
	}
	return id, true
}

type updateWorkOrderRequest struct {
	AssigneeID        string            `json:"assignee_id"`
	ProductVersionID  string            `json:"product_version_id"`
	CustomerProjectID string            `json:"customer_project_id"`
	Draft             string            `json:"draft"`
	BranchOverrides   map[string]string `json:"branch_overrides"`
	Stage             string            `json:"stage"`
	UpdatedAt         string            `json:"updated_at"`
}

func (h *Handler) UpdateWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	row, ok := h.loadWorkOrder(w, r, scope)
	if !ok {
		return
	}
	var req updateWorkOrderRequest
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	if len(req.Draft) > 500000 || len(req.BranchOverrides) > 300 {
		writeError(w, http.StatusBadRequest, "work order draft is too large")
		return
	}
	switch req.Stage {
	case "pending", "processing", "review", "accepted", "blocked":
	default:
		writeError(w, http.StatusBadRequest, "invalid work order stage")
		return
	}
	if !scope.manager && req.AssigneeID != uuidToString(row.AssigneeID) {
		writeError(w, http.StatusForbidden, "only administrators can assign work orders")
		return
	}
	assignee, ok := h.workOrderAssignee(w, r, scope, req.AssigneeID)
	if !ok {
		return
	}
	version, ok := h.workOrderVersion(w, r, req.ProductVersionID)
	if !ok {
		return
	}
	project := pgtype.UUID{}
	if req.CustomerProjectID != "" {
		project, ok = parseUUIDOrBadRequest(w, req.CustomerProjectID, "customer project id")
		if !ok {
			return
		}
		if _, err := h.Queries.GetCustomerProject(r.Context(), project); err != nil {
			writeError(w, http.StatusBadRequest, "customer project is unavailable")
			return
		}
	}
	for key, ref := range req.BranchOverrides {
		if len(key) > 128 || !workorder.ValidateRef(ref) {
			writeError(w, http.StatusBadRequest, "invalid module branch override")
			return
		}
	}
	if req.BranchOverrides == nil {
		req.BranchOverrides = map[string]string{}
	}
	branches, _ := json.Marshal(req.BranchOverrides)
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update work order")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	locked, err := q.LockWorkOrder(r.Context(), db.LockWorkOrderParams{ID: row.ID, WorkspaceID: scope.workspace})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update work order")
		return
	}
	if req.UpdatedAt == "" || req.UpdatedAt != locked.UpdatedAt.Time.Format(time.RFC3339Nano) ||
		(!scope.manager && locked.AssigneeID != scope.actor) {
		writeError(w, http.StatusConflict, "work order changed; reload before saving")
		return
	}
	var oldBranches map[string]string
	_ = json.Unmarshal(locked.BranchOverrides, &oldBranches)
	oldJSON, _ := json.Marshal(oldBranches)
	if locked.IssueID.Valid && (version != locked.ProductVersionID || project != locked.CustomerProjectID ||
		string(oldJSON) != string(branches)) {
		writeError(w, http.StatusConflict, "the linked task has an immutable execution plan")
		return
	}
	row, err = q.UpdateWorkOrder(r.Context(), db.UpdateWorkOrderParams{
		ID: row.ID, WorkspaceID: scope.workspace, AssigneeID: assignee, ProductVersionID: version,
		CustomerProjectID: project, Draft: req.Draft, BranchOverrides: branches, Stage: req.Stage, UpdatedBy: scope.actor,
	})
	if err == nil {
		detail, _ := json.Marshal(map[string]any{
			"assignee_id": req.AssigneeID, "stage": req.Stage, "product_version_id": req.ProductVersionID,
		})
		err = q.AddWorkOrderEvent(r.Context(), db.AddWorkOrderEventParams{
			WorkOrderID: row.ID, WorkspaceID: scope.workspace, ActorID: scope.actor, Action: "update", Detail: detail,
		})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update work order")
		return
	}
	writeJSON(w, http.StatusOK, workOrderToResponse(row))
}

func (h *Handler) GetWorkOrderMembers(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok || !workOrderManager(w, scope) {
		return
	}
	members, err := h.Queries.ListMembersWithUser(r.Context(), scope.workspace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load members")
		return
	}
	out := make([]map[string]string, 0, len(members))
	for _, member := range members {
		out = append(out, map[string]string{
			"id": uuidToString(member.UserID), "name": member.UserName, "email": member.UserEmail,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": out})
}

func (h *Handler) workOrderCodeVersion(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	productID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return pgtype.UUID{}, false
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return id, false
	}
	version, err := h.Queries.GetProductVersion(r.Context(), id)
	if err != nil || version.ProductID != productID {
		writeError(w, http.StatusNotFound, "product version not found")
		return id, false
	}
	return id, true
}

func (h *Handler) GetVersionCode(w http.ResponseWriter, r *http.Request) {
	id, ok := h.workOrderCodeVersion(w, r)
	if !ok {
		return
	}
	row, err := h.Queries.GetProductVersionCode(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, workorder.Config{Modules: []workorder.Module{}, Dependencies: []string{}})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load code configuration")
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(row.Config))
}

func (h *Handler) SaveVersionCode(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := h.workOrderCodeVersion(w, r)
	if !ok {
		return
	}
	var config workorder.Config
	if !decodeWorkOrderBody(w, r, &config) {
		return
	}
	if err := workorder.Validate(config); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	for _, dependency := range config.Dependencies {
		dep, ok := parseUUIDOrBadRequest(w, dependency, "dependency version id")
		if !ok {
			return
		}
		if dep == id {
			writeError(w, http.StatusBadRequest, "version cannot depend on itself")
			return
		}
		if _, err := h.Queries.GetProductVersion(r.Context(), dep); err != nil {
			writeError(w, http.StatusBadRequest, "dependency version not found")
			return
		}
	}
	if config.Modules == nil {
		config.Modules = []workorder.Module{}
	}
	if err := workorder.ValidateDependencies(r.Context(), uuidToString(id), func(ctx context.Context, raw string) (workorder.Version, error) {
		if raw == uuidToString(id) {
			v, err := h.Queries.GetProductVersion(ctx, id)
			return workorder.Version{ID: raw, ProductID: uuidToString(v.ProductID), Config: config}, err
		}
		return h.loadWorkOrderVersion(ctx, raw)
	}); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if config.Dependencies == nil {
		config.Dependencies = []string{}
	}
	data, _ := json.Marshal(config)
	if _, err := h.Queries.SaveProductVersionCode(r.Context(), db.SaveProductVersionCodeParams{
		VersionID: id, Config: data,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save code configuration")
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (h *Handler) loadWorkOrderVersion(ctx context.Context, raw string) (workorder.Version, error) {
	id, err := util.ParseUUID(raw)
	if err != nil {
		return workorder.Version{}, fmt.Errorf("invalid dependency version id")
	}
	version, err := h.Queries.GetProductVersion(ctx, id)
	if err != nil || !version.Enabled {
		return workorder.Version{}, fmt.Errorf("product version unavailable")
	}
	product, err := h.Queries.GetProduct(ctx, version.ProductID)
	if err != nil {
		return workorder.Version{}, fmt.Errorf("product unavailable")
	}
	code, err := h.Queries.GetProductVersionCode(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return workorder.Version{ID: raw, ProductID: uuidToString(version.ProductID), ProductName: product.Name, ProductSlug: product.Slug, Name: version.Name}, nil
	}
	if err != nil {
		return workorder.Version{}, fmt.Errorf("无法读取版本 %s 的代码配置", version.Name)
	}
	var config workorder.Config
	if err := json.Unmarshal(code.Config, &config); err != nil {
		return workorder.Version{}, err
	}
	return workorder.Version{ID: raw, ProductID: uuidToString(version.ProductID), ProductName: product.Name, ProductSlug: product.Slug, Name: version.Name, Config: config}, nil
}

func (h *Handler) resolveWorkOrderPlan(ctx context.Context, row db.WorkOrder) (workorder.Plan, error) {
	if !row.ProductVersionID.Valid {
		return workorder.Plan{}, fmt.Errorf("select a product version first")
	}
	settings, err := h.Queries.GetWorkOrderSetting(ctx)
	if err != nil || settings.KbRootID == "" {
		return workorder.Plan{}, fmt.Errorf("configure the shared knowledge base root in system settings")
	}
	overrides, projectRefs := map[string]string{}, map[string]string{}
	if err := json.Unmarshal(row.BranchOverrides, &overrides); err != nil {
		return workorder.Plan{}, err
	}
	bindingsByVersion := map[string][]db.WorkOrderProjectBranch{}
	if row.CustomerProjectID.Valid {
		if _, err := h.Queries.GetCustomerProject(ctx, row.CustomerProjectID); err != nil {
			return workorder.Plan{}, fmt.Errorf("customer project is unavailable")
		}
		bindings, err := h.Queries.ListWorkOrderProjectBranches(ctx, row.CustomerProjectID)
		if err != nil {
			return workorder.Plan{}, err
		}
		for _, binding := range bindings {
			key := uuidToString(binding.VersionID)
			bindingsByVersion[key] = append(bindingsByVersion[key], binding)
		}
	}
	load := func(ctx context.Context, id string) (workorder.Version, error) {
		version, err := h.loadWorkOrderVersion(ctx, id)
		if err != nil {
			return version, err
		}
		for _, binding := range bindingsByVersion[id] {
			if !workorder.ValidateRef(binding.Ref) {
				return version, fmt.Errorf("customer project branch is unavailable")
			}
			matched := false
			for _, module := range version.Config.Modules {
				if module.Key == binding.ModuleKey && strings.TrimSuffix(module.RepoURL, ".git") == strings.TrimSuffix(binding.RepoUrl, ".git") {
					matched = true
				}
			}
			if !matched {
				return version, fmt.Errorf("project repository does not match the module baseline")
			}
			projectRefs[uuidToString(binding.VersionID)+"/"+binding.ModuleKey] = binding.Ref
		}
		return version, nil
	}
	return workorder.Resolve(ctx, uuidToString(row.ProductVersionID), settings.KbRootID, overrides, projectRefs, load)
}

func (h *Handler) PreviewWorkOrderPlan(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	row, ok := h.loadWorkOrder(w, r, scope)
	if !ok {
		return
	}
	if row.IssueID.Valid && len(row.ExecutionPlan) > 0 {
		writeJSON(w, http.StatusOK, json.RawMessage(row.ExecutionPlan))
		return
	}
	plan, err := h.resolveWorkOrderPlan(r.Context(), row)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (h *Handler) ConvertWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	row, ok := h.loadWorkOrder(w, r, scope)
	if !ok {
		return
	}
	if row.IssueID.Valid {
		writeJSON(w, http.StatusOK, map[string]string{"issue_id": uuidToString(row.IssueID)})
		return
	}
	plan, err := h.resolveWorkOrderPlan(r.Context(), row)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	settings, err := h.Queries.GetWorkOrderWorkspace(r.Context(), scope.workspace)
	if err != nil || !settings.ExecutionProjectID.Valid {
		writeError(w, http.StatusConflict, "configure a dedicated work order execution project first")
		return
	}
	project, err := h.Queries.GetProjectInWorkspace(r.Context(), db.GetProjectInWorkspaceParams{ID: settings.ExecutionProjectID, WorkspaceID: scope.workspace})
	if err != nil || project.WorkspaceID != scope.workspace {
		writeError(w, http.StatusConflict, "execution project is unavailable")
		return
	}
	resources, err := h.Queries.ListProjectResourcesInWorkspace(r.Context(), db.ListProjectResourcesInWorkspaceParams{
		ProjectID: project.ID, WorkspaceID: scope.workspace,
	})
	if err != nil || len(resources) > 0 {
		writeError(w, http.StatusConflict, "use a dedicated execution project without repository or local directory resources")
		return
	}
	assigneeType, assignee := pgtype.Text{}, pgtype.UUID{}
	if settings.SquadID.Valid {
		assigneeType, assignee = pgtype.Text{String: "squad", Valid: true}, settings.SquadID
		if status, message := h.validateAssigneePair(r.Context(), r, uuidToString(scope.workspace), assigneeType, assignee); status != 0 {
			writeError(w, status, message)
			return
		}
	}
	version, err := h.Queries.GetProductVersion(r.Context(), row.ProductVersionID)
	if err != nil {
		writeError(w, http.StatusConflict, "product version unavailable")
		return
	}
	planJSON, _ := json.Marshal(plan)
	description := fmt.Sprintf("## Work order %s\n\n%s\n\n## Processing draft\n\n%s\n\n## Execution manifest\n\n```json\n%s\n```\n\nKeep the existing repositories and CI workflows unchanged. Prepare changes in the module directories. Record CI image references, environment health and acceptance separately. Do not close or write back to the external MIS.",
		row.ExternalID, row.Description, row.Draft, planJSON)
	result, err := h.IssueService.Create(r.Context(), service.IssueCreateParams{
		WorkspaceID: scope.workspace, Title: row.Title, Description: pgtype.Text{String: description, Valid: true},
		Status: "backlog", Priority: "medium", CreatorType: "member", CreatorID: scope.actor,
		ProjectID: settings.ExecutionProjectID, ProductID: version.ProductID, ProductVersionID: row.ProductVersionID,
		KBFolderID:   pgtype.Text{String: plan.KBRootID, Valid: true},
		AssigneeType: assigneeType, AssigneeID: assignee, AllowDuplicate: true,
		WorkOrder: &service.IssueWorkOrder{ID: row.ID, UpdatedAt: row.UpdatedAt, Plan: planJSON},
	}, service.IssueCreateOpts{})
	if errors.Is(err, service.ErrWorkOrderChanged) {
		writeError(w, http.StatusConflict, "work order changed; reload and try again")
		return
	}
	if errors.Is(err, service.ErrWorkOrderWorkflow) {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create work order task")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"issue_id": uuidToString(result.Issue.ID)})
}

func (h *Handler) GetWorkOrderSettings(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok || !workOrderManager(w, scope) {
		return
	}
	row, err := h.Queries.GetWorkOrderWorkspace(r.Context(), scope.workspace)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load work order settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"execution_project_id": uuidToString(row.ExecutionProjectID), "squad_id": uuidToString(row.SquadID),
		"mis_url": row.MisUrl, "mis_credentials_configured": row.MisCredentials != "",
	})
}

func (h *Handler) SaveWorkOrderSettings(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok || !workOrderManager(w, scope) {
		return
	}
	var req struct {
		ExecutionProjectID string `json:"execution_project_id"`
		SquadID            string `json:"squad_id"`
		MISURL             string `json:"mis_url"`
		MISCredentials     string `json:"mis_credentials"`
		ClearCredentials   bool   `json:"clear_credentials"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	project, squad := pgtype.UUID{}, pgtype.UUID{}
	if req.ExecutionProjectID != "" {
		project, ok = parseUUIDOrBadRequest(w, req.ExecutionProjectID, "execution project id")
		if !ok {
			return
		}
		p, err := h.Queries.GetProjectInWorkspace(r.Context(), db.GetProjectInWorkspaceParams{ID: project, WorkspaceID: scope.workspace})
		if err != nil || p.WorkspaceID != scope.workspace {
			writeError(w, http.StatusBadRequest, "execution project must belong to this workspace")
			return
		}
	}
	if req.SquadID != "" {
		squad, ok = parseUUIDOrBadRequest(w, req.SquadID, "squad id")
		if !ok {
			return
		}
		s, err := h.Queries.GetSquad(r.Context(), squad)
		if err != nil || s.WorkspaceID != scope.workspace {
			writeError(w, http.StatusBadRequest, "squad must belong to this workspace")
			return
		}
	}
	misURL, err := validateKBEnvironmentURL(req.MISURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid MIS base URL")
		return
	}
	current, err := h.Queries.GetWorkOrderWorkspace(r.Context(), scope.workspace)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load work order settings")
		return
	}
	credentials := current.MisCredentials
	if req.ClearCredentials {
		credentials = ""
	}
	if req.MISCredentials != "" {
		if _, err := workorder.ParseMISCredentials([]byte(req.MISCredentials)); len(req.MISCredentials) > 16384 || err != nil {
			writeError(w, http.StatusBadRequest, "MIS credentials require authentication headers and a token")
			return
		}
		if h.SystemSettingsSecretBox == nil {
			writeError(w, http.StatusServiceUnavailable, "system settings secret encryption is not configured")
			return
		}
		sealed, err := h.SystemSettingsSecretBox.Seal([]byte(req.MISCredentials))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encrypt MIS credentials")
			return
		}
		credentials = base64.StdEncoding.EncodeToString(sealed)
	}
	_, err = h.Queries.SaveWorkOrderWorkspace(r.Context(), db.SaveWorkOrderWorkspaceParams{
		WorkspaceID: scope.workspace, ExecutionProjectID: project, SquadID: squad, MisUrl: misURL, MisCredentials: credentials,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save work order settings")
		return
	}
	h.GetWorkOrderSettings(w, r)
}

func (h *Handler) GetWorkOrderRoot(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	row, err := h.Queries.GetWorkOrderSetting(r.Context())
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load knowledge base root")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"kb_root_id": row.KbRootID})
}

func (h *Handler) SaveWorkOrderRoot(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	var req struct {
		KBRootID string `json:"kb_root_id"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	if len(req.KBRootID) > 1024 || strings.ContainsAny(req.KBRootID, "\r\n\x00") {
		writeError(w, http.StatusBadRequest, "invalid knowledge base root id")
		return
	}
	if _, err := h.Queries.SaveWorkOrderSetting(r.Context(), strings.TrimSpace(req.KBRootID)); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save knowledge base root")
		return
	}
	h.GetWorkOrderRoot(w, r)
}
