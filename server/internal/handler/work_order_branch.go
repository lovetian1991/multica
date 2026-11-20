package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) GetWorkOrderOptions(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	projects, err := h.Queries.ListProjects(r.Context(), db.ListProjectsParams{WorkspaceID: scope.workspace})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load projects")
		return
	}
	projectOptions, err := h.customerProjectOptions(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load customer projects")
		return
	}
	squadOptions := []map[string]string{}
	for _, p := range projects {
		option := map[string]string{
			"id": uuidToString(p.ID), "name": p.Title,
			"product_id": uuidToString(p.ProductID), "product_version_id": uuidToString(p.ProductVersionID),
			"purpose": "execution",
		}
		projectOptions = append(projectOptions, option)
	}
	if scope.manager {
		squads, err := h.Queries.ListSquads(r.Context(), scope.workspace)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load squads")
			return
		}
		for _, s := range squads {
			squadOptions = append(squadOptions, map[string]string{"id": uuidToString(s.ID), "name": s.Name})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projectOptions, "squads": squadOptions})
}

func (h *Handler) customerProjectOptions(r *http.Request) ([]map[string]string, error) {
	projects, err := h.Queries.ListCustomerProjects(r.Context())
	out := []map[string]string{}
	for _, p := range projects {
		out = append(out, customerProjectOption(p))
	}
	return out, err
}

func customerProjectOption(p db.CustomerProject) map[string]string {
	return map[string]string{
		"id": uuidToString(p.ID), "name": p.Name, "purpose": "customer",
		"product_id": uuidToString(p.ProductID), "product_version_id": uuidToString(p.ProductVersionID),
	}
}

func (h *Handler) ListCustomerProjects(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	projects, err := h.customerProjectOptions(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load customer projects")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects, "squads": []any{}})
}

func (h *Handler) workOrderCatalogAccess(w http.ResponseWriter, r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/api/system/") {
		return h.requireSystemAdmin(w, r)
	}
	_, ok := h.workOrderScope(w, r)
	return ok
}

func (h *Handler) workOrderBranchProject(w http.ResponseWriter, r *http.Request, raw string) (pgtype.UUID, bool) {
	id, ok := parseUUIDOrBadRequest(w, raw, "customer project id")
	if !ok {
		return id, false
	}
	if _, err := h.Queries.GetCustomerProject(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "customer project not found")
		return id, false
	}
	return id, true
}

func (h *Handler) GetWorkOrderBranches(w http.ResponseWriter, r *http.Request) {
	if !h.workOrderCatalogAccess(w, r) {
		return
	}
	project, ok := h.workOrderBranchProject(w, r, r.URL.Query().Get("project_id"))
	if !ok {
		return
	}
	bindings, err := h.Queries.ListWorkOrderProjectBranches(r.Context(), project)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project branches")
		return
	}
	out, refs := []map[string]string{}, []map[string]string{}
	for _, b := range bindings {
		out = append(out, map[string]string{"version_id": uuidToString(b.VersionID), "module_key": b.ModuleKey, "resource_id": uuidToString(b.ID)})
		refs = append(refs, map[string]string{"id": uuidToString(b.ID), "repo_url": b.RepoUrl, "ref": b.Ref})
	}
	writeJSON(w, http.StatusOK, map[string]any{"bindings": out, "resources": refs})
}

// ListWorkOrderVersionBranches lists customer project branches that belong to
// a product version: every project configured for the version plus any project
// that customized one of the version's modules. Project branches for the
// version's dependency modules are included because they were generated from
// that version's closure.
func (h *Handler) ListWorkOrderVersionBranches(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	versionID, ok := parseUUIDOrBadRequest(w, r.URL.Query().Get("version_id"), "product version id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetProductVersion(r.Context(), versionID); err != nil {
		writeError(w, http.StatusNotFound, "product version not found")
		return
	}
	projects, err := h.Queries.ListCustomerProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project branches")
		return
	}
	// Only modules reachable from this version can carry its project branches;
	// historical bindings from a version the project has since left are hidden.
	allowed := map[pgtype.UUID]bool{}
	if plan, err := h.workOrderProjectBaseline(r.Context(), versionID); err == nil {
		for _, repo := range plan.Repos {
			allowed[parseUUID(repo.VersionID)] = true
		}
	} else {
		allowed[versionID] = true
	}
	type versionLabel struct{ name, product string }
	labels := map[pgtype.UUID]versionLabel{}
	label := func(id pgtype.UUID) versionLabel {
		if cached, exists := labels[id]; exists {
			return cached
		}
		var value versionLabel
		if version, err := h.Queries.GetProductVersion(r.Context(), id); err == nil {
			value.name = version.Name
			if product, err := h.Queries.GetProduct(r.Context(), version.ProductID); err == nil {
				value.product = product.Name
			}
		}
		labels[id] = value
		return value
	}
	out := []map[string]any{}
	for _, project := range projects {
		bindings, err := h.Queries.ListWorkOrderProjectBranches(r.Context(), project.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load project branches")
			return
		}
		branches := []map[string]string{}
		for _, binding := range bindings {
			if !allowed[binding.VersionID] {
				continue
			}
			info := label(binding.VersionID)
			branches = append(branches, map[string]string{
				"version_id": uuidToString(binding.VersionID), "version_name": info.name,
				"product_name": info.product, "module_key": binding.ModuleKey,
				"repo_url": binding.RepoUrl, "ref": binding.Ref,
			})
		}
		if len(branches) == 0 {
			continue
		}
		out = append(out, map[string]any{"id": uuidToString(project.ID), "name": project.Name, "branches": branches})
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out, "total": len(out)})
}

func (h *Handler) SaveWorkOrderBranches(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	var req struct {
		ProjectID string            `json:"project_id"`
		VersionID string            `json:"version_id"`
		Bindings  map[string]string `json:"bindings"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	project, ok := h.workOrderBranchProject(w, r, req.ProjectID)
	if !ok {
		return
	}
	version, ok := parseUUIDOrBadRequest(w, req.VersionID, "version id")
	if !ok {
		return
	}
	code, err := h.Queries.GetProductVersionCode(r.Context(), version)
	var config workorder.Config
	if err != nil || json.Unmarshal(code.Config, &config) != nil || len(req.Bindings) > 100 {
		writeError(w, http.StatusBadRequest, "version code configuration is unavailable")
		return
	}
	modules := map[string]workorder.Module{}
	for _, module := range config.Modules {
		modules[module.Key] = module
	}
	existing, err := h.Queries.ListWorkOrderProjectBranches(r.Context(), project)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load project branches")
		return
	}
	rows := []db.SaveWorkOrderProjectBranchParams{}
	for key, resourceID := range req.Bindings {
		module, exists := modules[key]
		if !exists {
			writeError(w, http.StatusBadRequest, "unknown module")
			return
		}
		id, ok := parseUUIDOrBadRequest(w, resourceID, "resource id")
		if !ok {
			return
		}
		var branch db.WorkOrderProjectBranch
		for _, candidate := range existing {
			if candidate.ID == id {
				branch = candidate
				break
			}
		}
		if !branch.ID.Valid || !workorder.ValidateRef(branch.Ref) ||
			strings.TrimSuffix(branch.RepoUrl, ".git") != strings.TrimSuffix(module.RepoURL, ".git") {
			writeError(w, http.StatusBadRequest, "project resource must match the module repository and specify a branch")
			return
		}
		rows = append(rows, db.SaveWorkOrderProjectBranchParams{ProjectID: project, VersionID: version, ModuleKey: key, RepoUrl: branch.RepoUrl, Ref: branch.Ref})
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save project branches")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	if err = q.DeleteWorkOrderProjectVersionBranches(r.Context(), db.DeleteWorkOrderProjectVersionBranchesParams{ProjectID: project, VersionID: version}); err == nil {
		for _, row := range rows {
			if _, err = q.SaveWorkOrderProjectBranch(r.Context(), row); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save project branches")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}
