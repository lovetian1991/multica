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

func (h *Handler) GetKBFolderChildren(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}

	folderID := r.URL.Query().Get("folder_id")
	if folderID == "" {
		folderID = "1"
	}

	pageIndex := 1
	if value := r.URL.Query().Get("page_index"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			pageIndex = parsed
		}
	}

	settings, err := h.Queries.GetSystemSettings(r.Context())
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "kb settings not configured")
		return
	}
	if err != nil {
		slog.Warn("GetSystemSettings failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to load system settings")
		return
	}

	if settings.KbEnvironmentUrl == "" || settings.KbIntegrationKeyEncrypted == "" {
		writeError(w, http.StatusBadRequest, "kb environment or integration key not configured")
		return
	}
	if h.SystemSettingsSecretBox == nil {
		writeError(w, http.StatusServiceUnavailable, "system settings secret encryption is not configured")
		return
	}
	if h.OpenContent == nil {
		writeError(w, http.StatusServiceUnavailable, "OpenContent client is not configured")
		return
	}

	encryptedKey, err := base64.StdEncoding.DecodeString(settings.KbIntegrationKeyEncrypted)
	if err != nil {
		slog.Warn("Failed to decode kb integration key", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to decrypt kb integration key")
		return
	}

	integrationKey, err := h.SystemSettingsSecretBox.Open(encryptedKey)
	if err != nil {
		slog.Warn("Failed to decrypt kb integration key", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to decrypt kb integration key")
		return
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
		writeError(w, http.StatusBadGateway, "failed to get kb folders")
		return
	}

	writeJSON(w, http.StatusOK, response)
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
