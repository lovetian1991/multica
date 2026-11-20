package daemon

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/daemon/repocache"
	"github.com/multica-ai/multica/server/internal/workorder"
)

func TestWorkOrderGCForkUsesWorkspaceCredentialAndUpstreamVersion(t *testing.T) {
	ctx := context.Background()
	mux := http.NewServeMux()
	credentialCalls := 0
	mux.HandleFunc("/api/daemon/workspaces/ws/gitlab/credential", func(w http.ResponseWriter, r *http.Request) {
		credentialCalls++
		fmt.Fprint(w, `{"instance_url":"http://git.workspace.test","access_token":"workspace-token"}`)
	})
	d := newGCTestDaemon(t, mux)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws", "fork-task", nil)
	workDir := filepath.Join(taskDir, "workdir")
	source := createGCGitRepo(t)
	runGitForGC(t, source, "branch", "prod-fixture")
	repo := workorder.Checkout{ModuleKey: "main", RepoURL: "http://git.workspace.test/team/app.git",
		Ref: "proj-personal", BaseRef: "prod-fixture", Directory: "code/app"}
	checkout := filepath.Join(workDir, filepath.FromSlash(repo.Directory))
	runGitForGC(t, "", "clone", source, checkout)
	runGitForGC(t, checkout, "config", "url."+filepath.ToSlash(source)+".insteadOf", repo.RepoURL)
	manifest := workOrderManifest{Plan: &workorder.Plan{PersonalFork: true, Repos: []workorder.Checkout{repo}},
		Checkouts: []workOrderCheckoutManifest{{Directory: repo.Directory, Ref: repo.Ref, SHA: "prepared"}}}
	if err := writeWorkOrderManifest(workDir, manifest); err != nil {
		t.Fatal(err)
	}
	if err := d.verifyWorkOrderCleanup(ctx, taskDir); err != nil {
		t.Fatalf("verified upstream version could not be authenticated: %v", err)
	}
	if credentialCalls != 1 {
		t.Fatal("cleanup did not resolve the current workspace credential")
	}
	runGitForGC(t, checkout, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "not merged")
	if err := d.verifyWorkOrderCleanup(ctx, taskDir); err == nil {
		t.Fatal("personal fork commit was accepted without an upstream merge")
	}
}

func TestWorkOrderGCRequiresVerifiedRemoteMerge(t *testing.T) {
	ctx := context.Background()
	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws", "work-order-task", nil)
	workDir := filepath.Join(taskDir, "workdir")
	source := createGCGitRepo(t)
	runGitForGC(t, "", "-C", source, "branch", "prod-fixture")
	repo := workorder.Checkout{
		ModuleKey: "main", RepoURL: source, Ref: "prod-fixture", Directory: "code/product/v1/main",
	}
	checkout := filepath.Join(workDir, filepath.FromSlash(repo.Directory))
	runGitForGC(t, "", "clone", source, checkout)
	runGitForGC(t, "", "-C", checkout, "checkout", "-b", "feature-fixture", "origin/prod-fixture")
	manifest := workOrderManifest{Plan: &workorder.Plan{Repos: []workorder.Checkout{repo}}}
	if err := writeWorkOrderManifest(workDir, manifest); err != nil {
		t.Fatal(err)
	}
	stats := &gcStats{}
	if got := d.applyGCAction(ctx, taskDir, gcActionClean, stats); got != 0 {
		t.Fatal("failed preparation was removed")
	}
	runGitForGC(t, "", "-C", checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "feature")
	manifest.Checkouts = []workOrderCheckoutManifest{{Directory: repo.Directory, Ref: repo.Ref, SHA: "prepared", Branch: "feature-fixture"}}
	if err := writeWorkOrderManifest(workDir, manifest); err != nil {
		t.Fatal(err)
	}
	if got := d.applyGCAction(ctx, taskDir, gcActionClean, stats); got != 0 {
		t.Fatal("unmerged code was removed")
	}
	runGitForGC(t, "", "-C", checkout, "push", "origin", "HEAD:refs/heads/prod-fixture")
	if got := d.applyGCAction(ctx, taskDir, gcActionClean, stats); got != 1 {
		t.Fatal("verified merged checkout was not removed")
	}
	if _, err := os.Stat(taskDir); !os.IsNotExist(err) {
		t.Fatalf("task directory was retained: %v", err)
	}
}

func TestWorkOrderGCProtectsSharedCache(t *testing.T) {
	ctx := context.Background()
	d := newGCTestDaemon(t, http.NewServeMux())
	d.cfg.GCRepoTTL = time.Millisecond
	source := createGCGitRepo(t)
	cache := repocache.New(filepath.Join(d.cfg.WorkspacesRoot, reposDirName), d.logger)
	d.repoCache = cache
	if err := cache.Sync("ws", []repocache.RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	bare := cache.Lookup("ws", source)
	result, err := cache.CreateWorktreeContext(ctx, repocache.WorktreeParams{
		WorkspaceID: "ws", RepoURL: source, WorkDir: t.TempDir(),
		AgentName: "Fixture", TaskID: "borrower", IsolatedGitMetadata: true, SharedObjects: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	stats := &gcStats{}
	d.withRepoLock(bare, func() { d.evictRepoCacheLocked(ctx, bare, stats) })
	if _, err := os.Stat(bare); err != nil || stats.repoCachesReclaimed != 0 {
		t.Fatalf("live borrower lost its cache: %v", err)
	}
	// This checkout is in a test-owned temporary root.
	if err := os.RemoveAll(result.Path); err != nil {
		t.Fatal(err)
	}
	d.withRepoLock(bare, func() { d.evictRepoCacheLocked(ctx, bare, stats) })
	if _, err := os.Stat(bare); !os.IsNotExist(err) || stats.repoCachesReclaimed != 1 {
		t.Fatalf("unused cache could not be reclaimed: %v", err)
	}
}
