package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	maxProductNameLength      = 128
	maxProductDirectoryLength = 1024
	maxProductRemarkLength    = 2000
)

type ProductResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type ProductRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type productVersionBinding struct {
	ProductID        pgtype.UUID
	ProductVersionID pgtype.UUID
}

func productToResponse(product db.Product) ProductResponse {
	return ProductResponse{
		ID:          uuidToString(product.ID),
		Name:        product.Name,
		Description: product.Description,
		CreatedAt:   timestampToString(product.CreatedAt),
		UpdatedAt:   timestampToString(product.UpdatedAt),
	}
}

func validateProductField(field, raw string, maxLength int, required bool) (string, error) {
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", errors.New(field + " cannot contain control characters")
		}
	}
	value := strings.TrimSpace(raw)
	if required && value == "" {
		return "", errors.New(field + " is required")
	}
	if utf8.RuneCountInString(value) > maxLength {
		return "", errors.New(field + " is too long")
	}
	return value, nil
}

func unsetOptionalUUIDString(raw *string) *string {
	if raw == nil {
		return nil
	}
	if strings.TrimSpace(*raw) == "" {
		return nil
	}
	return raw
}

func (h *Handler) parseProductVersionBinding(w http.ResponseWriter, r *http.Request, productRaw, versionRaw *string) (productVersionBinding, bool) {
	var out productVersionBinding
	productRaw = unsetOptionalUUIDString(productRaw)
	versionRaw = unsetOptionalUUIDString(versionRaw)
	if productRaw != nil {
		id, ok := parseUUIDOrBadRequest(w, *productRaw, "product_id")
		if !ok {
			return out, false
		}
		if _, err := h.Queries.GetProduct(r.Context(), id); err != nil {
			if isNotFound(err) {
				writeError(w, http.StatusBadRequest, "product not found")
				return out, false
			}
			slog.Error("validate product", append(logger.RequestAttrs(r), "product_id", uuidToString(id), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to validate product")
			return out, false
		}
		out.ProductID = id
	}
	if versionRaw != nil {
		id, ok := parseUUIDOrBadRequest(w, *versionRaw, "product_version_id")
		if !ok {
			return out, false
		}
		version, err := h.Queries.GetProductVersion(r.Context(), id)
		if err != nil {
			if isNotFound(err) {
				writeError(w, http.StatusBadRequest, "product version not found")
				return out, false
			}
			writeError(w, http.StatusInternalServerError, "failed to validate product version")
			return out, false
		}
		if out.ProductID.Valid && version.ProductID != out.ProductID {
			writeError(w, http.StatusBadRequest, "product version does not belong to product")
			return out, false
		}
		if !out.ProductID.Valid {
			out.ProductID = version.ProductID
		}
		out.ProductVersionID = id
	}
	return out, true
}

func (h *Handler) ListSystemProducts(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	h.listProducts(w, r)
}

func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	h.listProducts(w, r)
}

func (h *Handler) listProducts(w http.ResponseWriter, r *http.Request) {
	products, err := h.Queries.ListProducts(r.Context())
	if err != nil {
		slog.Warn("ListSystemProducts failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to list products")
		return
	}
	response := make([]ProductResponse, len(products))
	for i, product := range products {
		response[i] = productToResponse(product)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"products": response,
		"total":    len(response),
	})
}

func (h *Handler) GetSystemProduct(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	h.getProduct(w, r)
}

func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	h.getProduct(w, r)
}

func (h *Handler) getProduct(w http.ResponseWriter, r *http.Request) {
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return
	}
	product, err := h.Queries.GetProduct(r.Context(), idUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "product not found")
		return
	}
	if err != nil {
		slog.Warn("GetSystemProduct failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to get product")
		return
	}
	writeJSON(w, http.StatusOK, productToResponse(product))
}

func (h *Handler) CreateSystemProduct(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	var request ProductRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, err := validateProductField("name", request.Name, maxProductNameLength, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	description, err := validateProductField("description", request.Description, maxProductRemarkLength, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	product, err := h.Queries.CreateProduct(r.Context(), db.CreateProductParams{
		Name: name, Description: description,
	})
	if err != nil {
		slog.Warn("CreateSystemProduct failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to create product")
		return
	}
	writeJSON(w, http.StatusCreated, productToResponse(product))
}

func (h *Handler) UpdateSystemProduct(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return
	}
	var request ProductRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, err := validateProductField("name", request.Name, maxProductNameLength, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	description, err := validateProductField("description", request.Description, maxProductRemarkLength, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	product, err := h.Queries.UpdateProduct(r.Context(), db.UpdateProductParams{
		ID: idUUID, Name: name, Description: description,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "product not found")
		return
	}
	if err != nil {
		slog.Warn("UpdateSystemProduct failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to update product")
		return
	}
	writeJSON(w, http.StatusOK, productToResponse(product))
}

func (h *Handler) DeleteSystemProduct(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}
	idUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return
	}
	_, err := h.Queries.DeleteProduct(r.Context(), idUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "product not found")
		return
	}
	if err != nil {
		slog.Warn("DeleteSystemProduct failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to delete product")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
