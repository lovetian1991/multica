package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/processtemplate"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	maxProcessTemplateNameLength = 160
	maxProcessTemplateDescLength = 4000
	maxProcessTemplateSlugLength = 128
)

type processTemplateVersionSummary struct {
	ID        string `json:"id"`
	Version   int32  `json:"version"`
	Checksum  string `json:"checksum"`
	FileName  string `json:"file_name"`
	FileSize  int64  `json:"file_size"`
	Manifest  any    `json:"manifest"`
	CreatedBy string `json:"created_by,omitempty"`
	CreatedAt string `json:"created_at"`
}

type processTemplateResponse struct {
	ID               string                         `json:"id"`
	Slug             string                         `json:"slug"`
	Name             string                         `json:"name"`
	Description      string                         `json:"description"`
	CreatedBy        string                         `json:"created_by,omitempty"`
	CreatedAt        string                         `json:"created_at"`
	UpdatedAt        string                         `json:"updated_at"`
	LatestVersion    *processTemplateVersionSummary `json:"latest_version,omitempty"`
	Installed        bool                           `json:"installed,omitempty"`
	InstalledVersion *processTemplateVersionSummary `json:"installed_version,omitempty"`
	AppliedAt        string                         `json:"applied_at,omitempty"`
	AppliedBy        string                         `json:"applied_by,omitempty"`
	CanUpgrade       bool                           `json:"can_upgrade"`
}

type processTemplateForm struct {
	Name        string
	Description string
	Slug        string
	FileName    string
	Zip         []byte
	HasZip      bool
}

func processTemplateToResponse(row db.ListProcessTemplatesRow) processTemplateResponse {
	resp := processTemplateResponse{
		ID:          uuidToString(row.ID),
		Slug:        row.Slug,
		Name:        row.Name,
		Description: row.Description,
		CreatedBy:   uuidToString(row.CreatedBy),
		CreatedAt:   timestampToString(row.CreatedAt),
		UpdatedAt:   timestampToString(row.UpdatedAt),
	}
	if row.LatestVersionID.Valid {
		resp.LatestVersion = &processTemplateVersionSummary{
			ID:        uuidToString(row.LatestVersionID),
			Version:   row.LatestVersion,
			Checksum:  row.LatestChecksum,
			FileName:  row.LatestFileName,
			FileSize:  row.LatestFileSize,
			Manifest:  decodeJSONValue(row.LatestManifest),
			CreatedAt: timestampToString(row.LatestCreatedAt),
		}
	}
	return resp
}

func processTemplateDetail(template db.ProcessTemplate, latest db.GetLatestProcessTemplateVersionRow, latestErr error) processTemplateResponse {
	resp := processTemplateResponse{
		ID:          uuidToString(template.ID),
		Slug:        template.Slug,
		Name:        template.Name,
		Description: template.Description,
		CreatedBy:   uuidToString(template.CreatedBy),
		CreatedAt:   timestampToString(template.CreatedAt),
		UpdatedAt:   timestampToString(template.UpdatedAt),
	}
	if latestErr == nil {
		resp.LatestVersion = versionSummaryFromLatest(latest)
	}
	return resp
}

func versionSummaryFromLatest(row db.GetLatestProcessTemplateVersionRow) *processTemplateVersionSummary {
	return &processTemplateVersionSummary{
		ID:        uuidToString(row.ID),
		Version:   row.Version,
		Checksum:  row.Checksum,
		FileName:  row.FileName,
		FileSize:  row.FileSize,
		Manifest:  decodeJSONValue(row.Manifest),
		CreatedBy: uuidToString(row.CreatedBy),
		CreatedAt: timestampToString(row.CreatedAt),
	}
}

func versionSummaryFromCreate(row db.CreateProcessTemplateVersionRow) *processTemplateVersionSummary {
	return &processTemplateVersionSummary{
		ID:        uuidToString(row.ID),
		Version:   row.Version,
		Checksum:  row.Checksum,
		FileName:  row.FileName,
		FileSize:  row.FileSize,
		Manifest:  decodeJSONValue(row.Manifest),
		CreatedBy: uuidToString(row.CreatedBy),
		CreatedAt: timestampToString(row.CreatedAt),
	}
}

func versionSummaryFromList(row db.ListProcessTemplateVersionsRow) processTemplateVersionSummary {
	return processTemplateVersionSummary{
		ID:        uuidToString(row.ID),
		Version:   row.Version,
		Checksum:  row.Checksum,
		FileName:  row.FileName,
		FileSize:  row.FileSize,
		Manifest:  decodeJSONValue(row.Manifest),
		CreatedBy: uuidToString(row.CreatedBy),
		CreatedAt: timestampToString(row.CreatedAt),
	}
}

func workspaceProcessTemplateToResponse(row db.ListWorkspaceProcessTemplatesRow) processTemplateResponse {
	resp := processTemplateResponse{
		ID:          uuidToString(row.ID),
		Slug:        row.Slug,
		Name:        row.Name,
		Description: row.Description,
		CreatedAt:   timestampToString(row.CreatedAt),
		UpdatedAt:   timestampToString(row.UpdatedAt),
	}
	if row.LatestVersionID.Valid {
		resp.LatestVersion = &processTemplateVersionSummary{
			ID:       uuidToString(row.LatestVersionID),
			Version:  row.LatestVersion,
			Checksum: row.LatestChecksum,
			FileName: row.LatestFileName,
			FileSize: row.LatestFileSize,
			Manifest: decodeJSONValue(row.LatestManifest),
		}
	}
	if row.InstalledVersionID.Valid {
		resp.Installed = true
		installedVersion := int32(0)
		if row.InstalledVersion.Valid {
			installedVersion = row.InstalledVersion.Int32
		}
		resp.InstalledVersion = &processTemplateVersionSummary{
			ID:      uuidToString(row.InstalledVersionID),
			Version: installedVersion,
		}
		resp.AppliedAt = timestampToString(row.AppliedAt)
		resp.AppliedBy = uuidToString(row.AppliedBy)
		if resp.LatestVersion != nil && resp.LatestVersion.Version > installedVersion {
			resp.CanUpgrade = true
		}
	}
	return resp
}

func decodeJSONValue(raw []byte) any {
	if len(bytesTrimSpace(raw)) == 0 {
		return map[string]any{}
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{}
	}
	return value
}

func bytesTrimSpace(raw []byte) []byte {
	return []byte(strings.TrimSpace(string(raw)))
}

func (h *Handler) ListSystemProcessTemplates(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	rows, err := h.Queries.ListProcessTemplates(r.Context())
	if err != nil {
		slog.Warn("ListSystemProcessTemplates failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list process templates")
		return
	}
	resp := make([]processTemplateResponse, 0, len(rows))
	for _, row := range rows {
		resp = append(resp, processTemplateToResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": resp, "total": len(resp)})
}

func (h *Handler) GetSystemProcessTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "template id")
	if !ok {
		return
	}
	template, err := h.Queries.GetProcessTemplate(r.Context(), id)
	if isNotFound(err) {
		writeError(w, http.StatusNotFound, "process template not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get process template")
		return
	}
	latest, latestErr := h.Queries.GetLatestProcessTemplateVersion(r.Context(), template.ID)
	if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to get process template version")
		return
	}
	writeJSON(w, http.StatusOK, processTemplateDetail(template, latest, latestErr))
}

func (h *Handler) CreateSystemProcessTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	form, err := parseProcessTemplateForm(r, true)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProcessTemplateTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, err.Error())
		return
	}
	_, checksum, manifest, err := inspectProcessTemplateZip(form.Zip)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	slug, err := resolveProcessTemplateSlug(form.Slug, form.Name, checksum)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	createdBy := parseUUID(userID)
	template, err := h.Queries.CreateProcessTemplate(r.Context(), db.CreateProcessTemplateParams{
		Slug:        slug,
		Name:        form.Name,
		Description: form.Description,
		CreatedBy:   createdBy,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, fmt.Sprintf("a process template with slug %q already exists", slug))
			return
		}
		slog.Warn("CreateSystemProcessTemplate failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create process template")
		return
	}
	version, err := h.Queries.CreateProcessTemplateVersion(r.Context(), db.CreateProcessTemplateVersionParams{
		TemplateID: template.ID,
		Version:    1,
		Checksum:   checksum,
		FileName:   form.FileName,
		FileSize:   int64(len(form.Zip)),
		ZipData:    form.Zip,
		Manifest:   manifest,
		CreatedBy:  createdBy,
	})
	if err != nil {
		slog.Warn("CreateSystemProcessTemplate version failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to store process template zip")
		return
	}
	resp := processTemplateDetail(template, db.GetLatestProcessTemplateVersionRow{}, errors.New("skip"))
	resp.LatestVersion = versionSummaryFromCreate(version)
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) PushSystemProcessTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	form, err := parseProcessTemplateFormOptions(r, processTemplateFormOptions{
		RequireZip:     true,
		AllowEmptyName: true,
	})
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProcessTemplateTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, err.Error())
		return
	}
	_, checksum, manifest, err := inspectProcessTemplateZip(form.Zip)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	slug, err := resolveProcessTemplatePushSlug(form.Slug, form.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	createdBy := parseUUID(userID)
	existing, err := h.Queries.GetProcessTemplateBySlug(r.Context(), slug)
	if err != nil && !isNotFound(err) {
		writeError(w, http.StatusInternalServerError, "failed to get process template")
		return
	}
	if isNotFound(err) {
		if form.Name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
		template, createErr := h.Queries.CreateProcessTemplate(r.Context(), db.CreateProcessTemplateParams{
			Slug:        slug,
			Name:        form.Name,
			Description: form.Description,
			CreatedBy:   createdBy,
		})
		if createErr != nil {
			if isUniqueViolation(createErr) {
				existing, err = h.Queries.GetProcessTemplateBySlug(r.Context(), slug)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "failed to get process template")
					return
				}
				h.updatePushedProcessTemplate(w, r, existing, form, checksum, manifest, createdBy)
				return
			}
			slog.Warn("PushSystemProcessTemplate create failed", append(logger.RequestAttrs(r), "error", createErr)...)
			writeError(w, http.StatusInternalServerError, "failed to create process template")
			return
		}
		version, versionErr := h.Queries.CreateProcessTemplateVersion(r.Context(), db.CreateProcessTemplateVersionParams{
			TemplateID: template.ID,
			Version:    1,
			Checksum:   checksum,
			FileName:   form.FileName,
			FileSize:   int64(len(form.Zip)),
			ZipData:    form.Zip,
			Manifest:   manifest,
			CreatedBy:  createdBy,
		})
		if versionErr != nil {
			slog.Warn("PushSystemProcessTemplate version failed", append(logger.RequestAttrs(r), "error", versionErr)...)
			writeError(w, http.StatusInternalServerError, "failed to store process template zip")
			return
		}
		resp := processTemplateDetail(template, db.GetLatestProcessTemplateVersionRow{}, errors.New("skip"))
		resp.LatestVersion = versionSummaryFromCreate(version)
		writeJSON(w, http.StatusCreated, resp)
		return
	}
	h.updatePushedProcessTemplate(w, r, existing, form, checksum, manifest, createdBy)
}

func (h *Handler) updatePushedProcessTemplate(
	w http.ResponseWriter,
	r *http.Request,
	existing db.ProcessTemplate,
	form processTemplateForm,
	checksum string,
	manifest []byte,
	createdBy pgtype.UUID,
) {
	name := existing.Name
	if form.Name != "" {
		name = form.Name
	}
	description := existing.Description
	if formHasDescription(r) {
		description = form.Description
	}
	template := existing
	if name != existing.Name || description != existing.Description {
		updated, err := h.Queries.UpdateProcessTemplate(r.Context(), db.UpdateProcessTemplateParams{
			ID:          existing.ID,
			Slug:        existing.Slug,
			Name:        name,
			Description: description,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update process template")
			return
		}
		template = updated
	}
	latest, latestErr := h.Queries.GetLatestProcessTemplateVersion(r.Context(), template.ID)
	if latestErr != nil && !isNotFound(latestErr) {
		writeError(w, http.StatusInternalServerError, "failed to get process template version")
		return
	}
	if latestErr == nil && checksum == latest.Checksum {
		writeJSON(w, http.StatusOK, processTemplateDetail(template, latest, nil))
		return
	}
	nextVersion := int32(1)
	if latestErr == nil {
		nextVersion = latest.Version + 1
	}
	created, err := h.Queries.CreateProcessTemplateVersion(r.Context(), db.CreateProcessTemplateVersionParams{
		TemplateID: template.ID,
		Version:    nextVersion,
		Checksum:   checksum,
		FileName:   form.FileName,
		FileSize:   int64(len(form.Zip)),
		ZipData:    form.Zip,
		Manifest:   manifest,
		CreatedBy:  createdBy,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store process template zip")
		return
	}
	_ = h.Queries.TouchProcessTemplate(r.Context(), template.ID)
	resp := processTemplateDetail(template, db.GetLatestProcessTemplateVersionRow{}, errors.New("skip"))
	resp.LatestVersion = versionSummaryFromCreate(created)
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) UpdateSystemProcessTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "template id")
	if !ok {
		return
	}
	existing, err := h.Queries.GetProcessTemplate(r.Context(), id)
	if isNotFound(err) {
		writeError(w, http.StatusNotFound, "process template not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get process template")
		return
	}
	form, err := parseProcessTemplateForm(r, false)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errProcessTemplateTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, err.Error())
		return
	}
	name := form.Name
	if name == "" {
		name = existing.Name
	}
	description := form.Description
	if !formHasDescription(r) && form.Description == "" {
		description = existing.Description
	}
	slug := existing.Slug
	if strings.TrimSpace(form.Slug) != "" {
		resolved, slugErr := resolveProcessTemplateSlug(form.Slug, name, "")
		if slugErr != nil {
			writeError(w, http.StatusBadRequest, slugErr.Error())
			return
		}
		slug = resolved
	}
	template, err := h.Queries.UpdateProcessTemplate(r.Context(), db.UpdateProcessTemplateParams{
		ID:          existing.ID,
		Slug:        slug,
		Name:        name,
		Description: description,
	})
	if isNotFound(err) {
		writeError(w, http.StatusNotFound, "process template not found")
		return
	}
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, fmt.Sprintf("a process template with slug %q already exists", slug))
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update process template")
		return
	}

	latest, latestErr := h.Queries.GetLatestProcessTemplateVersion(r.Context(), template.ID)
	if latestErr != nil && !errors.Is(latestErr, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to get process template version")
		return
	}
	if form.HasZip {
		_, checksum, manifest, zipErr := inspectProcessTemplateZip(form.Zip)
		if zipErr != nil {
			writeError(w, http.StatusBadRequest, zipErr.Error())
			return
		}
		nextVersion := int32(1)
		if latestErr == nil {
			if checksum == latest.Checksum {
				writeJSON(w, http.StatusOK, processTemplateDetail(template, latest, nil))
				return
			}
			nextVersion = latest.Version + 1
		}
		created, createErr := h.Queries.CreateProcessTemplateVersion(r.Context(), db.CreateProcessTemplateVersionParams{
			TemplateID: template.ID,
			Version:    nextVersion,
			Checksum:   checksum,
			FileName:   form.FileName,
			FileSize:   int64(len(form.Zip)),
			ZipData:    form.Zip,
			Manifest:   manifest,
			CreatedBy:  parseUUID(userID),
		})
		if createErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to store process template zip")
			return
		}
		_ = h.Queries.TouchProcessTemplate(r.Context(), template.ID)
		resp := processTemplateDetail(template, db.GetLatestProcessTemplateVersionRow{}, errors.New("skip"))
		resp.LatestVersion = versionSummaryFromCreate(created)
		writeJSON(w, http.StatusOK, resp)
		return
	}
	writeJSON(w, http.StatusOK, processTemplateDetail(template, latest, latestErr))
}

func (h *Handler) DeleteSystemProcessTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "template id")
	if !ok {
		return
	}
	if _, err := h.Queries.DeleteProcessTemplate(r.Context(), id); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "process template not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete process template")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListSystemProcessTemplateVersions(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "template id")
	if !ok {
		return
	}
	if _, err := h.Queries.GetProcessTemplate(r.Context(), id); err != nil {
		if isNotFound(err) {
			writeError(w, http.StatusNotFound, "process template not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get process template")
		return
	}
	rows, err := h.Queries.ListProcessTemplateVersions(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list process template versions")
		return
	}
	resp := make([]processTemplateVersionSummary, 0, len(rows))
	for _, row := range rows {
		resp = append(resp, versionSummaryFromList(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": resp, "total": len(resp)})
}

func (h *Handler) DownloadSystemProcessTemplateVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	id, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "template id")
	if !ok {
		return
	}
	versionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}
	version, err := h.Queries.GetProcessTemplateVersionInTemplate(r.Context(), db.GetProcessTemplateVersionInTemplateParams{
		ID:         versionID,
		TemplateID: id,
	})
	if isNotFound(err) {
		writeError(w, http.StatusNotFound, "process template version not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get process template version")
		return
	}
	zipData, err := h.Queries.GetProcessTemplateVersionZip(r.Context(), version.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to download process template")
		return
	}
	fileName := version.FileName
	if fileName == "" {
		fileName = "process-template.zip"
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, fileName))
	w.Header().Set("Content-Length", strconv.Itoa(len(zipData)))
	_, _ = w.Write(zipData)
}

func (h *Handler) ListWorkspaceProcessTemplates(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	rows, err := h.Queries.ListWorkspaceProcessTemplates(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list process templates")
		return
	}
	resp := make([]processTemplateResponse, 0, len(rows))
	for _, row := range rows {
		resp = append(resp, workspaceProcessTemplateToResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": resp, "total": len(resp)})
}

var errProcessTemplateTooLarge = errors.New("zip archive exceeds 20MB")

type processTemplateFormOptions struct {
	RequireZip     bool
	AllowEmptyName bool
}

func parseProcessTemplateForm(r *http.Request, requireZip bool) (processTemplateForm, error) {
	return parseProcessTemplateFormOptions(r, processTemplateFormOptions{
		RequireZip:     requireZip,
		AllowEmptyName: !requireZip,
	})
}

func parseProcessTemplateFormOptions(r *http.Request, opts processTemplateFormOptions) (processTemplateForm, error) {
	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		r.Body = http.MaxBytesReader(nil, r.Body, processtemplate.MaxZipSize+multipartOverheadBytes)
		if err := r.ParseMultipartForm(processtemplate.MaxZipSize + multipartOverheadBytes); err != nil {
			return processTemplateForm{}, errProcessTemplateTooLarge
		}
		form := processTemplateForm{
			Name:        strings.TrimSpace(r.FormValue("name")),
			Description: strings.TrimSpace(r.FormValue("description")),
			Slug:        strings.TrimSpace(r.FormValue("slug")),
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			file, header, err = r.FormFile("bundle")
		}
		if err == nil {
			defer file.Close()
			data, readErr := io.ReadAll(io.LimitReader(file, processtemplate.MaxZipSize+1))
			if readErr != nil {
				return processTemplateForm{}, fmt.Errorf("failed to read zip archive")
			}
			if len(data) > processtemplate.MaxZipSize {
				return processTemplateForm{}, errProcessTemplateTooLarge
			}
			form.Zip = data
			form.HasZip = true
			form.FileName = sanitizeZipFileName(header.Filename)
		}
		if err := validateProcessTemplateMetadata(form.Name, form.Description, opts.AllowEmptyName); err != nil {
			return processTemplateForm{}, err
		}
		if opts.RequireZip && !form.HasZip {
			return processTemplateForm{}, fmt.Errorf("a zip archive is required")
		}
		return form, nil
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Slug        string `json:"slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return processTemplateForm{}, fmt.Errorf("invalid request body")
	}
	form := processTemplateForm{
		Name:        strings.TrimSpace(req.Name),
		Description: strings.TrimSpace(req.Description),
		Slug:        strings.TrimSpace(req.Slug),
	}
	if err := validateProcessTemplateMetadata(form.Name, form.Description, opts.AllowEmptyName); err != nil {
		return processTemplateForm{}, err
	}
	if opts.RequireZip {
		return processTemplateForm{}, fmt.Errorf("a zip archive is required")
	}
	return form, nil
}

func formHasDescription(r *http.Request) bool {
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if r.MultipartForm == nil {
			return false
		}
		_, ok := r.MultipartForm.Value["description"]
		return ok
	}
	return true
}

func validateProcessTemplateMetadata(name, description string, allowEmptyName bool) error {
	if !allowEmptyName && name == "" {
		return fmt.Errorf("name is required")
	}
	if utf8.RuneCountInString(name) > maxProcessTemplateNameLength {
		return fmt.Errorf("name is too long")
	}
	if utf8.RuneCountInString(description) > maxProcessTemplateDescLength {
		return fmt.Errorf("description is too long")
	}
	return nil
}

func resolveProcessTemplateSlug(raw, name, checksum string) (string, error) {
	slug := processtemplate.Slugify(raw)
	if slug == "" {
		slug = processtemplate.Slugify(name)
	}
	if slug == "" {
		suffix := checksum
		if len(suffix) < 8 {
			sum := sha256.Sum256([]byte(name + raw))
			suffix = hex.EncodeToString(sum[:])
		}
		slug = "template-" + suffix[:8]
	}
	if len(slug) > maxProcessTemplateSlugLength {
		return "", fmt.Errorf("slug is too long")
	}
	return slug, nil
}

func resolveProcessTemplatePushSlug(raw, name string) (string, error) {
	slug := processtemplate.Slugify(raw)
	if slug == "" {
		slug = processtemplate.Slugify(name)
	}
	if slug == "" {
		return "", fmt.Errorf("slug is required")
	}
	if len(slug) > maxProcessTemplateSlugLength {
		return "", fmt.Errorf("slug is too long")
	}
	return slug, nil
}

func inspectProcessTemplateZip(data []byte) (processtemplate.Archive, string, []byte, error) {
	archive, err := processtemplate.ParseZip(data)
	if err != nil {
		return processtemplate.Archive{}, "", nil, err
	}
	sum := sha256.Sum256(data)
	checksum := hex.EncodeToString(sum[:])
	manifest, err := json.Marshal(archive.Manifest())
	if err != nil {
		return processtemplate.Archive{}, "", nil, fmt.Errorf("failed to encode template manifest")
	}
	return archive, checksum, manifest, nil
}

func sanitizeZipFileName(name string) string {
	base := path.Base(strings.ReplaceAll(strings.TrimSpace(name), "\\", "/"))
	base = strings.Trim(base, ".")
	if base == "" || base == "." || base == "/" {
		return "process-template.zip"
	}
	return base
}
