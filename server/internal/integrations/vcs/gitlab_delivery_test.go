package vcs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testDeliveryRules() DeliveryRules {
	return DeliveryRules{DeploymentJob: "deploy", PipelineSource: "push", URLPrefix: "MULTICA_DEPLOY_URL=", AllowedHosts: []string{"app.test"}, TimeoutMinutes: 120}
}

func TestExtractDeploymentURL(t *testing.T) {
	cases := []struct{ name, trace, want string }{
		{"marker", "\x1b[32mMULTICA_DEPLOY_URL=https://app.test:8080/feature\x1b[0m", "https://app.test:8080/feature"},
		{"repeated", "MULTICA_DEPLOY_URL=https://app.test/\nMULTICA_DEPLOY_URL=https://app.test/", "https://app.test/"},
		{"echo command", "$ echo MULTICA_DEPLOY_URL=https://app.test/", ""},
		{"query secret", "MULTICA_DEPLOY_URL=https://app.test/?token=secret", ""},
		{"userinfo", "MULTICA_DEPLOY_URL=https://user:secret@app.test/", ""},
		{"fragment", "MULTICA_DEPLOY_URL=https://app.test/#secret", ""},
		{"wrong host", "MULTICA_DEPLOY_URL=https://app.test.evil/", ""},
		{"conflict", "MULTICA_DEPLOY_URL=https://app.test/a\nMULTICA_DEPLOY_URL=https://app.test/b", ""},
		{"missing", "See https://app.test/", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ExtractDeploymentURL(tc.trace, testDeliveryRules())
			if got != tc.want || (err != nil) != (tc.want == "") {
				t.Fatalf("got %q, %v; want %q", got, err, tc.want)
			}
			if err != nil && strings.Contains(err.Error(), "secret") {
				t.Fatal("error must not contain trace data")
			}
		})
	}
}

func TestGitLabDeliveryStates(t *testing.T) {
	sha := strings.Repeat("a", 40)
	cases := []struct {
		name, pipeline, job, want string
		duplicates, wrongSHA      bool
	}{
		{name: "success", pipeline: "success", job: "success", want: "deployed"},
		{name: "manual", pipeline: "manual", job: "manual", want: "manual"},
		{name: "skipped deployment", pipeline: "success", job: "skipped", want: "skipped"},
		{name: "failed", pipeline: "failed", job: "failed", want: "failed"},
		{name: "allowed failure cannot deploy", pipeline: "success", job: "failed", want: "failed"},
		{name: "canceled", pipeline: "canceled", job: "success", want: "canceled"},
		{name: "still running", pipeline: "running", job: "success", want: "running"},
		{name: "ambiguous", pipeline: "success", job: "success", want: "ambiguous", duplicates: true},
		{name: "wrong identity", pipeline: "success", job: "success", want: "blocked", wrongSHA: true},
		{name: "missing deployment", pipeline: "success", want: "blocked"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			traceRead := false
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("PRIVATE-TOKEN") != "test-token" {
					t.Error("missing API credential")
				}
				switch {
				case strings.HasSuffix(r.URL.Path, "/pipelines"):
					if r.URL.Query().Get("sha") != sha || r.URL.Query().Get("ref") != "feature" {
						t.Error("incorrect pipeline filters")
					}
					p := fmt.Sprintf(`{"id":1,"sha":%q,"ref":"feature","source":"push"}`, sha)
					if tc.duplicates {
						fmt.Fprintf(w, "[%s,%s]", p, p)
					} else {
						fmt.Fprintf(w, "[%s]", p)
					}
				case strings.HasSuffix(r.URL.Path, "/pipelines/1"):
					s := sha
					if tc.wrongSHA {
						s = strings.Repeat("b", 40)
					}
					fmt.Fprintf(w, `{"id":1,"sha":%q,"ref":"feature","source":"push","status":%q}`, s, tc.pipeline)
				case strings.HasSuffix(r.URL.Path, "/jobs"):
					if tc.job == "" {
						fmt.Fprint(w, "[]")
					} else {
						fmt.Fprintf(w, `[{"id":2,"name":"deploy","status":%q,"allow_failure":true}]`, tc.job)
					}
				case strings.HasSuffix(r.URL.Path, "/trace"):
					traceRead = true
					fmt.Fprint(w, "MULTICA_DEPLOY_URL=https://app.test/")
				default:
					http.NotFound(w, r)
				}
			}))
			defer s.Close()
			client := GitLabDeliveryClient{InstanceURL: s.URL, Token: "test-token"}
			status, result, err := client.Check(context.Background(), 7, sha, "feature", 0, testDeliveryRules())
			if err != nil || status != tc.want {
				t.Fatalf("status=%s, err=%v; want %s", status, err, tc.want)
			}
			if traceRead != (tc.want == "deployed") {
				t.Fatal("trace must only be read after pipeline and deployment job succeed")
			}
			if tc.want == "deployed" && result.DeploymentURL != "https://app.test/" {
				t.Fatal("missing deployment URL")
			}
		})
	}
}

func TestGitLabDeliveryHTTPBoundaries(t *testing.T) {
	targetRead := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { targetRead = true }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer source.Close()
	client := GitLabDeliveryClient{InstanceURL: source.URL, Token: "private"}
	if _, err := client.Project(context.Background(), 1); err == nil || targetRead {
		t.Fatal("redirect must not be followed")
	}
	large := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, strings.Repeat("x", (4<<20)+1)) }))
	defer large.Close()
	client.InstanceURL = large.URL
	var trace string
	if err := client.get(context.Background(), "/test", &trace); err == nil || trace != "" {
		t.Fatal("oversized response must not be used")
	}
}

func TestDeliveryRulesValidation(t *testing.T) {
	for _, host := range []string{"https://app.test", "*.test", "app.test/path", "app.test:80", "app.test?x=y", "user@app.test"} {
		rules := testDeliveryRules()
		rules.AllowedHosts = []string{host}
		if rules.Validate() == nil {
			t.Errorf("accepted host %q", host)
		}
	}
	rules := testDeliveryRules()
	if err := rules.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestGitLabDeliveryJobPaginationAndPipelineBinding(t *testing.T) {
	sha := strings.Repeat("a", 40)
	pages, lists := 0, 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/pipelines"):
			lists++
			t.Error("bound pipeline must not be replaced with the latest pipeline")
		case strings.HasSuffix(r.URL.Path, "/pipelines/1"):
			fmt.Fprintf(w, `{"id":1,"sha":%q,"ref":"feature","source":"push","status":"success"}`, sha)
		case strings.HasSuffix(r.URL.Path, "/jobs"):
			pages++
			if r.URL.Query().Get("include_retried") != "false" {
				t.Error("historical retried attempts must be excluded")
			}
			if r.URL.Query().Get("page") == "1" {
				batch := make([]deliveryJob, 100)
				for i := range batch {
					batch[i] = deliveryJob{ID: int64(100 + i), Name: "test", Status: "success"}
				}
				_ = json.NewEncoder(w).Encode(batch)
			} else {
				fmt.Fprint(w, `[{"id":2,"name":"deploy","status":"success"}]`)
			}
		case strings.HasSuffix(r.URL.Path, "/trace"):
			fmt.Fprint(w, "MULTICA_DEPLOY_URL=https://app.test/")
		default:
			http.NotFound(w, r)
		}
	}))
	defer s.Close()
	status, result, err := (GitLabDeliveryClient{InstanceURL: s.URL}).Check(context.Background(), 7, sha, "feature", 1, testDeliveryRules())
	if err != nil || status != "deployed" || result.JobID != 2 || pages != 2 || lists != 0 {
		t.Fatalf("pagination/binding: %s %+v %v pages=%d lists=%d", status, result, err, pages, lists)
	}
}

func TestGitLabDeliveryNoPipelineAndAuthorization(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		body string
		want string
	}{
		{"no CI", 200, "[]", "pending_pipeline"},
		{"other source", 200, `[{"id":1,"sha":"aaa","ref":"feature","source":"web"}]`, "pending_pipeline"},
		{"unauthorized", 401, "do not disclose this body", ""},
		{"forbidden", 403, "do not disclose this body", ""},
		{"rate limited", 429, "do not disclose this body", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("source") != "push" {
					t.Error("missing exact pipeline source filter")
				}
				w.WriteHeader(tc.code)
				fmt.Fprint(w, tc.body)
			}))
			defer s.Close()
			status, _, err := (GitLabDeliveryClient{InstanceURL: s.URL}).Check(context.Background(), 7, "aaa", "feature", 0, testDeliveryRules())
			if status != tc.want || (err != nil) != (tc.code != 200) {
				t.Fatalf("status=%s err=%v", status, err)
			}
			if err != nil && strings.Contains(err.Error(), "disclose") {
				t.Fatal("provider response body leaked")
			}
		})
	}
}
