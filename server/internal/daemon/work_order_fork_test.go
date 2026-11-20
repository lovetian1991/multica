package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	"github.com/multica-ai/multica/server/internal/workorder"
)

func TestPrepareForkProjectWritesOnlyPersonalRemote(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	upstream, personal, checkout := filepath.Join(root, "upstream.git"), filepath.Join(root, "personal.git"), filepath.Join(root, "checkout")
	run := func(args ...string) string {
		t.Helper()
		out, err := exec.Command("git", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	run("init", "--bare", upstream)
	run("clone", upstream, checkout)
	run("-C", checkout, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "baseline")
	run("-C", checkout, "branch", "-M", "prod-8.5.0.0")
	run("-C", checkout, "push", "origin", "prod-8.5.0.0")
	run("clone", "--bare", upstream, personal)
	run("-C", checkout, "checkout", "-b", "agent/dev/task")
	baseline := run("-C", checkout, "rev-parse", "HEAD")
	receipt := workOrderForkReceipt{ProjectBranch: "proj-test-v8.5.0.0", TargetBranch: "prod-8.5.0.0"}
	receipt.Identity.Fork.HTTPURL = personal
	if err := configureForkRemotes(ctx, checkout, upstream, receipt); err != nil {
		t.Fatal(err)
	}
	if err := prepareForkProject(ctx, checkout, baseline, receipt); err != nil {
		t.Fatal(err)
	}
	if got := run("--git-dir="+personal, "rev-parse", "refs/heads/"+receipt.ProjectBranch); got != baseline {
		t.Fatal("personal project branch is not based on configured version")
	}
	if out, _ := exec.Command("git", "--git-dir="+upstream, "show-ref", "--verify", "refs/heads/"+receipt.ProjectBranch).Output(); len(out) != 0 {
		t.Fatal("project branch was created upstream")
	}
	if got := run("-C", checkout, "remote", "get-url", "--push", "upstream"); got != "disabled://upstream-read-only" {
		t.Fatal("upstream push not disabled")
	}
	receipt.TargetBranch = "missing-version"
	if err := prepareForkProject(ctx, checkout, baseline, receipt); err == nil {
		t.Fatal("missing product version silently accepted")
	}
	receipt.TargetBranch = "prod-8.5.0.0"
	run("-C", checkout, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "feature")
	if err := prepareForkProject(ctx, checkout, baseline, receipt); err == nil {
		t.Fatal("unfinished feature work could be pushed into project branch during reinitialization")
	}
}

func TestPublishWorkOrderForksPushesAndRetainsReview(t *testing.T) {
	ctx := context.Background()
	upstream := createGCGitRepo(t)
	runGitForGC(t, upstream, "branch", "prod-8.5.0.0")
	personal := filepath.Join(t.TempDir(), "fork.git")
	runGitForGC(t, "", "clone", "--bare", upstream, personal)
	workDir := t.TempDir()
	checkout := filepath.Join(workDir, "code", "app")
	runGitForGC(t, "", "clone", personal, checkout)
	runGitForGC(t, checkout, "checkout", "-b", "agent/dev/task")
	baseline := runGitForGC(t, checkout, "rev-parse", "HEAD")
	runGitForGC(t, checkout, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "feature")
	sha := runGitForGC(t, checkout, "rev-parse", "HEAD")
	posts, forkID := 0, int64(120)
	denied := false
	var host string
	var mr vcs.GitLabForkMergeRequest
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/daemon/workspaces/ws/gitlab/credential" {
			if r.Header.Get("Authorization") != "Bearer daemon-token" {
				t.Error("credential resolution did not use daemon identity")
			}
			fmt.Fprintf(w, `{"instance_url":%q,"access_token":"workspace-token"}`, host)
			return
		}
		if r.Header.Get("PRIVATE-TOKEN") != "workspace-token" {
			t.Error("provider request did not use workspace identity")
		}
		switch r.URL.Path {
		case "/api/v4/user":
			fmt.Fprint(w, `{"id":4,"username":"alice"}`)
		case "/api/v4/projects/team/app":
			fmt.Fprintf(w, `{"id":9,"path":"app","path_with_namespace":"team/app","http_url_to_repo":%q,"namespace":{"full_path":"team","kind":"group"}}`, host+"/team/app.git")
		case "/api/v4/projects/alice/app":
			fmt.Fprintf(w, `{"id":%d,"path":"app","path_with_namespace":"alice/app","http_url_to_repo":%q,"namespace":{"full_path":"alice","kind":"user"},"forked_from_project":{"id":9}}`, forkID, host+"/alice/app.git")
		case "/api/v4/projects/120/merge_requests":
			if denied {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if r.Method == http.MethodGet {
				if posts > 0 {
					_ = json.NewEncoder(w).Encode([]vcs.GitLabForkMergeRequest{mr})
				} else {
					fmt.Fprint(w, "[]")
				}
				return
			}
			posts++
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["source_branch"] != "agent/dev/task" || body["target_branch"] != "prod-8.5.0.0" ||
				body["target_project_id"] != float64(9) || body["remove_source_branch"] != true {
				t.Errorf("incorrect cross-project review: %v", body)
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(mr)
		default:
			t.Errorf("unexpected operation %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	host = provider.URL
	repo := workorder.Checkout{RepoURL: host + "/team/app.git", Ref: "proj-app-v8.5.0.0",
		BaseRef: "prod-8.5.0.0", Directory: "code/app", ModuleKey: "main"}
	task := Task{ID: "task", WorkspaceID: "ws", IssueIdentifier: "TEST-1",
		WorkOrderPlan: &workorder.Plan{PersonalFork: true, Repos: []workorder.Checkout{repo}}}
	identity := vcs.GitLabPersonalFork{Upstream: vcs.GitLabForkProject{ID: 9}, Fork: vcs.GitLabForkProject{ID: 120, HTTPURL: host + "/alice/app.git"}}
	receipt := &workOrderForkReceipt{InstanceURL: host, Identity: identity, ProjectBranch: repo.Ref, TargetBranch: repo.BaseRef}
	manifest := workOrderManifest{Plan: task.WorkOrderPlan, Checkouts: []workOrderCheckoutManifest{{
		Directory: repo.Directory, Ref: repo.Ref, SHA: baseline, Branch: "agent/dev/task", Fork: receipt,
	}}}
	if err := writeWorkOrderManifest(workDir, manifest); err != nil {
		t.Fatal(err)
	}
	// Keep real Git pushes inside the fixture while the provider API uses HTTP.
	runGitForGC(t, checkout, "config", "url."+filepath.ToSlash(personal)+".insteadOf", host+"/alice/app.git")
	mr = vcs.GitLabForkMergeRequest{IID: 3, SourceProjectID: 120, TargetProjectID: 9,
		SourceBranch: "agent/dev/task", TargetBranch: repo.BaseRef, SHA: sha, State: "opened",
		WebURL: host + "/team/app/-/merge_requests/3"}
	d := &Daemon{client: NewClient(host)}
	d.client.SetToken("daemon-token")
	for range 2 {
		reviews, err := d.publishWorkOrderForks(ctx, task, workDir)
		if err != nil || !strings.Contains(reviews, mr.WebURL) {
			t.Fatalf("reviews=%q err=%v", reviews, err)
		}
	}
	if posts != 1 {
		t.Fatal("retry duplicated the upstream review")
	}
	if got := runGitForGC(t, personal, "rev-parse", "refs/heads/agent/dev/task"); got != sha {
		t.Fatal("feature commit was not pushed to the personal fork")
	}
	if got := runGitForGC(t, upstream, "rev-parse", "prod-8.5.0.0"); got != baseline {
		t.Fatal("upstream branch was mutated without review")
	}
	saved, err := readWorkOrderManifest(workDir)
	if err != nil || saved.Checkouts[0].Fork.ReviewURL != mr.WebURL || saved.Checkouts[0].Fork.SubmittedSHA != sha {
		t.Fatalf("review receipt was not saved: %v", err)
	}
	denied = true
	if _, err := d.publishWorkOrderForks(ctx, task, workDir); err == nil {
		t.Fatal("review permission failure was hidden")
	}
	if got := runGitForGC(t, checkout, "rev-parse", "HEAD"); got != sha {
		t.Fatal("permission failure discarded local work")
	}
	denied, forkID = false, 121
	if _, err := d.publishWorkOrderForks(ctx, task, workDir); err == nil || !strings.Contains(err.Error(), "identity changed") {
		t.Fatalf("changed workspace account was not rejected: %v", err)
	}
	forkID = 120
	if err := os.WriteFile(filepath.Join(checkout, "pending.txt"), []byte("retain\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := d.publishWorkOrderForks(ctx, task, workDir); err == nil || !strings.Contains(err.Error(), "uncommitted") {
		t.Fatalf("uncommitted work was silently submitted: %v", err)
	}
	task.WorkOrderPlan.Repos = append(task.WorkOrderPlan.Repos, workorder.Checkout{Directory: "code/missing", ModuleKey: "missing"})
	if _, err := d.publishWorkOrderForks(ctx, task, workDir); err == nil || !strings.Contains(err.Error(), "preparation did not complete") {
		t.Fatalf("partial dependency preparation was accepted: %v", err)
	}
}

func TestPersonalForkPromptDelegatesDeliveryToDaemon(t *testing.T) {
	task := Task{IssueID: "issue", WorkOrderPlan: &workorder.Plan{PersonalFork: true}}
	prompt := BuildPrompt(task, "codex")
	for _, want := range []string{"work-order-manifest.json", "workspace's configured GitLab identity",
		"commit intended changes", "Do not clone again", "never approves or merges automatically"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("missing delivery contract %q", want)
		}
	}
	task.WorkOrderPlan = nil
	if strings.Contains(BuildPrompt(task, "codex"), "Repository delivery is managed") {
		t.Fatal("ordinary workspace task received fork delivery instructions")
	}
}
