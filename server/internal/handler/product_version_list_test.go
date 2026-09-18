package handler

import (
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestListProductVersionsOmitsDisabledRows(t *testing.T) {
	previous := testHandler.cfg.SystemAdminEmails
	testHandler.cfg.SystemAdminEmails = []string{handlerTestEmail}
	t.Cleanup(func() {
		testHandler.cfg.SystemAdminEmails = previous
	})

	productID := dbfx.Insert(t, "product", testutil.Cols{
		"name": "Catalog product",
	})
	enabledID := dbfx.Insert(t, "product_version", testutil.Cols{
		"product_id": productID,
		"name":       "enabled-version",
		"directory":  "docs",
		"remark":     "",
		"folder_id":  "1",
		"enabled":    true,
	})
	disabledID := dbfx.Insert(t, "product_version", testutil.Cols{
		"product_id": productID,
		"name":       "disabled-version",
		"directory":  "docs",
		"remark":     "",
		"folder_id":  "2",
		"enabled":    false,
	})

	type listResponse struct {
		Versions []ProductVersionResponse `json:"versions"`
		Total    int                      `json:"total"`
	}

	public := testutil.Decode[listResponse](
		t,
		testHandler.ListProductVersions,
		withURLParam(newRequest(http.MethodGet, "/api/products/"+productID+"/versions", nil), "id", productID),
		http.StatusOK,
	)
	if public.Total != 1 || len(public.Versions) != 1 {
		t.Fatalf("public list = %+v, want one enabled version", public)
	}
	if public.Versions[0].ID != enabledID {
		t.Fatalf("public list returned %s, want %s", public.Versions[0].ID, enabledID)
	}
	if !public.Versions[0].Enabled {
		t.Fatal("public list returned a disabled version")
	}

	admin := testutil.Decode[listResponse](
		t,
		testHandler.ListSystemProductVersions,
		withURLParam(newRequest(http.MethodGet, "/api/system/products/"+productID+"/versions", nil), "id", productID),
		http.StatusOK,
	)
	if admin.Total != 2 || len(admin.Versions) != 2 {
		t.Fatalf("admin list = %+v, want both versions", admin)
	}
	ids := map[string]bool{}
	for _, version := range admin.Versions {
		ids[version.ID] = true
	}
	if !ids[enabledID] || !ids[disabledID] {
		t.Fatalf("admin list ids = %v, want %s and %s", ids, enabledID, disabledID)
	}
}
