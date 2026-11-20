package vcs

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGitLabDeliveryChildPipelines(t *testing.T) {
	sha := strings.Repeat("a", 40)
	for _, tc := range []struct {
		name, childStatus, source, childSHA, jobs, nested, want string
		projectID                                               int
	}{
		{name: "allowed trigger failure is real child failure", childStatus: "failed", jobs: `[{"id":9,"name":"build","status":"failed","web_url":"%s/jobs/9"}]`, want: "failed"},
		{name: "child deployment", childStatus: "success", jobs: `[{"id":9,"name":"deploy","stage":"deploy","status":"success","web_url":"%s/jobs/9"}]`, want: "deployed"},
		{name: "running child is not CI passed", childStatus: "running", want: "running"},
		{name: "manual child", childStatus: "manual", want: "manual"},
		{name: "canceled child", childStatus: "canceled", want: "canceled"},
		{name: "skipped child", childStatus: "skipped", want: "skipped"},
		{name: "CI only child", childStatus: "success", want: "ci_passed"},
		{name: "wrong commit", childStatus: "success", childSHA: strings.Repeat("b", 40), want: "blocked"},
		{name: "wrong source", childStatus: "success", source: "push", want: "blocked"},
		{name: "cross project", childStatus: "success", projectID: 8, want: "blocked"},
		{name: "cycle", childStatus: "success", nested: `[{"id":12,"status":"success","downstream_pipeline":{"id":1,"project_id":7}}]`, want: "blocked"},
		{name: "duplicate deployment across tree", childStatus: "success", jobs: `[{"id":9,"name":"deploy","stage":"deploy","status":"success"},{"id":10,"name":"deploy","stage":"deploy","status":"success"}]`, want: "ambiguous"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.source == "" {
				tc.source = "parent_pipeline"
			}
			if tc.childSHA == "" {
				tc.childSHA = sha
			}
			if tc.projectID == 0 {
				tc.projectID = 7
			}
			if tc.jobs == "" {
				tc.jobs = "[]"
			}
			if tc.nested == "" {
				tc.nested = "[]"
			}
			traceRead := false
			childRead := false
			var instance string
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet {
					t.Errorf("tracking issued a write: %s", r.Method)
				}
				switch r.URL.Path {
				case "/api/v4/projects/7/pipelines/1":
					fmt.Fprintf(w, `{"id":1,"project_id":7,"sha":%q,"ref":"feature","source":"push","status":"success","web_url":%q}`, sha, instance+"/pipelines/1")
				case "/api/v4/projects/7/pipelines/1/jobs":
					fmt.Fprint(w, "[]")
				case "/api/v4/projects/7/pipelines/1/bridges":
					status := "success"
					if tc.childStatus == "failed" {
						status = "failed"
					}
					fmt.Fprintf(w, `[{"id":8,"name":"trigger-aiagent","status":%q,"allow_failure":true,"web_url":%q,"downstream_pipeline":{"id":2,"project_id":%d}}]`, status, instance+"/jobs/8", tc.projectID)
				case "/api/v4/projects/7/pipelines/2":
					childRead = true
					fmt.Fprintf(w, `{"id":2,"project_id":7,"sha":%q,"ref":"feature","source":%q,"status":%q,"web_url":%q}`, tc.childSHA, tc.source, tc.childStatus, instance+"/pipelines/2")
				case "/api/v4/projects/7/pipelines/2/jobs":
					fmt.Fprint(w, strings.ReplaceAll(tc.jobs, "%s", instance))
				case "/api/v4/projects/7/pipelines/2/bridges":
					fmt.Fprint(w, tc.nested)
				case "/api/v4/projects/7/jobs/9/trace":
					traceRead = true
					fmt.Fprint(w, "MULTICA_DEPLOY_URL=https://app.test/feature")
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer s.Close()
			instance = s.URL
			rules := testDeliveryRules()
			rules.AutoDiscover, rules.DeploymentJob = true, ""
			status, result, err := (GitLabDeliveryClient{InstanceURL: s.URL}).Check(context.Background(), 7, sha, "feature", 1, rules)
			if err != nil || status != tc.want || result.PipelineID != 1 || result.PipelineURL != instance+"/pipelines/1" {
				t.Fatalf("got %s %+v %v; want %s", status, result, err, tc.want)
			}
			if traceRead != (tc.want == "deployed") {
				t.Fatalf("unexpected trace read: %v", traceRead)
			}
			if tc.projectID != 7 && childRead {
				t.Fatal("followed a cross-project pipeline")
			}
			if tc.want != "blocked" && (len(result.DownstreamPipelines) != 1 || result.DownstreamPipelines[0].URL != instance+"/pipelines/2") {
				t.Fatalf("missing child evidence: %+v", result)
			}
			if tc.want == "failed" && result.JobID != 9 {
				t.Fatalf("must link actual failed build, not trigger: %+v", result)
			}
			if tc.want != "deployed" && result.DeploymentURL != "" {
				t.Fatal("claimed an unverified environment")
			}
		})
	}
}

func TestGitLabDeliveryBridgeReadFailure(t *testing.T) {
	sha := strings.Repeat("a", 40)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/pipelines/1"):
			fmt.Fprintf(w, `{"id":1,"sha":%q,"ref":"feature","source":"push","status":"success"}`, sha)
		case strings.HasSuffix(r.URL.Path, "/jobs"):
			fmt.Fprint(w, "[]")
		default:
			w.WriteHeader(http.StatusForbidden)
		}
	}))
	defer s.Close()
	status, _, err := (GitLabDeliveryClient{InstanceURL: s.URL}).Check(context.Background(), 7, sha, "feature", 1, testDeliveryRules())
	if err != ErrUnauthorized || status != "" {
		t.Fatalf("must not claim CI passed when bridges are unreadable: %s %v", status, err)
	}
}
