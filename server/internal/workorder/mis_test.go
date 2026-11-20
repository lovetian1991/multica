package workorder

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMISListUsesDocumentedReadContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/mis/QcWorkOrder/List" {
			t.Errorf("unexpected endpoint: %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		for key, want := range map[string]string{
			"index": "2", "size": "100", "token": "test-token",
			"filterStr": "status!='草稿'", "creationtime": "$", "eformControlId": "Table",
		} {
			if r.Form.Get(key) != want {
				t.Errorf("form %s = %q, want %q", key, r.Form.Get(key), want)
			}
		}
		if r.Header.Get("appid") != "test-app" {
			t.Error("missing authentication header")
		}
		fmt.Fprint(w, `{"success":true,"total":"101","data":[{"id":101,"title":"Repair","description":"Original","productname":"ECM","productversionnum":"6","branch":"legacy"}]}`)
	}))
	defer server.Close()
	rows, total, err := FetchMISPage(context.Background(), server.URL+"/mis", MISCredentials{
		Headers: map[string]string{"appid": "test-app"}, Token: "test-token",
	}, 2)
	if err != nil || total != 101 || len(rows) != 1 {
		t.Fatalf("list = %+v, total %d, error %v", rows, total, err)
	}
	if rows[0].ID != "101" || rows[0].Product != "ECM" || rows[0].Version != "6" || rows[0].Branch != "legacy" {
		t.Fatalf("field mapping = %+v", rows[0])
	}
}

func TestMISSearchAndPaginationUseSameUpstreamRequest(t *testing.T) {
	for _, mine := range []bool{false, true} {
		t.Run(fmt.Sprint(mine), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseForm(); err != nil {
					t.Fatal(err)
				}
				wantFilter := "(title like '%OC''85%' or no like '%OC''85%')"
				wantPath := "/QcWorkOrder/ListWorkOrderTask"
				if !mine {
					wantFilter = "status!='草稿' and " + wantFilter
					wantPath = "/QcWorkOrder/List"
				}
				if r.URL.Path != wantPath || r.Form.Get("index") != "2" || r.Form.Get("size") != "20" ||
					r.Form.Get("filterStr") != wantFilter {
					t.Errorf("search or pagination not forwarded correctly")
				}
				if mine && (r.Form.Get("taskUser") != "user-a" || r.Form.Get("taskStatus") != "0") {
					t.Error("personal search lost its scope")
				}
				fmt.Fprint(w, `{"success":true,"total":21,"data":[]}`)
			}))
			defer server.Close()
			_, total, err := QueryMIS(context.Background(), server.URL,
				MISCredentials{Token: "test-token", TaskUser: "user-a"},
				MISQuery{Mine: mine, Page: 2, Size: 20, Search: "OC'85"})
			if err != nil || total != 21 {
				t.Fatalf("query total=%d error=%v", total, err)
			}
		})
	}
}

func TestMISRejectsMalformedResponsesWithoutLeakingSecrets(t *testing.T) {
	for _, body := range []string{
		`{"success":false,"error":"private-upstream-secret"}`,
		`{"success":true,"data":{},"total":1}`,
		`{"success":true,"data":[],"total":-1}`,
		`{"success":true,"data":[{"id":"1"}],"total":1}`,
		`not-json-private-upstream-secret`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			_, _, err := FetchMISPage(context.Background(), server.URL, MISCredentials{Token: "private-token"}, 1)
			if err == nil || strings.Contains(err.Error(), "private-") {
				t.Fatalf("expected a sanitized error, got %v", err)
			}
		})
	}
}

func TestMISListAcceptsLargeRichTextWithinResponseLimit(t *testing.T) {
	description := "<img src=\"data:image/png;base64," + strings.Repeat("a", 2000000) + "\">"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "total": 1,
			"data": []map[string]string{{"id": "large-order", "title": "Repair", "description": description}},
		})
	}))
	defer server.Close()
	rows, total, err := QueryMIS(context.Background(), server.URL, MISCredentials{Token: "test-token"},
		MISQuery{Page: 1, Size: 20})
	if err != nil || total != 1 || len(rows) != 1 {
		t.Fatalf("large rich text list: total=%d count=%d error=%v", total, len(rows), err)
	}
	if rows[0].Description != description {
		t.Fatal("rich text was truncated")
	}
}

func TestMISRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprint(w, strings.Repeat("a", 8*1024*1024+1))
	}))
	defer server.Close()
	_, _, err := QueryMIS(context.Background(), server.URL, MISCredentials{Token: "test-token"},
		MISQuery{Page: 1, Size: 20})
	if err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("expected response size limit, got %v", err)
	}
}

func TestMISSummaryExcludesRichTextWithoutChangingDetail(t *testing.T) {
	order := MISOrder{
		ID: "1", Title: "Repair", Description: strings.Repeat("x", 2000000),
		Fields: map[string]string{"customername": "Acme", "solution": strings.Repeat("y", 2000000)},
	}
	summary := order.Summary()
	raw, err := json.Marshal(summary)
	if err != nil || len(raw) > 1000 || summary.Fields["customername"] != "Acme" {
		t.Fatalf("invalid list summary: size=%d error=%v", len(raw), err)
	}
	if len(order.Description) != 2000000 || len(order.Fields["solution"]) != 2000000 {
		t.Fatal("list projection changed the full detail")
	}
}

func TestMISDoesNotFollowAuthenticatedRedirects(t *testing.T) {
	called := false
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	_, _, err := FetchMISPage(context.Background(), source.URL, MISCredentials{
		Headers: map[string]string{"appid": "private"}, Token: "private",
	}, 1)
	if err == nil || called {
		t.Fatalf("authenticated redirect followed: %v, error %v", called, err)
	}
}

func TestMISCredentialsValidateHeaderAllowlist(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `{"headers":{},"token":""}`,
		`{"headers":{"Authorization":"private"},"token":"x"}`,
		`{"headers":{"appid":"a\r\nb"},"token":"x"}`} {
		if _, err := ParseMISCredentials([]byte(raw)); err == nil {
			t.Errorf("accepted invalid credentials: %s", raw)
		}
	}
	if _, err := ParseMISCredentials([]byte(`{"headers":{"appid":"test","ECM":"test"},"token":"x"}`)); err != nil {
		t.Fatal(err)
	}
}
