package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/realtime"
)

func TestProcessTemplateRoutesAreGlobalAndCanonical(t *testing.T) {
	router := NewRouter(nil, realtime.NewHub(), events.New(), analytics.NoopClient{}, nil)

	for _, path := range []string{
		"/api/system/process-templates",
		"/api/system/process-templates/",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("GET %s status = %d, want %d", path, rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestProcessTemplatePushRouteIsRegistered(t *testing.T) {
	router := NewRouter(nil, realtime.NewHub(), events.New(), analytics.NoopClient{}, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/system/process-templates/push", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST /api/system/process-templates/push status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
