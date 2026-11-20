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

func TestRepositoryProject(t *testing.T) {
	for _, tc := range []struct {
		remote, instance, want string
	}{
		{"git@git.test:team/app.git", "https://git.test", "team/app"},
		{"ssh://git@git.test:2222/team/sub/app.git", "http://git.test:8080", "team/sub/app"},
		{"https://git.test/team/app.git", "https://git.test", "team/app"},
		{"https://git.test/gitlab/team/app.git", "https://git.test/gitlab", "team/app"},
		{"git@git.test:team/app.git", "https://git.test/gitlab", "team/app"},
		{"https://git.test:8080/team/app", "http://git.test:8080", "team/app"},
		{"git@other.test:team/app.git", "https://git.test", ""},
		{"https://git.test:8080/team/app", "https://git.test", ""},
		{"https://git.test/team/app", "https://git.test/gitlab", ""},
		{"https://git.test/gitlab-other/team/app", "https://git.test/gitlab", ""},
		{"https://secret@git.test/team/app", "https://git.test", ""},
		{"ssh://git:secret@git.test/team/app", "https://git.test", ""},
		{"https://git.test/team/app?token=secret", "https://git.test", ""},
		{"https://git.test/team/app#fragment", "https://git.test", ""},
		{"https://git.test/team/%2e%2e/app", "https://git.test", ""},
		{"git@git.test:team//app.git", "https://git.test", ""},
		{"git@git.test:team/../app.git", "https://git.test", ""},
		{"git@git.test:app.git", "https://git.test", ""},
		{"G:\\repo\\app", "https://git.test", ""},
		{"file:///team/app", "https://git.test", ""},
		{"https://git.test/team/my app", "https://git.test", ""},
	} {
		t.Run(tc.remote+"@"+tc.instance, func(t *testing.T) {
			got, ok := RepositoryProject(tc.remote, tc.instance)
			if got != tc.want || ok != (tc.want != "") {
				t.Fatalf("got %q, %v; want %q", got, ok, tc.want)
			}
		})
	}
}

func TestResolveDeliveryProject(t *testing.T) {
	for _, identity := range []string{
		`{"id":7,"path_with_namespace":"team/sub/app"}`,
		`{"id":7,"path_with_namespace":"other/app"}`,
		`{"id":0,"path_with_namespace":"team/sub/app"}`,
		`{}`,
	} {
		t.Run(identity, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.EscapedPath() != "/api/v4/projects/team%2Fsub%2Fapp" ||
					r.Header.Get("PRIVATE-TOKEN") != "test-token" {
					t.Errorf("incorrect project resolution request: %s %s", r.Method, r.URL.EscapedPath())
				}
				fmt.Fprint(w, identity)
			}))
			defer s.Close()
			id, path, err := (GitLabDeliveryClient{InstanceURL: s.URL, Token: "test-token"}).ResolveProject(context.Background(), "team/sub/app")
			if identity == `{"id":7,"path_with_namespace":"team/sub/app"}` {
				if err != nil || id != 7 || path != "team/sub/app" {
					t.Fatalf("got %d %q %v", id, path, err)
				}
			} else if err == nil {
				t.Fatal("accepted a different or missing project identity")
			}
		})
	}
}

func TestGitLabDeliveryAutoDiscovery(t *testing.T) {
	sha := strings.Repeat("a", 40)
	for _, tc := range []struct {
		name, pipeline, jobs, want string
		hosts, trace               bool
	}{
		{"dynamic deployment without hosts", "success", `[{"id":2,"name":"product-selective","stage":"product-deploy","status":"success"}]`, "deployed", false, true},
		{"no deploy stage without hosts", "success", `[{"id":2,"name":"test","stage":"test","status":"success"}]`, "ci_passed", false, false},
		{"no deploy stage", "success", `[{"id":2,"name":"test","stage":"test","status":"success"}]`, "ci_passed", true, false},
		{"deploy stage", "success", `[{"id":2,"name":"product-selective","stage":"product-deploy","status":"success"}]`, "deployed", true, true},
		{"ambiguous stage", "success", `[{"id":2,"stage":"deploy","status":"success"},{"id":3,"stage":"deployment","status":"success"}]`, "ambiguous", true, false},
		{"ambiguous stage without hosts", "success", `[{"id":2,"stage":"deploy","status":"success"},{"id":3,"stage":"deployment","status":"success"}]`, "ambiguous", false, false},
		{"failed", "failed", `[{"id":2,"stage":"deploy","status":"failed"}]`, "failed", true, false},
		{"canceled", "canceled", "[]", "canceled", false, false},
		{"skipped", "skipped", "[]", "skipped", false, false},
		{"manual", "manual", `[{"id":2,"stage":"deploy","status":"manual"}]`, "manual", false, false},
		{"running", "running", `[{"id":2,"stage":"deploy","status":"success"}]`, "running", false, false},
		{"allowed failure is not deployment", "success", `[{"id":2,"stage":"deploy","status":"failed","allow_failure":true}]`, "failed", true, false},
		{"allowed failure without hosts", "success", `[{"id":2,"stage":"deploy","status":"failed","allow_failure":true}]`, "failed", false, false},
		{"skipped deployment without hosts", "success", `[{"id":2,"stage":"deploy","status":"skipped"}]`, "skipped", false, false},
		{"not a deploy stage", "success", `[{"id":2,"stage":"predeployment-check","status":"success"}]`, "ci_passed", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rules := DeliveryRules{AutoDiscover: true, URLPrefix: "[DEPLOY] "}
			if tc.hosts {
				rules.AllowedHosts = []string{"app.test"}
			}
			if err := rules.Validate(); err != nil {
				t.Fatal(err)
			}
			traceRead := false
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet {
					t.Fatal("automatic registration must not trigger GitLab writes")
				}
				switch {
				case strings.HasSuffix(r.URL.Path, "/bridges"):
					fmt.Fprint(w, "[]")
				case strings.HasSuffix(r.URL.Path, "/pipelines/1"):
					fmt.Fprintf(w, `{"id":1,"sha":%q,"ref":"feature","source":"push","status":%q}`, sha, tc.pipeline)
				case strings.HasSuffix(r.URL.Path, "/jobs"):
					fmt.Fprint(w, tc.jobs)
				case strings.HasSuffix(r.URL.Path, "/trace"):
					traceRead = true
					fmt.Fprint(w, "[DEPLOY] https://app.test:37521/")
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer s.Close()
			status, result, err := (GitLabDeliveryClient{InstanceURL: s.URL}).Check(context.Background(), 7, sha, "feature", 1, rules)
			if err != nil || status != tc.want || traceRead != tc.trace {
				t.Fatalf("got %s %+v %v trace=%v; want %s trace=%v", status, result, err, traceRead, tc.want, tc.trace)
			}
			if status == "ci_passed" && (!DeliveryTerminal(status) || result.DeploymentURL != "") {
				t.Fatal("CI-only success must terminate without claiming deployment")
			}
			if status == "deployed" && result.DeploymentURL != "https://app.test:37521/" {
				t.Fatalf("deployment address missing: %+v", result)
			}
		})
	}
}

func TestDeliveryAutoRulesValidation(t *testing.T) {
	rules := DeliveryRules{AutoDiscover: true}
	if err := rules.Validate(); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(rules)
	if !strings.Contains(string(raw), `"allowed_hosts":[]`) {
		t.Fatal("empty hosts must remain an array for API clients")
	}
	if rules.PipelineSource != "push" || rules.TimeoutMinutes != 120 || rules.URLPrefix != "MULTICA_DEPLOY_URL=" {
		t.Fatalf("missing normalized defaults: %+v", rules)
	}
	rules.AutoDiscover = false
	if rules.Validate() == nil {
		t.Fatal("explicit project rules still require a deployment job")
	}
	rules.DeploymentJob = "product-selective"
	if err := rules.Validate(); err != nil {
		t.Fatalf("explicit deployment job must support dynamic hosts: %v", err)
	}
	rules.AutoDiscover = true
	rules.AllowedHosts = []string{"*.test"}
	if rules.Validate() == nil {
		t.Fatal("automatic mode must preserve hostname validation")
	}
}
