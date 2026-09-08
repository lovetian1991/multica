package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/logger"
)

type KBFolder struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	ParentID string `json:"parent_id"`
}

type GetFolderChildrenResponse struct {
	Folders []KBFolder `json:"folders"`
	Total   int        `json:"total"`
}

type kbGetFolderChildrenRequest struct {
	FolderID string `json:"folderId"`
	PageNum  int    `json:"pageNum"`
	PageSize int    `json:"pageSize"`
}

// GetKBFolderChildren 获取KB文件夹子项
func (h *Handler) GetKBFolderChildren(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}

	folderID := r.URL.Query().Get("folder_id")
	if folderID == "" {
		folderID = "0" // root folder
	}

	// 获取系统设置
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

	// 解密集成密钥
	if h.SystemSettingsSecretBox == nil {
		writeError(w, http.StatusServiceUnavailable, "system settings secret encryption is not configured")
		return
	}

	encryptedKeyBytes, err := base64.StdEncoding.DecodeString(settings.KbIntegrationKeyEncrypted)
	if err != nil {
		slog.Warn("Failed to decode kb integration key", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to decrypt kb integration key")
		return
	}

	integrationKey, err := h.SystemSettingsSecretBox.Open(encryptedKeyBytes)
	if err != nil {
		slog.Warn("Failed to decrypt kb integration key", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to decrypt kb integration key")
		return
	}

	// 调用KB API
	folders, err := callKBGetFolderChildren(settings.KbEnvironmentUrl, string(integrationKey), folderID)
	if err != nil {
		slog.Warn("KB API call failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to get kb folders: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, GetFolderChildrenResponse{
		Folders: folders,
		Total:   len(folders),
	})
}

func callKBGetFolderChildren(baseURL, integrationKey, folderID string) ([]KBFolder, error) {
	apiURL := fmt.Sprintf("%s/FlatDms/v800/Document/DocList/GetFolderChildren", baseURL)

	requestBody := kbGetFolderChildrenRequest{
		FolderID: folderID,
		PageNum:  1,
		PageSize: 100,
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request body: %w", err)
	}

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", integrationKey))

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call kb api: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("kb api returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var apiResponse struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    struct {
			Items []struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Type     string `json:"type"`
				ParentID string `json:"parentId"`
			} `json:"items"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResponse); err != nil {
		return nil, fmt.Errorf("failed to decode kb response: %w", err)
	}

	if apiResponse.Code != 0 {
		return nil, fmt.Errorf("kb api error: %s", apiResponse.Message)
	}

	folders := make([]KBFolder, 0, len(apiResponse.Data.Items))
	for _, item := range apiResponse.Data.Items {
		// Only include folders, not files
		if item.Type == "folder" || item.Type == "directory" {
			folders = append(folders, KBFolder{
				ID:       item.ID,
				Name:     item.Name,
				Type:     item.Type,
				ParentID: item.ParentID,
			})
		}
	}

	return folders, nil
}
