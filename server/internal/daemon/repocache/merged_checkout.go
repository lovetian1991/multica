package repocache

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/pkg/redact"
)

// VerifyMergedCheckout requires every local branch to be present in the exact
// remote target. Task success and a push to a feature branch are insufficient.
func VerifyMergedCheckout(ctx context.Context, path, repoURL, targetRef string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if repoURL == "" || targetRef == "" || strings.HasPrefix(targetRef, "-") {
		return fmt.Errorf("cleanup requires an explicit remote and target branch")
	}
	if err := runGitContext(ctx, "check-ref-format", "refs/heads/"+targetRef); err != nil {
		return fmt.Errorf("invalid cleanup target branch %q", targetRef)
	}
	status, err := runGitOutputContext(ctx, "-C", path, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none")
	if err != nil {
		return fmt.Errorf("inspect checkout before cleanup: %w", err)
	}
	if len(status) > 0 {
		return fmt.Errorf("checkout has uncommitted or untracked files")
	}
	// This private ref cannot accidentally accept an old origin/* snapshot or
	// another task's source branch as proof of a merge.
	const target = "refs/multica/cleanup-target"
	out, err := runGitCombinedOutputContext(ctx, "-C", path, "fetch", "--no-tags", repoURL, "+refs/heads/"+targetRef+":"+target)
	if err != nil {
		return fmt.Errorf("verify remote merge target %s: %s: %w", targetRef, redact.Text(strings.TrimSpace(string(out))), err)
	}
	refs, err := runGitOutputContext(ctx, "-C", path, "for-each-ref", "--format=%(refname)", "refs/heads/")
	if err != nil {
		return fmt.Errorf("inspect local branches before cleanup: %w", err)
	}
	for _, ref := range append([]string{"HEAD"}, strings.Fields(string(refs))...) {
		if err := runGitContext(ctx, "-C", path, "merge-base", "--is-ancestor", ref, target); err != nil {
			return fmt.Errorf("checkout %s is not verified merged into %s; retaining local code", ref, targetRef)
		}
	}
	stashes, err := runGitOutputContext(ctx, "-C", path, "stash", "list", "--format=%H")
	if err != nil || len(strings.TrimSpace(string(stashes))) > 0 {
		return fmt.Errorf("checkout has stashed work or stash inspection failed")
	}
	return nil
}
