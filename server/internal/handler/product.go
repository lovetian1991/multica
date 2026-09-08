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
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	maxProductNameLength      = 128
	maxProductDirectoryLength = 1024
	maxProductRemarkLength    = 2000
)

type ProductResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type ProductRequest struct {
	Name string `json:"name"`
}

func productToResponse(product db.Product) ProductResponse {
	return ProductResponse{
		ID:        uuidToString(product.ID),
		Name:      product.Name,
		CreatedAt: timestampToString(product.CreatedAt),
		UpdatedAt: timestampToString(product.UpdatedAt),
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
	product, err := h.Queries.CreateProduct(r.Context(), name)
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
	product, err := h.Queries.UpdateProduct(r.Context(), db.UpdateProductParams{
		ID: idUUID, Name: name,
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
