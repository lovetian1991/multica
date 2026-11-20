package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/multica-ai/multica/server/internal/daemon/repocache"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
)

func (d *Daemon) verifyWorkOrderCleanup(ctx context.Context, taskDir string) error {
	workDir := filepath.Join(taskDir, "workdir")
	data, err := os.ReadFile(filepath.Join(workDir, "work-order-manifest.json"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var manifest workOrderManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("invalid work order manifest: %w", err)
	}
	if manifest.Plan == nil || len(manifest.Plan.Repos) == 0 {
		return fmt.Errorf("work order cleanup requires a repository plan")
	}
	seen := map[string]bool{}
	for _, repo := range manifest.Plan.Repos {
		if !filepath.IsLocal(repo.Directory) || strings.ContainsAny(repo.Directory, "\\:") {
			return fmt.Errorf("unsafe work order checkout path")
		}
		path := filepath.Join(workDir, filepath.FromSlash(repo.Directory))
		if seen[path] {
			continue
		}
		seen[path] = true
		if _, err := os.Stat(path); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		prepared := false
		for _, checkout := range manifest.Checkouts {
			if checkout.Directory == repo.Directory && checkout.Ref == repo.Ref && checkout.SHA != "" {
				prepared = true
				break
			}
		}
		if !prepared {
			return fmt.Errorf("retain module %s: checkout preparation did not complete", repo.ModuleKey)
		}
		target := repo.Ref
		repoCtx := ctx
		if manifest.Plan.PersonalFork {
			target = upstreamVersionRef(repo)
			owner, err := d.gcTaskDirOwner(taskDir)
			if err != nil {
				return fmt.Errorf("retain module %s: cannot resolve workspace ownership: %w", repo.ModuleKey, err)
			}
			client, err := d.workspaceGitLab(ctx, owner.WorkspaceID, repo.RepoURL)
			if err != nil {
				return fmt.Errorf("retain module %s: %w", repo.ModuleKey, err)
			}
			project, ok := vcs.RepositoryProject(repo.RepoURL, client.InstanceURL)
			if !ok {
				return fmt.Errorf("retain module %s: upstream does not match workspace GitLab connection", repo.ModuleKey)
			}
			repoCtx = repocache.WithGitLabCredential(ctx, client.InstanceURL, client.Token, repo.RepoURL,
				strings.TrimRight(client.InstanceURL, "/")+"/"+project+".git")
		}
		if err := repocache.VerifyMergedCheckout(repoCtx, path, repo.RepoURL, target); err != nil {
			return fmt.Errorf("retain module %s: %w", repo.ModuleKey, err)
		}
	}
	return nil
}
