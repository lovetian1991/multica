package handler

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const (
	maxKBEnvironmentURLLength = 2048
	maxKBIntegrationKeyLength = 4096
)

type SystemSettingsResponse struct {
	KBEnvironmentURL           string `json:"kb_environment_url"`
	KBIntegrationKeyConfigured bool   `json:"kb_integration_key_configured"`
}

type UpdateSystemSettingsRequest struct {
	KBEnvironmentURL string `json:"kb_environment_url"`
	KBIntegrationKey string `json:"kb_integration_key"`
}

func (h *Handler) GetSystemSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}

	settings, err := h.Queries.GetSystemSettings(r.Context())
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, SystemSettingsResponse{})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load system settings")
		return
	}

	writeJSON(w, http.StatusOK, systemSettingsResponse(settings))
}

func (h *Handler) UpdateSystemSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireSystemAdmin(w, r) {
		return
	}

	var request UpdateSystemSettingsRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	environmentURL, err := validateKBEnvironmentURL(request.KBEnvironmentURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if utf8.RuneCountInString(request.KBIntegrationKey) > maxKBIntegrationKeyLength {
		writeError(w, http.StatusBadRequest, "kb integration key is too long")
		return
	}
	for _, r := range request.KBIntegrationKey {
		if unicode.IsControl(r) {
			writeError(w, http.StatusBadRequest, "kb integration key cannot contain control characters")
			return
		}
	}

	current, err := h.Queries.GetSystemSettings(r.Context())
	if errors.Is(err, pgx.ErrNoRows) {
		current = db.SystemSetting{}
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load system settings")
		return
	}

	encryptedKey := current.KbIntegrationKeyEncrypted
	if strings.TrimSpace(request.KBIntegrationKey) != "" {
		if h.SystemSettingsSecretBox == nil {
			writeError(w, http.StatusServiceUnavailable, "system settings secret encryption is not configured")
			return
		}
		sealed, sealErr := h.SystemSettingsSecretBox.Seal([]byte(strings.TrimSpace(request.KBIntegrationKey)))
		if sealErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to encrypt kb integration key")
			return
		}
		encryptedKey = base64.StdEncoding.EncodeToString(sealed)
	}

	settings, err := h.Queries.UpsertSystemSettings(r.Context(), db.UpsertSystemSettingsParams{
		KbEnvironmentUrl:          environmentURL,
		KbIntegrationKeyEncrypted: encryptedKey,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save system settings")
		return
	}

	writeJSON(w, http.StatusOK, systemSettingsResponse(settings))
}

func systemSettingsResponse(settings db.SystemSetting) SystemSettingsResponse {
	return SystemSettingsResponse{
		KBEnvironmentURL:           settings.KbEnvironmentUrl,
		KBIntegrationKeyConfigured: strings.TrimSpace(settings.KbIntegrationKeyEncrypted) != "",
	}
}

func validateKBEnvironmentURL(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	if utf8.RuneCountInString(value) > maxKBEnvironmentURLLength {
		return "", errors.New("kb environment url is too long")
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("kb environment url must be a valid http or https url")
	}
	return strings.TrimRight(value, "/"), nil
}
