package handler

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/opencontent"
)

const maxOpenContentRequestBytes = 64 << 20

// OpenContentProxy forwards only the operations registered by the oc-basic
// skill. The Authorization header is the caller's OpenContent API key and is
// forwarded by the opencontent client; Multica never stores that credential.
func (h *Handler) OpenContentProxy(w http.ResponseWriter, r *http.Request) {
	if h.OpenContent == nil || !h.OpenContent.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "OpenContent is not configured")
		return
	}

	operation := opencontent.Operation(strings.TrimSpace(chi.URLParam(r, "operation")))
	if operation == "" {
		writeError(w, http.StatusNotFound, "OpenContent operation is required")
		return
	}
	authRequired := operation != opencontent.OperationAuthPublicKey
	if authRequired {
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(authHeader) < 8 || !strings.EqualFold(authHeader[:7], "Bearer ") || strings.TrimSpace(authHeader[7:]) == "" {
			writeError(w, http.StatusUnauthorized, "OpenContent API key bearer authorization is required")
			return
		}
	}
	method, known := h.OpenContent.MethodFor(operation)
	if !known {
		writeError(w, http.StatusNotFound, "unsupported OpenContent operation")
		return
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		writeError(w, http.StatusMethodNotAllowed, "unsupported HTTP method for OpenContent operation")
		return
	}
	if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
		limit := int64(maxOpenContentRequestBytes)
		if operation == opencontent.OperationUpload || operation == opencontent.OperationUploadMulti {
			limit = h.OpenContent.MaxUploadBytes()
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "OpenContent request body is too large")
			return
		}
		writeError(w, http.StatusBadRequest, "failed to read OpenContent request")
		return
	}
	if operation == opencontent.OperationUpload || operation == opencontent.OperationUploadMulti {
		if err := h.OpenContent.ValidateUpload(body, r.Header.Get("Content-Type")); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	resp, err := h.OpenContent.Do(r.Context(), operation, body, r.URL.Query(), r.Header)
	if err != nil {
		if errors.Is(err, opencontent.ErrDisabled) {
			writeError(w, http.StatusServiceUnavailable, "OpenContent is not configured")
			return
		}
		writeError(w, http.StatusBadGateway, "OpenContent upstream request failed")
		return
	}
	defer resp.Body.Close()
	for key, values := range resp.Header {
		if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
