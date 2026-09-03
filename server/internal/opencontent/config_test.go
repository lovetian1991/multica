package opencontent

import (
	"strings"
	"testing"
)

func TestConfigValidateDoesNotRequireUpstreamCredential(t *testing.T) {
	cfg := Config{
		Enabled:           true,
		BaseURL:           "https://oc.example.test",
		Timeout:           defaultTimeout,
		MaxUploadBytes:    defaultMaxUploadBytes,
		MaxResponseBytes:  defaultMaxResponseBytes,
		AllowedExtensions: []string{".txt"},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestSplitExtensionsNormalizesValues(t *testing.T) {
	got := splitExtensions("txt, .PDF,,md")
	want := []string{".txt", ".pdf", ".md"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("splitExtensions() = %v, want %v", got, want)
	}
}
