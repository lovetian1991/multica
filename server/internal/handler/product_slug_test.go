package handler

import (
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestProductSlugValidationAndCompatibility(t *testing.T) {
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	t.Cleanup(func() { testHandler.cfg.SystemAdminEmails = previous })
	product := dbfx.Insert(t, "product", testutil.Cols{"name": t.Name(), "slug": "test-product-slug"})
	for _, slug := range []string{"", "ECM", "../ecm", "con", "bad/name"} {
		testutil.Call(t, testHandler.CreateSystemProduct, newRequest(http.MethodPost, "/api/system/products",
			map[string]any{"name": t.Name(), "slug": slug})).Want(http.StatusBadRequest)
	}
	testutil.Call(t, testHandler.CreateSystemProduct, newRequest(http.MethodPost, "/api/system/products",
		map[string]any{"name": t.Name(), "slug": "test-product-slug"})).Want(http.StatusConflict)
	var updated ProductResponse
	testutil.Call(t, testHandler.UpdateSystemProduct, withURLParam(newRequest(http.MethodPut, "/api/system/products/"+product,
		map[string]any{"name": "Renamed by older client"}), "id", product)).Want(http.StatusOK).JSON(&updated)
	if updated.Slug != "test-product-slug" {
		t.Fatalf("older client cleared the identifier: %+v", updated)
	}
	other := dbfx.Insert(t, "product", testutil.Cols{"name": "Other slug", "slug": "test-product-slug-other"})
	testutil.Call(t, testHandler.UpdateSystemProduct, withURLParam(newRequest(http.MethodPut, "/api/system/products/"+other,
		map[string]any{"name": "Other", "slug": "test-product-slug"}), "id", other)).Want(http.StatusConflict)
}
