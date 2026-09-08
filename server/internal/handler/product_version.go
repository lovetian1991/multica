package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	maxProductVersionNameLength      = 128
	maxProductVersionDirectoryLength = 1024
	maxProductVersionRemarkLength    = 2000
)

type ProductVersionResponse struct {
	ID        string `json:"id"`
	ProductID string `json:"product_id"`
	Name      string `json:"name"`
	Directory string `json:"directory"`
	Remark    string `json:"remark"`
	FolderID  string `json:"folder_id"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type ProductVersionRequest struct {
	Name      string `json:"name"`
	Directory string `json:"directory"`
	Remark    string `json:"remark"`
	FolderID  string `json:"folder_id"`
}

func productVersionToResponse(version db.ProductVersion) ProductVersionResponse {
	return ProductVersionResponse{
		ID:        uuidToString(version.ID),
		ProductID: uuidToString(version.ProductID),
		Name:      version.Name,
		Directory: version.Directory,
		Remark:    version.Remark,
		FolderID:  version.FolderID,
		CreatedAt: timestampToString(version.CreatedAt),
		UpdatedAt: timestampToString(version.UpdatedAt),
	}
}

func (h *Handler) ListSystemProductVersions(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	h.listProductVersions(w, r)
}

func (h *Handler) ListProductVersions(w http.ResponseWriter, r *http.Request) {
	h.listProductVersions(w, r)
}

func (h *Handler) listProductVersions(w http.ResponseWriter, r *http.Request) {
	productIDUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return
	}
	versions, err := h.Queries.ListProductVersions(r.Context(), productIDUUID)
	if err != nil {
		slog.Warn("ListProductVersions failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list product versions")
		return
	}
	response := make([]ProductVersionResponse, len(versions))
	for i, version := range versions {
		response[i] = productVersionToResponse(version)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"versions": response,
		"total":    len(response),
	})
}

func (h *Handler) GetSystemProductVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	h.getProductVersion(w, r)
}

func (h *Handler) GetProductVersion(w http.ResponseWriter, r *http.Request) {
	h.getProductVersion(w, r)
}

func (h *Handler) getProductVersion(w http.ResponseWriter, r *http.Request) {
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}
	version, err := h.Queries.GetProductVersion(r.Context(), idUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "product version not found")
		return
	}
	if err != nil {
		slog.Warn("GetProductVersion failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to get product version")
		return
	}
	writeJSON(w, http.StatusOK, productVersionToResponse(version))
}

func (h *Handler) CreateSystemProductVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	productIDUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return
	}
	var request ProductVersionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, directory, remark, ok := validateProductVersionRequest(w, request)
	if !ok {
		return
	}
	version, err := h.Queries.CreateProductVersion(r.Context(), db.CreateProductVersionParams{
		ProductID: productIDUUID,
		Name:      name,
		Directory: directory,
		Remark:    remark,
		FolderID:  strings.TrimSpace(request.FolderID),
	})
	if err != nil {
		slog.Warn("CreateProductVersion failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create product version")
		return
	}
	writeJSON(w, http.StatusCreated, productVersionToResponse(version))
}

func (h *Handler) UpdateSystemProductVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}
	var request ProductVersionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, directory, remark, ok := validateProductVersionRequest(w, request)
	if !ok {
		return
	}
	version, err := h.Queries.UpdateProductVersion(r.Context(), db.UpdateProductVersionParams{
		ID:        idUUID,
		Name:      name,
		Directory: directory,
		Remark:    remark,
		FolderID:  strings.TrimSpace(request.FolderID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "product version not found")
		return
	}
	if err != nil {
		slog.Warn("UpdateProductVersion failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update product version")
		return
	}
	writeJSON(w, http.StatusOK, productVersionToResponse(version))
}

func (h *Handler) DeleteSystemProductVersion(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}
	_, err := h.Queries.DeleteProductVersion(r.Context(), idUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "product version not found")
		return
	}
	if err != nil {
		slog.Warn("DeleteProductVersion failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to delete product version")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validateProductVersionRequest(w http.ResponseWriter, request ProductVersionRequest) (string, string, string, bool) {
	name, err := validateProductField("name", request.Name, maxProductVersionNameLength, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", "", "", false
	}
	directory, err := validateProductField("directory", request.Directory, maxProductVersionDirectoryLength, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", "", "", false
	}
	remark, err := validateProductField("remark", request.Remark, maxProductVersionRemarkLength, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", "", "", false
	}
	return name, directory, remark, true
}
