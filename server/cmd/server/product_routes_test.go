package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/realtime"
)

func TestProductRoutesAreGlobalAndCanonical(t *testing.T) {
	router := NewRouter(nil, realtime.NewHub(), events.New(), analytics.NoopClient{}, nil)

	// Both catalogs are chi route groups, so either spelling of the index
	// reaches auth instead of one of them falling through to a 404.
	for _, path := range []string{
		"/api/products",
		"/api/products/",
		// Picker-facing folder reads hang off the version path, so a typo there
		// would 404 instead of reaching auth.
		"/api/products/p/versions/v/folders",
		"/api/system/products",
		"/api/system/products/",
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			// A matched route reaches auth first. A missing workspace must not
			// turn a global product route into a workspace-required response.
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("GET %s status = %d, want %d", path, rec.Code, http.StatusUnauthorized)
			}
		})
	}
}
