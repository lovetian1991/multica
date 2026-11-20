package repocache

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedObjectsReuseCacheWithPrivateTaskMetadata(t *testing.T) {
	ctx := context.Background()
	source := createTestRepo(t)
	content := strings.Repeat("shared product source\n", 50000)
	if err := os.WriteFile(filepath.Join(source, "source.txt"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitAuthored(t, source, "add", "source.txt")
	runGitAuthored(t, source, "commit", "-m", "product source")
	blob, err := runGitOutputContext(ctx, "-C", source, "rev-parse", "HEAD:source.txt")
	if err != nil {
		t.Fatal(err)
	}
	object := strings.TrimSpace(string(blob))
	cache := New(t.TempDir(), testLogger())
	if err := cache.Sync("ws", []RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	bare := cache.Lookup("ws", source)
	var checkouts []*WorktreeResult
	for _, id := range []string{"first-task", "second-task"} {
		result, err := cache.CreateWorktreeContext(ctx, WorktreeParams{
			WorkspaceID: "ws", RepoURL: source, WorkDir: t.TempDir(),
			AgentName: "Fixture", TaskID: id, IsolatedGitMetadata: true, SharedObjects: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		alternates, err := os.ReadFile(filepath.Join(result.Path, ".git", "objects", "info", "alternates"))
		if err != nil || !sameResolvedPath(strings.TrimSpace(string(alternates)), filepath.Join(bare, "objects")) {
			t.Fatalf("checkout did not reuse the cache object store: %q %v", alternates, err)
		}
		info, err := os.Stat(filepath.Join(result.Path, ".git"))
		if err != nil || !info.IsDir() {
			t.Fatal("task metadata must stay inside its sandbox")
		}
		if data, err := os.ReadFile(filepath.Join(result.Path, "source.txt")); err != nil || strings.ReplaceAll(string(data), "\r\n", "\n") != content {
			t.Fatalf("shared source contents are incomplete: %v", err)
		}
		if _, err := os.Stat(filepath.Join(result.Path, ".git", "objects", object[:2], object[2:])); !os.IsNotExist(err) {
			t.Fatalf("baseline source object was duplicated in task checkout: %v", err)
		}
		checkouts = append(checkouts, result)
	}
	base := gitHead(t, checkouts[1].Path)
	addEmptyCommit(t, checkouts[0].Path, "private task commit")
	if gitHead(t, checkouts[1].Path) != base || gitHead(t, bare) != base {
		t.Fatal("task commit changed another checkout or cache head")
	}
	if checkouts[0].BranchName == checkouts[1].BranchName {
		t.Fatal("tasks shared a writable branch")
	}
	live, err := HasSharedCheckouts(ctx, bare)
	if err != nil || !live {
		t.Fatalf("cache eviction did not discover isolated borrowers: %v %v", live, err)
	}
	// Both paths are test-owned temporary directories, never user workdirs.
	for _, checkout := range checkouts {
		if err := os.RemoveAll(checkout.Path); err != nil {
			t.Fatal(err)
		}
	}
	live, err = HasSharedCheckouts(ctx, bare)
	if err != nil || live {
		t.Fatalf("removed borrowers still retain the cache: %v %v", live, err)
	}
	refs, err := runGitOutputContext(ctx, "-C", bare, "for-each-ref", "--format=%(refname)", "refs/mc/")
	if err != nil || len(strings.TrimSpace(string(refs))) > 0 {
		t.Fatalf("removed borrowers left pins: %s %v", refs, err)
	}
}

func TestSharedObjectsHydratePartialCacheOnce(t *testing.T) {
	ctx := context.Background()
	source := strings.TrimPrefix(createFilterableTestRepo(t), "file://")
	if err := os.WriteFile(filepath.Join(source, ".gitattributes"), []byte("internal.txt export-ignore\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "internal.txt"), []byte("development source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitAuthored(t, source, "add", ".gitattributes", "internal.txt")
	runGitAuthored(t, source, "commit", "-m", "source excluded from archives")
	blob, err := runGitOutputContext(ctx, "-C", source, "rev-parse", "HEAD:internal.txt")
	if err != nil {
		t.Fatal(err)
	}
	object := strings.TrimSpace(string(blob))
	cache := New(t.TempDir(), testLogger())
	bare := filepath.Join(cache.root, "ws", bareDirName(source))
	if err := os.MkdirAll(filepath.Dir(bare), 0o700); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.ToSlash(source)
	if !strings.HasPrefix(sourcePath, "/") {
		sourcePath = "/" + sourcePath
	}
	sourceURL := (&url.URL{Scheme: "file", Path: sourcePath}).String()
	runGitAuthored(t, "", "clone", "--bare", "--filter=blob:none", sourceURL, bare)
	if err := ensureRemoteTrackingLayoutContext(ctx, bare); err != nil {
		t.Fatal(err)
	}
	if !isPartialCloneContext(ctx, bare) {
		t.Fatal("fixture is not a partial clone")
	}
	for _, id := range []string{"first", "second"} {
		result, err := cache.CreateWorktreeContext(ctx, WorktreeParams{
			WorkspaceID: "ws", RepoURL: source, WorkDir: t.TempDir(),
			AgentName: "Fixture", TaskID: id, IsolatedGitMetadata: true, SharedObjects: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range partialCloneTestFiles {
			data, err := os.ReadFile(filepath.Join(result.Path, name))
			if err != nil || strings.ReplaceAll(string(data), "\r\n", "\n") != "contents of "+name+"\n" {
				t.Fatalf("shared partial checkout is missing %s: %v", name, err)
			}
		}
		if data, err := os.ReadFile(filepath.Join(result.Path, "internal.txt")); err != nil || strings.ReplaceAll(string(data), "\r\n", "\n") != "development source\n" {
			t.Fatalf("shared checkout is missing archive-excluded source: %v", err)
		}
		if _, err := os.Stat(filepath.Join(bare, "objects", object[:2], object[2:])); err != nil {
			// Fetches can store objects in a pack, so inspect without lazy fetch.
			cmd := newGitCommand("-C", bare, "cat-file", "-e", object)
			cmd.Env = append(os.Environ(), "GIT_NO_LAZY_FETCH=1")
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("archive-excluded source was fetched into task instead of cache: %s %v", out, err)
			}
		}
	}
	entries, err := os.ReadDir(filepath.Join(bare, ".multica-hydrated"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("same baseline was not hydrated exactly once: %v", err)
	}
}

func TestSharedObjectsPinBaselineAcrossRemoteRewriteAndGC(t *testing.T) {
	ctx := context.Background()
	source := createTestRepo(t)
	cache := New(t.TempDir(), testLogger())
	if err := cache.Sync("ws", []RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	bare := cache.Lookup("ws", source)
	base := gitHead(t, source)
	result, err := cache.CreateWorktreeContext(ctx, WorktreeParams{
		WorkspaceID: "ws", RepoURL: source, WorkDir: t.TempDir(),
		AgentName: "Fixture", TaskID: "pinned-task", IsolatedGitMetadata: true, SharedObjects: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Remove every cache ref except borrower pins, then aggressively prune.
	refs, err := runGitOutputContext(ctx, "-C", bare, "for-each-ref", "--format=%(refname)")
	if err != nil {
		t.Fatal(err)
	}
	for _, ref := range strings.Fields(string(refs)) {
		if !strings.HasPrefix(ref, "refs/mc/") {
			runGitAuthored(t, bare, "update-ref", "-d", ref)
		}
	}
	runGitAuthored(t, bare, "reflog", "expire", "--expire=now", "--all")
	runGitAuthored(t, bare, "gc", "--prune=now")
	if got := gitHead(t, result.Path); got != base {
		t.Fatalf("cache maintenance lost the borrowed baseline: %s", got)
	}
	runGitAuthored(t, result.Path, "fsck", "--no-reflogs")
}

func TestVerifyMergedCheckoutRetainsUnfinishedWork(t *testing.T) {
	ctx := context.Background()
	source := createTestRepo(t)
	runGitAuthored(t, source, "branch", "prod-fixture")
	cache := New(t.TempDir(), testLogger())
	if err := cache.Sync("ws", []RepoInfo{{URL: source}}); err != nil {
		t.Fatal(err)
	}
	result, err := cache.CreateWorktreeContext(ctx, WorktreeParams{
		WorkspaceID: "ws", RepoURL: source, Ref: "prod-fixture", WorkDir: t.TempDir(),
		AgentName: "Fixture", TaskID: "merge-test", IsolatedGitMetadata: true, SharedObjects: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	addEmptyCommit(t, result.Path, "feature")
	if err := VerifyMergedCheckout(ctx, result.Path, source, "prod-fixture"); err == nil {
		t.Fatal("accepted unpushed feature")
	}
	runGitAuthored(t, result.Path, "push", "origin", "HEAD:refs/heads/feature-fixture")
	if err := VerifyMergedCheckout(ctx, result.Path, source, "prod-fixture"); err == nil {
		t.Fatal("a pushed feature is not proof of a merge")
	}
	runGitAuthored(t, source, "update-ref", "refs/heads/prod-fixture", gitHead(t, result.Path))
	if err := VerifyMergedCheckout(ctx, result.Path, source, "prod-fixture"); err != nil {
		t.Fatalf("merged clean checkout was retained: %v", err)
	}
	if err := os.WriteFile(filepath.Join(result.Path, "local-work.txt"), []byte("not committed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyMergedCheckout(ctx, result.Path, source, "prod-fixture"); err == nil {
		t.Fatal("accepted untracked local work")
	}
	if err := os.Remove(filepath.Join(result.Path, "local-work.txt")); err != nil {
		t.Fatal(err)
	}
	runGitAuthored(t, result.Path, "branch", "saved-local-branch")
	runGitAuthored(t, result.Path, "checkout", "saved-local-branch")
	addEmptyCommit(t, result.Path, "unmerged other branch")
	runGitAuthored(t, result.Path, "checkout", result.BranchName)
	if err := VerifyMergedCheckout(ctx, result.Path, source, "prod-fixture"); err == nil {
		t.Fatal("accepted another local branch with unmerged work")
	}
	if err := VerifyMergedCheckout(ctx, result.Path, source, "missing-target"); err == nil {
		t.Fatal("missing remote target must retain the checkout")
	}
}
