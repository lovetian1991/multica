package handler

import (
	"errors"
	"fmt"
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

	// 对于非上传操作，限制请求体大小
	if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
		if operation != opencontent.OperationUpload && operation != opencontent.OperationUploadMulti && operation != opencontent.OperationUploadCheck {
			r.Body = http.MaxBytesReader(w, r.Body, maxOpenContentRequestBytes)
		}
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

	// 验证 upload-check 请求
	if operation == opencontent.OperationUploadCheck {
		if err := opencontent.ValidateUploadCheck(body, h.OpenContent.MaxUploadBytes(), h.OpenContent.AllowedExtensions()); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Upload validation failed: %s", err.Error()))
			return
		}
	}

	resp, err := h.OpenContent.Do(r.Context(), operation, body, r.URL.Query(), r.Header)
	if err != nil {
		if errors.Is(err, opencontent.ErrDisabled) {
			writeError(w, http.StatusServiceUnavailable, "OpenContent is not configured")
			return
		}
		if errors.Is(err, opencontent.ErrResponseTooLarge) {
			writeError(w, http.StatusBadGateway, "OpenContent response exceeds configured limit")
			return
		}
		writeError(w, http.StatusBadGateway, "OpenContent upstream request failed")
		return
	}
	defer resp.Body.Close()

	// 上传和下载操作需要流式转发，不能缓存整个响应
	streaming := operation == opencontent.OperationUpload || operation == opencontent.OperationUploadMulti || operation == opencontent.OperationDownload
	if streaming {
		// 流式转发响应头和响应体
		for key, values := range resp.Header {
			if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Transfer-Encoding") {
				continue
			}
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		// 对于流式传输，保留原始 Content-Length
		if resp.ContentLength >= 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", resp.ContentLength))
		}
		w.WriteHeader(resp.StatusCode)
		_, copyErr := io.Copy(w, resp.Body)
		if copyErr != nil && !errors.Is(copyErr, opencontent.ErrResponseTooLarge) {
			// 流式传输错误：已经写了响应头，无法返回 writeError
			// 记录错误但继续
		}
		return
	}

	// 非上传操作：读取完整响应以处理错误消息
	if resp.StatusCode != http.StatusOK {
		respBody, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			if errors.Is(readErr, opencontent.ErrResponseTooLarge) {
				writeError(w, http.StatusBadGateway, "OpenContent response exceeds configured limit")
				return
			}
			writeError(w, http.StatusBadGateway, "OpenContent upstream request failed")
			return
		}
		message := strings.TrimSpace(string(respBody))
		if message == "" {
			message = fmt.Sprintf("OpenContent upstream returned HTTP %d", resp.StatusCode)
		} else {
			message = fmt.Sprintf("OpenContent upstream returned HTTP %d: %s", resp.StatusCode, message)
		}
		writeError(w, http.StatusBadGateway, message)
		return
	}
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		if errors.Is(err, opencontent.ErrResponseTooLarge) {
			writeError(w, http.StatusBadGateway, "OpenContent response exceeds configured limit")
			return
		}
		writeError(w, http.StatusBadGateway, "OpenContent upstream request failed")
		return
	}
	for key, values := range resp.Header {
		if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Transfer-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(respBody)))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
}
