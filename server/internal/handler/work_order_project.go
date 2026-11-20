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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) customerProjectName(w http.ResponseWriter, r *http.Request, except pgtype.UUID) (string, bool) {
	var req struct {
		Name string `json:"name"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return "", false
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 256 {
		writeError(w, http.StatusBadRequest, "project name is required and must not exceed 256 bytes")
		return "", false
	}
	projects, err := h.Queries.ListCustomerProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load customer projects")
		return "", false
	}
	for _, p := range projects {
		if p.ID != except && strings.EqualFold(strings.TrimSpace(p.Name), name) {
			writeError(w, http.StatusConflict, "a customer project with this name already exists")
			return "", false
		}
	}
	return name, true
}

func (h *Handler) CreateCustomerProject(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	name, ok := h.customerProjectName(w, r, pgtype.UUID{})
	if !ok {
		return
	}
	project, err := h.Queries.CreateCustomerProject(r.Context(), db.CreateCustomerProjectParams{Name: name})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create customer project")
		return
	}
	writeJSON(w, http.StatusCreated, customerProjectOption(project))
}

func (h *Handler) RenameCustomerProject(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := h.workOrderBranchProject(w, r, chi.URLParam(r, "projectId"))
	if !ok {
		return
	}
	name, ok := h.customerProjectName(w, r, id)
	if !ok {
		return
	}
	project, err := h.Queries.RenameCustomerProject(r.Context(), db.RenameCustomerProjectParams{ID: id, Name: name})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update customer project")
		return
	}
	writeJSON(w, http.StatusOK, customerProjectOption(project))
}

func (h *Handler) DeleteCustomerProject(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := h.workOrderBranchProject(w, r, chi.URLParam(r, "projectId"))
	if !ok {
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete customer project")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	if _, err = q.DeleteUnusedCustomerProject(r.Context(), id); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "customer project is referenced by work orders")
		return
	}
	if err == nil {
		err = q.DeleteCustomerProjectBranches(r.Context(), id)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete customer project")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

func (h *Handler) workOrderProjectBaseline(ctx context.Context, version pgtype.UUID) (workorder.Plan, error) {
	return workorder.ResolveProjectBaseline(ctx, uuidToString(version), h.loadWorkOrderVersion)
}

func (h *Handler) GetWorkOrderProjectBaseline(w http.ResponseWriter, r *http.Request) {
	if !h.workOrderCatalogAccess(w, r) {
		return
	}
	version, ok := h.workOrderVersion(w, r, r.URL.Query().Get("version_id"))
	if !ok {
		return
	}
	plan, err := h.workOrderProjectBaseline(r.Context(), version)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func validateProjectRefs(plan workorder.Plan, refs map[string]string) error {
	modules := map[string]bool{}
	for _, module := range plan.Repos {
		modules[module.VersionID+"/"+module.ModuleKey] = true
	}
	if len(refs) > 300 {
		return fmt.Errorf("too many project branches")
	}
	for key, ref := range refs {
		if !modules[key] || (ref != "" && !workorder.ValidateRef(ref)) {
			return fmt.Errorf("invalid project module branch")
		}
	}
	return nil
}

func saveProjectCode(ctx context.Context, q *db.Queries, project pgtype.UUID, plan workorder.Plan, refs map[string]string, replace bool) error {
	version, err := q.GetProductVersion(ctx, parseUUID(plan.VersionID))
	if err != nil {
		return err
	}
	if _, err = q.UpdateCustomerProjectVersion(ctx, db.UpdateCustomerProjectVersionParams{
		ID: project, ProductID: version.ProductID, ProductVersionID: version.ID,
	}); err != nil {
		return err
	}
	if replace {
		versions := map[string]bool{}
		for _, module := range plan.Repos {
			if versions[module.VersionID] {
				continue
			}
			versions[module.VersionID] = true
			if err := q.DeleteWorkOrderProjectVersionBranches(ctx, db.DeleteWorkOrderProjectVersionBranchesParams{
				ProjectID: project, VersionID: parseUUID(module.VersionID),
			}); err != nil {
				return err
			}
		}
	}
	for _, module := range plan.Repos {
		ref := refs[module.VersionID+"/"+module.ModuleKey]
		if ref == "" {
			continue
		}
		if _, err := q.SaveWorkOrderProjectBranch(ctx, db.SaveWorkOrderProjectBranchParams{
			ProjectID: project, VersionID: parseUUID(module.VersionID),
			ModuleKey: module.ModuleKey, RepoUrl: module.RepoURL, Ref: ref,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) SaveWorkOrderProject(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	var req struct {
		ProjectID string            `json:"project_id"`
		VersionID string            `json:"version_id"`
		Refs      map[string]string `json:"refs"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	project, ok := h.workOrderBranchProject(w, r, req.ProjectID)
	if !ok {
		return
	}
	version, ok := h.workOrderVersion(w, r, req.VersionID)
	if !ok {
		return
	}
	plan, err := h.workOrderProjectBaseline(r.Context(), version)
	if err == nil {
		err = validateProjectRefs(plan, req.Refs)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save project configuration")
		return
	}
	defer tx.Rollback(r.Context())
	if err = saveProjectCode(r.Context(), h.Queries.WithTx(tx), project, plan, req.Refs, true); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save project configuration")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

// Assigned humans can register configuration through their own unconverted order.
func (h *Handler) RegisterWorkOrderProject(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	order, ok := h.loadWorkOrder(w, r, scope)
	if !ok {
		return
	}
	var req struct {
		Name         string `json:"name"`
		UpdatedAt    string `json:"updated_at"`
		RememberRefs bool   `json:"remember_refs"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if order.IssueID.Valid || !order.ProductVersionID.Valid || (!order.CustomerProjectID.Valid && (req.Name == "" || len(req.Name) > 256)) {
		writeError(w, http.StatusBadRequest, "an unconverted order, product version and customer project are required")
		return
	}
	plan, err := h.workOrderProjectBaseline(r.Context(), order.ProductVersionID)
	refs := map[string]string{}
	if err == nil && req.RememberRefs {
		err = json.Unmarshal(order.BranchOverrides, &refs)
		if err == nil {
			err = validateProjectRefs(plan, refs)
		}
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register customer project")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	locked, err := q.LockWorkOrder(r.Context(), db.LockWorkOrderParams{ID: order.ID, WorkspaceID: scope.workspace})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to lock work order")
		return
	}
	if req.UpdatedAt != locked.UpdatedAt.Time.Format(time.RFC3339Nano) || locked.IssueID.Valid ||
		(!scope.manager && locked.AssigneeID != scope.actor) {
		writeError(w, http.StatusConflict, "work order changed; reload before confirming")
		return
	}
	project := order.CustomerProjectID
	createdProject := false
	if !project.Valid {
		projects, loadErr := q.ListCustomerProjects(r.Context())
		if loadErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to load customer projects")
			return
		}
		for _, existing := range projects {
			if strings.EqualFold(strings.TrimSpace(existing.Name), req.Name) {
				if project.Valid {
					writeError(w, http.StatusConflict, "multiple projects have this name; select the existing project explicitly")
					return
				}
				project = existing.ID
			}
		}
		if !project.Valid {
			created, createErr := q.CreateCustomerProject(r.Context(), db.CreateCustomerProjectParams{
				Name: req.Name,
			})
			if createErr != nil {
				writeError(w, http.StatusInternalServerError, "failed to create customer project")
				return
			}
			project = created.ID
			createdProject = true
		}
	} else if _, err = q.GetCustomerProject(r.Context(), project); err != nil {
		writeError(w, http.StatusNotFound, "customer project not found")
		return
	}
	if createdProject || req.RememberRefs {
		err = saveProjectCode(r.Context(), q, project, plan, refs, false)
	}
	if err == nil {
		order, err = q.UpdateWorkOrder(r.Context(), db.UpdateWorkOrderParams{
			ID: order.ID, WorkspaceID: scope.workspace, AssigneeID: order.AssigneeID,
			ProductVersionID: order.ProductVersionID, CustomerProjectID: project, Draft: order.Draft,
			BranchOverrides: order.BranchOverrides, Stage: order.Stage, UpdatedBy: scope.actor,
		})
	}
	if err == nil {
		detail, _ := json.Marshal(map[string]any{"project_id": uuidToString(project), "remember_refs": req.RememberRefs})
		err = q.AddWorkOrderEvent(r.Context(), db.AddWorkOrderEventParams{
			WorkOrderID: order.ID, WorkspaceID: scope.workspace, ActorID: scope.actor, Action: "project_confirm", Detail: detail,
		})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register customer project")
		return
	}
	writeJSON(w, http.StatusOK, workOrderToResponse(order))
}
