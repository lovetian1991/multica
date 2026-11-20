package daemon

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/daemon/repocache"
	"github.com/multica-ai/multica/server/internal/workorder"
)

type workOrderTestCache struct {
	recordingRepoCache
	fetchError string
	synced     []repocache.RepoInfo
}

func (c *workOrderTestCache) CreateWorktreeContext(_ context.Context, params repocache.WorktreeParams) (*repocache.WorktreeResult, error) {
	result, err := c.CreateWorktree(params)
	if result != nil {
		result.FetchError = c.fetchError
	}
	return result, err
}

func (c *workOrderTestCache) Sync(_ string, repos []repocache.RepoInfo) error {
	c.synced = repos
	c.lookupPath = "synced-cache"
	return nil
}

func TestWorkOrderCheckoutPreparesSharedRepositoryOnce(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", dir},
		{"-C", dir, "-c", "user.name=Work Order Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git fixture: %v: %s", err, out)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "api"), 0o700); err != nil {
		t.Fatal(err)
	}
	cache := &workOrderTestCache{recordingRepoCache: recordingRepoCache{lookupPath: "cached"}}
	d := newRepoCheckoutTestDaemon(t, "ws", "https://git.example.test/app.git", dir, cache)
	task := Task{ID: "task-1", WorkspaceID: "ws", WorkOrderPlan: &workorder.Plan{
		KBRootID: "shared-root", Compose: "services: {}\n",
		Repos: []workorder.Checkout{
			{ModuleKey: "api", RepoURL: "https://git.example.test/app.git", Ref: "legacy/v6", Directory: "product/api", Subpath: "api"},
			{ModuleKey: "web", RepoURL: "https://git.example.test/app.git", Ref: "legacy/v6", Directory: "product/api", Subpath: "missing"},
		},
	}}
	if err := d.prepareWorkOrderRepos(context.Background(), task, dir, "Repair Agent"); err == nil || !strings.Contains(err.Error(), "web subpath") {
		t.Fatalf("shared checkout skipped the second module validation: %v", err)
	}
	cache.params = nil
	task.WorkOrderPlan.Repos[1].Subpath = "api"
	if err := d.prepareWorkOrderRepos(context.Background(), task, dir, "Repair Agent"); err != nil {
		t.Fatal(err)
	}
	if len(cache.params) != 1 {
		t.Fatalf("expected one shared checkout, got %d", len(cache.params))
	}
	p := cache.lastCreateParams()
	if p.Ref != "legacy/v6" || p.DirectoryName != "product/api" || !p.IsolatedGitMetadata || !p.SharedObjects {
		t.Fatalf("checkout lost baseline or isolation: %+v", p)
	}
	data, err := os.ReadFile(filepath.Join(dir, "work-order-manifest.json"))
	var manifest struct {
		Checkouts []struct{ SHA string }
	}
	if err != nil || json.Unmarshal(data, &manifest) != nil || len(manifest.Checkouts) != 1 || len(manifest.Checkouts[0].SHA) != 40 {
		t.Fatalf("missing checkout SHA manifest: %s %v", data, err)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "work-order-compose.yaml")); err != nil || string(data) != task.WorkOrderPlan.Compose {
		t.Fatalf("compose template was not preserved: %s %v", data, err)
	}
	cache.fetchError = "remote unavailable"
	if err := d.prepareWorkOrderRepos(context.Background(), task, dir, "Repair Agent"); err == nil || !strings.Contains(err.Error(), "refresh") {
		t.Fatalf("stale cached code was accepted after fetch failure: %v", err)
	}
}

func TestWorkOrderTaskRepositoryColdCacheIsSynchronized(t *testing.T) {
	cache := &workOrderTestCache{}
	d := newRepoCheckoutTestDaemon(t, "ws", "https://git.example.test/default.git", t.TempDir(), cache)
	const claimedRepo = "https://git.example.test/legacy.git"
	d.workspaces["ws"].taskRepoURLs = map[string]struct{}{claimedRepo: {}}
	if err := d.ensureRepoReady(context.Background(), "ws", claimedRepo); err != nil {
		t.Fatalf("claimed cold-cache repository was not synchronized: %v", err)
	}
	found := false
	for _, repo := range cache.synced {
		if repo.URL == claimedRepo {
			found = true
		}
	}
	if !found {
		t.Fatalf("sync omitted claimed repository: %+v", cache.synced)
	}
	if err := d.ensureRepoReady(context.Background(), "ws", "https://git.example.test/unauthorized.git"); err != ErrRepoNotConfigured {
		t.Fatalf("unclaimed repository was authorized: %v", err)
	}
}

func TestWorkOrderSubmoduleCompleteness(t *testing.T) {
	for _, state := range []string{"none", "missing-mapping", "uninitialized", "ready", "wrong-revision"} {
		t.Run(state, func(t *testing.T) {
			dir := t.TempDir()
			run := func(args ...string) string {
				t.Helper()
				out, err := exec.Command("git", args...).CombinedOutput()
				if err != nil {
					t.Fatalf("git %v: %v: %s", args, err, out)
				}
				return strings.TrimSpace(string(out))
			}
			run("init", dir)
			run("-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "base")
			if state != "none" {
				sha := run("-C", dir, "rev-parse", "HEAD")
				run("-C", dir, "update-index", "--add", "--cacheinfo", "160000,"+sha+",module")
				if state != "missing-mapping" {
					run("-C", dir, "config", "-f", ".gitmodules", "submodule.fixture.path", "module")
					run("-C", dir, "config", "-f", ".gitmodules", "submodule.fixture.url", dir)
				}
				if state == "ready" || state == "wrong-revision" {
					run("clone", "--no-hardlinks", dir, filepath.Join(dir, "module"))
					run("-C", dir, "config", "submodule.fixture.url", dir)
					if state == "wrong-revision" {
						run("-C", filepath.Join(dir, "module"), "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "changed")
					}
				}
			}
			err := validateWorkOrderSubmodules(context.Background(), dir, "frontend")
			if state == "none" || state == "ready" {
				if err != nil {
					t.Fatalf("complete checkout rejected: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), "frontend") {
				t.Fatalf("incomplete submodule accepted: %v", err)
			}
		})
	}
}
