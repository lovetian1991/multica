package repocache

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/workorder"
)

func TestWorkOrderPlanCreatesProductVersionModuleDirectories(t *testing.T) {
	source := createTestRepo(t)
	first := gitHead(t, source)
	runGitAuthored(t, source, "tag", "v6")
	addEmptyCommit(t, source, "dependency revision")
	second := gitHead(t, source)
	runGitAuthored(t, source, "tag", "v3")
	versions := map[string]workorder.Version{
		"ecm6": {ID: "ecm6", ProductID: "ecm", ProductSlug: "ecm", Name: "v6", Config: workorder.Config{
			Modules:      []workorder.Module{{Key: "main", RepoURL: "https://git.example.test/repo.git", Ref: "v6"}},
			Dependencies: []string{"inbiz3"},
		}},
		"inbiz3": {ID: "inbiz3", ProductID: "inbiz", ProductSlug: "inbiz", Name: "v3", Config: workorder.Config{
			Modules:      []workorder.Module{{Key: "main", Directory: "services/backend", RepoURL: "https://git.example.test/repo.git", Ref: "v3"}},
			Dependencies: []string{"ecm6"},
		}},
	}
	plan, err := workorder.Resolve(context.Background(), "ecm6", "", nil, nil, func(_ context.Context, id string) (workorder.Version, error) { return versions[id], nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Repos) != 2 {
		t.Fatalf("mutual dependencies should produce exactly two checkouts: %+v", plan.Repos)
	}
	cache := New(t.TempDir(), testLogger())
	if err := cache.Sync("ws", []RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	workDir := t.TempDir()
	want := []string{first, second}
	for i, repo := range plan.Repos {
		// Local fixture replaces only the remote transport; the resolved layout and refs are unchanged.
		result, err := cache.CreateWorktreeContext(context.Background(), WorktreeParams{
			WorkspaceID: "ws", RepoURL: source, Ref: repo.Ref, WorkDir: workDir,
			DirectoryName: repo.Directory, AgentName: "Fixture", TaskID: "fixture",
			IsolatedGitMetadata: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Path != filepath.Join(workDir, filepath.FromSlash(repo.Directory)) || gitHead(t, result.Path) != want[i] {
			t.Fatalf("wrong path or revision: %+v", result)
		}
		if info, err := os.Stat(filepath.Join(result.Path, ".git")); err != nil || !info.IsDir() {
			t.Fatalf("checkout is not independently writable: %v", err)
		}
	}
}

func TestWorkOrderProjectBranchIsCreatedFromBaseline(t *testing.T) {
	source := createTestRepo(t)
	head := gitHead(t, source)
	cache := New(t.TempDir(), testLogger())
	if err := cache.Sync("ws", []RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	bare := cache.Lookup("ws", source)
	baseline, err := resolveBaseRefContext(context.Background(), bare, "")
	if err != nil {
		t.Fatal(err)
	}
	result, err := cache.CreateWorktreeContext(context.Background(), WorktreeParams{
		WorkspaceID: "ws", RepoURL: source, Ref: "proj-fixture-v1", CreateRefFrom: baseline,
		WorkDir: t.TempDir(), AgentName: "Fixture", TaskID: "fixture", IsolatedGitMetadata: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := gitHead(t, result.Path); got != head {
		t.Fatalf("project branch based on %s, want baseline %s", got, head)
	}
	out, err := exec.Command("git", "-C", source, "rev-parse", "refs/heads/proj-fixture-v1").Output()
	if err != nil {
		t.Fatalf("project branch was not created on the remote: %v", err)
	}
	if got := strings.TrimSpace(string(out)); got != head {
		t.Fatalf("remote project branch at %s, want baseline %s", got, head)
	}
}

func TestProductFeatureBranchUsesExplicitBaselineNotDefault(t *testing.T) {
	source := createTestRepo(t)
	baseline := gitHead(t, source)
	runGitAuthored(t, source, "branch", "prod-9.1.0.0")
	addEmptyCommit(t, source, "default branch advances independently")
	defaultHead := gitHead(t, source)
	cache := New(t.TempDir(), testLogger())
	if err := cache.Sync("ws", []RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	result, err := cache.CreateWorktreeContext(context.Background(), WorktreeParams{
		WorkspaceID: "ws", RepoURL: source, Ref: "prod-9.1.0.0",
		WorkDir: t.TempDir(), AgentName: "Fixture", TaskID: "product-feature",
		IsolatedGitMetadata: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := gitHead(t, result.Path); got != baseline || got == defaultHead {
		t.Fatalf("feature branch at %s, want product baseline %s, not default %s", got, baseline, defaultHead)
	}
	if result.BranchName == "prod-9.1.0.0" {
		t.Fatal("task must use an isolated feature branch, not mutate the product baseline")
	}
	_, err = cache.CreateWorktreeContext(context.Background(), WorktreeParams{
		WorkspaceID: "ws", RepoURL: source, Ref: "missing-product-branch",
		WorkDir: t.TempDir(), AgentName: "Fixture", TaskID: "missing-product-feature",
		IsolatedGitMetadata: true,
	})
	if err == nil {
		t.Fatal("missing product branch silently fell back to the default branch")
	}
}
