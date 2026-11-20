package repocache

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/daemon/processtree"
)

const sharedCheckoutRecords = ".multica-shared-checkouts"

func prepareSharedObjectsContext(ctx context.Context, barePath, checkoutPath, commit string) error {
	// Hydrate in the cache, not in each task's promisor object store.
	if isPartialCloneContext(ctx, barePath) {
		marker := filepath.Join(barePath, ".multica-hydrated", commit)
		if _, err := os.Stat(marker); os.IsNotExist(err) {
			archiveCtx, cancel := context.WithTimeout(ctx, repoCacheGitTimeout)
			defer cancel()
			cmd := newGitCommand("-C", barePath, "archive", "--format=tar", commit)
			applyGitCredential(archiveCtx, cmd)
			var stderr bytes.Buffer
			cmd.Stdout, cmd.Stderr = io.Discard, &stderr
			if err := processtree.Run(archiveCtx, cmd, 5*time.Second); err != nil {
				return fmt.Errorf("hydrate shared repository objects: %s: %w", strings.TrimSpace(string(redactGitCredential(archiveCtx, stderr.Bytes()))), err)
			}
			if err := os.MkdirAll(filepath.Dir(marker), 0o700); err != nil {
				return err
			}
			if err := os.WriteFile(marker, nil, 0o600); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	path, err := filepath.Abs(checkoutPath)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(filepath.Clean(path)))
	key := fmt.Sprintf("%x", digest[:16])
	// Keep every borrowed base reachable even after a force-push or ref prune.
	ref := "refs/mc/" + key + "/" + commit
	if out, err := runGitCombinedOutputContext(ctx, "-C", barePath, "update-ref", ref, commit); err != nil {
		return fmt.Errorf("pin shared checkout base: %s: %w", strings.TrimSpace(string(out)), err)
	}
	dir := filepath.Join(barePath, sharedCheckoutRecords)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, key), []byte(path), 0o600); err != nil {
		return fmt.Errorf("register shared checkout: %w", err)
	}
	return nil
}

// HasSharedCheckouts must run under the repository lock. The records protect
// isolated borrowers that do not appear in `git worktree list`.
func HasSharedCheckouts(ctx context.Context, barePath string) (bool, error) {
	dir := filepath.Join(barePath, sharedCheckoutRecords)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	live := false
	for _, entry := range entries {
		if ctx.Err() != nil {
			return true, context.Cause(ctx)
		}
		if entry.IsDir() {
			return true, fmt.Errorf("invalid shared checkout record")
		}
		record := filepath.Join(dir, entry.Name())
		data, err := os.ReadFile(record)
		if err != nil {
			return true, err
		}
		path := string(data)
		if !filepath.IsAbs(path) {
			return true, fmt.Errorf("invalid shared checkout path")
		}
		if _, err := os.Stat(path); err == nil {
			live = true
			continue
		} else if !os.IsNotExist(err) {
			return true, err
		}
		refs, err := runGitOutputContext(ctx, "-C", barePath, "for-each-ref", "--format=%(refname)", "refs/mc/"+entry.Name()+"/")
		if err != nil {
			return true, err
		}
		for _, ref := range strings.Fields(string(refs)) {
			if err := runGitContext(ctx, "-C", barePath, "update-ref", "-d", ref); err != nil {
				return true, err
			}
		}
		if err := os.Remove(record); err != nil {
			return true, err
		}
	}
	return live, nil
}
