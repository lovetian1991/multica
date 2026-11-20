package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/daemon/repocache"
	"github.com/multica-ai/multica/server/internal/workorder"
)

type workOrderCheckoutManifest struct {
	Directory string                `json:"directory"`
	Ref       string                `json:"ref"`
	SHA       string                `json:"sha"`
	Branch    string                `json:"branch"`
	Fork      *workOrderForkReceipt `json:"fork,omitempty"`
}

type workOrderManifest struct {
	Plan      *workorder.Plan             `json:"plan"`
	Checkouts []workOrderCheckoutManifest `json:"checkouts"`
}

func (d *Daemon) prepareWorkOrderRepos(ctx context.Context, task Task, workDir, agentName string) error {
	return d.prepareWorkOrderReposWithProgress(ctx, task, workDir, agentName, nil)
}

func (d *Daemon) prepareWorkOrderReposWithProgress(ctx context.Context, task Task, workDir, agentName string, progress func(string, workorder.Checkout, string)) error {
	if d.repoCache == nil {
		return fmt.Errorf("work order repository cache is unavailable")
	}
	previous, previousErr := readWorkOrderManifest(workDir)
	if previousErr != nil && !os.IsNotExist(previousErr) {
		return fmt.Errorf("read existing work order manifest: %w", previousErr)
	}
	manifest := workOrderManifest{Plan: task.WorkOrderPlan, Checkouts: previous.Checkouts}
	// Record ownership before cloning so a failed preparation also retains
	// its repository until remote durability can be checked.
	if err := writeWorkOrderManifest(workDir, manifest); err != nil {
		return err
	}
	seen := map[string]string{}
	for _, repo := range task.WorkOrderPlan.Repos {
		if dir, exists := seen[repo.Directory]; exists {
			if err := validateWorkOrderSubpath(dir, repo.ModuleKey, repo.Subpath); err != nil {
				return err
			}
			continue
		}
		if !filepath.IsLocal(repo.Directory) || strings.ContainsAny(repo.Directory, "\\:") {
			return fmt.Errorf("unsafe work order repository directory")
		}
		if progress != nil {
			progress("preparing", repo, "")
		}
		d.logger.Info("preparing work order repository", "directory", repo.Directory, "ref", repo.Ref)
		repoCtx := ctx
		var fork *workOrderForkReceipt
		if task.WorkOrderPlan.PersonalFork {
			if progress != nil {
				progress("resolving_fork", repo, "")
			}
			client, err := d.workspaceGitLab(ctx, task.WorkspaceID, repo.RepoURL)
			if err != nil {
				return fmt.Errorf("module %s: %w", repo.ModuleKey, err)
			}
			apiCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			identity, err := client.EnsurePersonalFork(apiCtx, repo.RepoURL)
			cancel()
			if err != nil {
				return fmt.Errorf("module %s: %w", repo.ModuleKey, err)
			}
			fork = &workOrderForkReceipt{
				InstanceURL: client.InstanceURL, Identity: identity,
				ProjectBranch: forkProjectBranch(task, repo), TargetBranch: upstreamVersionRef(repo),
			}
			repoCtx = repocache.WithGitLabCredential(ctx, client.InstanceURL, client.Token, repo.RepoURL, identity.Upstream.HTTPURL)
		}
		if err := d.ensureRepoReady(repoCtx, task.WorkspaceID, repo.RepoURL); err != nil {
			return fmt.Errorf("prepare work order module %s: %w", repo.ModuleKey, err)
		}
		params := repocache.WorktreeParams{
			WorkspaceID: task.WorkspaceID, RepoURL: repo.RepoURL, WorkDir: workDir,
			DirectoryName: repo.Directory, Ref: repo.Ref, AgentName: agentName, TaskID: task.ID,
			IsolatedGitMetadata: true,
			SharedObjects:       true,
		}
		// Project branches are created from the version baseline on first use.
		// Ticket overrides stay explicit: a missing branch there is an error.
		if fork != nil {
			params.Ref = upstreamVersionRef(repo)
		} else if repo.RefSource == "project" && repo.BaseRef != "" {
			params.CreateRefFrom = repo.BaseRef
		}
		cache, ok := d.repoCache.(interface {
			CreateWorktreeContext(context.Context, repocache.WorktreeParams) (*repocache.WorktreeResult, error)
		})
		if !ok {
			return fmt.Errorf("work order checkout requires a context-aware repository cache")
		}
		if progress != nil {
			progress("checkout", repo, "")
		}
		result, err := cache.CreateWorktreeContext(repoCtx, params)
		if err != nil {
			return fmt.Errorf("checkout work order module %s: %w", repo.ModuleKey, err)
		}
		if result.FetchError != "" {
			return fmt.Errorf("refresh work order module %s failed: %s", repo.ModuleKey, result.FetchError)
		}
		out, err := exec.CommandContext(ctx, "git", "-C", result.Path, "rev-parse", "HEAD").Output()
		if err != nil {
			return fmt.Errorf("resolve work order module %s revision: %w", repo.ModuleKey, err)
		}
		if err := validateWorkOrderSubpath(result.Path, repo.ModuleKey, repo.Subpath); err != nil {
			return err
		}
		if err := validateWorkOrderSubmodules(ctx, result.Path, repo.ModuleKey); err != nil {
			return err
		}
		prepared := workOrderCheckoutManifest{
			Directory: repo.Directory, Ref: repo.Ref, SHA: strings.TrimSpace(string(out)), Branch: result.BranchName, Fork: fork,
		}
		if fork != nil {
			resumed := false
			for _, old := range previous.Checkouts {
				if old.Directory == repo.Directory && old.Fork != nil {
					if old.Ref != repo.Ref || old.Branch != result.BranchName || old.Fork.TargetBranch != fork.TargetBranch ||
						old.Fork.ProjectBranch != fork.ProjectBranch || old.Fork.Identity.Fork.ID != fork.Identity.Fork.ID ||
						old.Fork.Identity.Upstream.ID != fork.Identity.Upstream.ID {
						return fmt.Errorf("module %s fork configuration changed; retain this checkout and prepare a fresh task directory", repo.ModuleKey)
					}
					prepared, resumed = old, true
					break
				}
			}
			if err := configureForkRemotes(repoCtx, result.Path, repo.RepoURL, *fork); err != nil {
				return err
			}
			if !resumed {
				if progress != nil {
					progress("synchronizing_project_branch", repo, "")
				}
				baseline, err := forkGit(repoCtx, result.Path, "rev-parse", "refs/remotes/origin/"+params.Ref+"^{commit}")
				if err != nil {
					return fmt.Errorf("resolve explicit upstream version baseline: %w", err)
				}
				if err := prepareForkProject(repoCtx, result.Path, baseline, *fork); err != nil {
					return fmt.Errorf("prepare module %s personal project branch: %w", repo.ModuleKey, err)
				}
				prepared.SHA, err = forkGit(repoCtx, result.Path, "rev-parse", "HEAD")
				if err != nil {
					return err
				}
			}
		}
		seen[repo.Directory] = result.Path
		replaced := false
		for i := range manifest.Checkouts {
			if manifest.Checkouts[i].Directory == repo.Directory {
				manifest.Checkouts[i], replaced = prepared, true
				break
			}
		}
		if !replaced {
			manifest.Checkouts = append(manifest.Checkouts, prepared)
		}
		if err := writeWorkOrderManifest(workDir, manifest); err != nil {
			return err
		}
		if progress != nil {
			progress("ready", repo, prepared.SHA)
		}
	}
	if task.WorkOrderPlan.Compose != "" {
		// Keep the original compose topology; starting environments is an explicit operator action.
		if err := os.WriteFile(filepath.Join(workDir, "work-order-compose.yaml"), []byte(task.WorkOrderPlan.Compose), 0o600); err != nil {
			return fmt.Errorf("write work order compose: %w", err)
		}
	}
	return nil
}

func writeWorkOrderManifest(workDir string, manifest workOrderManifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(workDir, "work-order-manifest.json"), data, 0o600); err != nil {
		return fmt.Errorf("write work order manifest: %w", err)
	}
	return nil
}

func validateWorkOrderSubpath(dir, module, subpath string) error {
	if subpath == "" {
		return nil
	}
	if !filepath.IsLocal(subpath) || strings.ContainsAny(subpath, "\\:") {
		return fmt.Errorf("module %s has an unsafe subpath", module)
	}
	info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(subpath)))
	if err != nil || !info.IsDir() {
		return fmt.Errorf("module %s subpath does not exist", module)
	}
	return nil
}

func validateWorkOrderSubmodules(ctx context.Context, dir, module string) error {
	out, err := exec.CommandContext(ctx, "git", "-C", dir, "submodule", "status", "--recursive").CombinedOutput()
	if err != nil {
		return fmt.Errorf("module %s submodule validation failed: %w: %s", module, err, strings.TrimSpace(string(out)))
	}
	for _, line := range strings.Split(string(out), "\n") {
		if line != "" && line[0] != ' ' {
			return fmt.Errorf("module %s has an incomplete submodule checkout: %s; initialize the configured submodule at its recorded revision before continuing", module, strings.TrimSpace(line))
		}
	}
	return nil
}
