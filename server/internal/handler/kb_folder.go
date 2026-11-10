package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/opencontent"
)

type KBFolderTreeNode struct {
	FolderID       string `json:"id"`
	FolderName     string `json:"name"`
	FolderPath     string `json:"folder_path"`
	ParentFolderID string `json:"parent_id"`
}

type GetFolderTreeResponse struct {
	TotalCount    int                `json:"total_count"`
	CurrentFolder *KBFolderTreeNode  `json:"current_folder"`
	Folders       []KBFolderTreeNode `json:"folders"`
}

type kbFolderTreeRequest struct {
	Token          string `json:"Token"`
	ParentFolderID string `json:"ParentFolderId"`
	SortField      string `json:"SortField"`
	PageIndex      int    `json:"PageIndex"`
}

type kbFolderTreeUpstreamNode struct {
	FolderID       int64  `json:"folderId"`
	FolderName     string `json:"folderName"`
	FolderPath     string `json:"folderPath"`
	ParentFolderID int64  `json:"parentFolderId"`
}

type kbFolderTreeUpstreamResponse struct {
	TotalCount    int                        `json:"totalCount"`
	CurrentFolder *kbFolderTreeUpstreamNode  `json:"currentFolder"`
	Children      []kbFolderTreeUpstreamNode `json:"children"`
}

type kbFolderTreeAPIResponse struct {
	Result int                           `json:"result"`
	Msg    string                        `json:"msg"`
	Data   *kbFolderTreeUpstreamResponse `json:"data"`
	// Keep accepting the unwrapped shape used by older compatible gateways.
	kbFolderTreeUpstreamResponse
}

// rootKBFolderID is the knowledge-base root the system tree browser starts at.
const rootKBFolderID = "1"

// kbFolderTreeError is the status and message a folder-tree fetch wants its
// caller to return. The tree is reached from two entry points that differ only
// in who may ask and which folder they may ask about, so the fetch reports its
// failures instead of writing a response of its own.
type kbFolderTreeError struct {
	status  int
	message string
}

func (h *Handler) GetKBFolderChildren(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}

	folderID := strings.TrimSpace(r.URL.Query().Get("folder_id"))
	if folderID == "" {
		folderID = rootKBFolderID
	}

	h.writeKBFolderTree(w, r, folderID, kbFolderPageIndex(r))
}

// ListProductVersionFolders serves the folders directly under the knowledge-base
// folder a product version is bound to. Issue and task pickers call it for any
// signed-in human, so unlike GetKBFolderChildren it does not require system
// administrator access. The parent folder comes from the version row rather
// than the request, which is what keeps a caller from walking to arbitrary
// knowledge-base folders: paging is the only input that varies.
func (h *Handler) ListProductVersionFolders(w http.ResponseWriter, r *http.Request) {
	productID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "product id")
	if !ok {
		return
	}
	versionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "versionId"), "version id")
	if !ok {
		return
	}

	version, err := h.Queries.GetProductVersion(r.Context(), versionID)
	if isNotFound(err) {
		writeError(w, http.StatusNotFound, "product version not found")
		return
	}
	if err != nil {
		slog.Warn("GetProductVersion failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to get product version")
		return
	}
	if version.ProductID != productID {
		writeError(w, http.StatusNotFound, "product version not found")
		return
	}

	folderID := strings.TrimSpace(version.FolderID)
	if folderID == "" {
		writeError(w, http.StatusBadRequest, "product version has no knowledge base folder")
		return
	}

	h.writeKBFolderTree(w, r, folderID, kbFolderPageIndex(r))
}

// kbFolderPageIndex reads the 1-based page the caller asked for and falls back
// to the first page when the value is missing or unparsable.
func kbFolderPageIndex(r *http.Request) int {
	if value := r.URL.Query().Get("page_index"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return parsed
		}
	}
	return 1
}

func (h *Handler) writeKBFolderTree(w http.ResponseWriter, r *http.Request, folderID string, pageIndex int) {
	response, fetchErr := h.fetchKBFolderTree(r, folderID, pageIndex)
	if fetchErr != nil {
		writeError(w, fetchErr.status, fetchErr.message)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

// fetchKBFolderTree resolves the deployment knowledge-base credentials and asks
// the upstream API for one page of children under folderID.
func (h *Handler) fetchKBFolderTree(r *http.Request, folderID string, pageIndex int) (*GetFolderTreeResponse, *kbFolderTreeError) {
	settings, err := h.Queries.GetSystemSettings(r.Context())
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &kbFolderTreeError{http.StatusBadRequest, "kb settings not configured"}
	}
	if err != nil {
		slog.Warn("GetSystemSettings failed", append(logger.RequestAttrs(r), "error", err)...)
		return nil, &kbFolderTreeError{http.StatusInternalServerError, "failed to load system settings"}
	}

	if settings.KbEnvironmentUrl == "" || settings.KbIntegrationKeyEncrypted == "" {
		return nil, &kbFolderTreeError{http.StatusBadRequest, "kb environment or integration key not configured"}
	}
	if h.SystemSettingsSecretBox == nil {
		return nil, &kbFolderTreeError{http.StatusServiceUnavailable, "system settings secret encryption is not configured"}
	}
	if h.OpenContent == nil {
		return nil, &kbFolderTreeError{http.StatusServiceUnavailable, "OpenContent client is not configured"}
	}

	encryptedKey, err := base64.StdEncoding.DecodeString(settings.KbIntegrationKeyEncrypted)
	if err != nil {
		slog.Warn("Failed to decode kb integration key", append(logger.RequestAttrs(r), "error", err)...)
		return nil, &kbFolderTreeError{http.StatusInternalServerError, "failed to decrypt kb integration key"}
	}

	integrationKey, err := h.SystemSettingsSecretBox.Open(encryptedKey)
	if err != nil {
		slog.Warn("Failed to decrypt kb integration key", append(logger.RequestAttrs(r), "error", err)...)
		return nil, &kbFolderTreeError{http.StatusInternalServerError, "failed to decrypt kb integration key"}
	}

	response, err := callKBGetFolderTree(
		r.Context(),
		h.OpenContent,
		settings.KbEnvironmentUrl,
		string(integrationKey),
		folderID,
		pageIndex,
	)
	if err != nil {
		slog.Warn("KB API call failed", append(logger.RequestAttrs(r), "error", err)...)
		return nil, &kbFolderTreeError{http.StatusBadGateway, "failed to get kb folders"}
	}

	return response, nil
}

func callKBGetFolderTree(
	ctx context.Context,
	client *opencontent.Client,
	baseURL string,
	integrationKey string,
	folderID string,
	pageIndex int,
) (*GetFolderTreeResponse, error) {
	body, err := json.Marshal(kbFolderTreeRequest{
		Token:          integrationKey,
		ParentFolderID: folderID,
		SortField:      "FolderName",
		PageIndex:      pageIndex,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal kb folder tree request: %w", err)
	}

	resp, err := client.DoWithSettings(
		ctx,
		opencontent.OperationFolderTree,
		body,
		nil,
		baseURL,
		integrationKey,
	)
	if err != nil {
		return nil, fmt.Errorf("call kb folder tree API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("kb folder tree API returned HTTP %d", resp.StatusCode)
	}

	var envelope kbFolderTreeAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode kb folder tree response: %w", err)
	}
	if envelope.Result != 0 {
		if envelope.Msg == "" {
			return nil, fmt.Errorf("kb folder tree API returned result %d", envelope.Result)
		}
		return nil, fmt.Errorf("kb folder tree API returned result %d: %s", envelope.Result, envelope.Msg)
	}
	upstream := envelope.kbFolderTreeUpstreamResponse
	if envelope.Data != nil {
		upstream = *envelope.Data
	}

	response := &GetFolderTreeResponse{
		TotalCount: upstream.TotalCount,
		Folders:    make([]KBFolderTreeNode, len(upstream.Children)),
	}
	if upstream.CurrentFolder != nil {
		currentFolder := kbFolderTreeNode(*upstream.CurrentFolder)
		response.CurrentFolder = &currentFolder
	}
	for index, child := range upstream.Children {
		response.Folders[index] = kbFolderTreeNode(child)
	}
	return response, nil
}

func kbFolderTreeNode(node kbFolderTreeUpstreamNode) KBFolderTreeNode {
	return KBFolderTreeNode{
		FolderID:       strconv.FormatInt(node.FolderID, 10),
		FolderName:     node.FolderName,
		FolderPath:     node.FolderPath,
		ParentFolderID: strconv.FormatInt(node.ParentFolderID, 10),
	}
}
