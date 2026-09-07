package opencontent

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultTimeout          = 35 * time.Second
	defaultMaxUploadBytes   = 20 << 20
	defaultMaxResponseBytes = 64 << 20
)

var defaultUploadExtensions = []string{".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"}

type Config struct {
	Enabled           bool
	BaseURL           string
	Timeout           time.Duration
	MaxUploadBytes    int64
	MaxResponseBytes  int64
	AllowedExtensions []string
}

func ConfigFromEnv() Config {
	cfg := Config{
		Enabled:           envBool("MULTICA_OPENCONTENT_ENABLED", false),
		BaseURL:           strings.TrimRight(strings.TrimSpace(os.Getenv("MULTICA_OPENCONTENT_URL")), "/"),
		Timeout:           envDuration("MULTICA_OPENCONTENT_TIMEOUT", defaultTimeout),
		MaxUploadBytes:    envBytes("MULTICA_OPENCONTENT_MAX_UPLOAD_BYTES", defaultMaxUploadBytes),
		MaxResponseBytes:  envBytes("MULTICA_OPENCONTENT_MAX_RESPONSE_BYTES", defaultMaxResponseBytes),
		AllowedExtensions: splitExtensions(os.Getenv("MULTICA_OPENCONTENT_UPLOAD_EXTENSIONS")),
	}
	if len(cfg.AllowedExtensions) == 0 {
		cfg.AllowedExtensions = append([]string(nil), defaultUploadExtensions...)
	}
	return cfg
}

func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}
	if c.BaseURL == "" {
		return fmt.Errorf("MULTICA_OPENCONTENT_URL is required when OpenContent is enabled")
	}
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("MULTICA_OPENCONTENT_URL must be an absolute http(s) URL")
	}
	if c.Timeout <= 0 || c.MaxUploadBytes <= 0 || c.MaxResponseBytes <= 0 {
		return fmt.Errorf("OpenContent timeout and size limits must be positive")
	}
	if len(c.AllowedExtensions) == 0 {
		return fmt.Errorf("OpenContent upload extension allowlist must not be empty")
	}
	return nil
}

func envBool(name string, fallback bool) bool {
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return fallback
	}
	return value
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envBytes(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func splitExtensions(raw string) []string {
	var result []string
	for _, value := range strings.Split(raw, ",") {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if !strings.HasPrefix(value, ".") {
			value = "." + value
		}
		result = append(result, value)
	}
	return result
}
