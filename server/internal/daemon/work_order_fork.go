package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/internal/daemon/repocache"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	"github.com/multica-ai/multica/server/internal/workorder"
)

type workOrderForkReceipt struct {
	InstanceURL   string                 `json:"instance_url"`
	Identity      vcs.GitLabPersonalFork `json:"identity"`
	ProjectBranch string                 `json:"project_branch"`
	TargetBranch  string                 `json:"target_branch"`
	ReviewURL     string                 `json:"review_url,omitempty"`
	SubmittedSHA  string                 `json:"submitted_sha,omitempty"`
}

func (d *Daemon) workspaceGitLab(ctx context.Context, workspaceID, repo string) (vcs.GitLabDeliveryClient, error) {
	var credential struct {
		InstanceURL string `json:"instance_url"`
		AccessToken string `json:"access_token"`
	}
	err := d.client.postJSON(ctx, "/api/daemon/workspaces/"+workspaceID+"/gitlab/credential",
		map[string]string{"repo_url": repo}, &credential)
	if err != nil {
		return vcs.GitLabDeliveryClient{}, fmt.Errorf("resolve current workspace GitLab connection: %w", err)
	}
	if credential.InstanceURL == "" || credential.AccessToken == "" {
		return vcs.GitLabDeliveryClient{}, fmt.Errorf("current workspace GitLab connection has no usable credential")
	}
	return vcs.GitLabDeliveryClient{InstanceURL: credential.InstanceURL, Token: credential.AccessToken}, nil
}

func forkGit(ctx context.Context, dir string, args ...string) (string, error) {
	out, err := repocache.GitOutput(ctx, append([]string{"-C", dir}, args...)...)
	if err != nil {
		return "", fmt.Errorf("git %s: %w: %s", args[0], err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func forkProjectBranch(task Task, repo workorder.Checkout) string {
	if (repo.RefSource == "project" || repo.RefSource == "ticket") && repo.Ref != repo.BaseRef {
		return repo.Ref
	}
	name := task.ProjectTitle
	if name == "" {
		name = task.ProductName
	}
	if name == "" {
		parts := strings.Split(repo.Directory, "/")
		if len(parts) > 1 {
			name = parts[1]
		}
	}
	return workorder.ProjectBranchName(name, repo.VersionName)
}

func upstreamVersionRef(repo workorder.Checkout) string {
	if repo.BaseRef != "" {
		return repo.BaseRef
	}
	return repo.Ref
}

func configureForkRemotes(ctx context.Context, dir, upstream string, receipt workOrderForkReceipt) error {
	// The cache stays keyed by the upstream repository; only task-local
	// metadata uses the fork as origin.
	for _, args := range [][]string{
		{"remote", "set-url", "origin", receipt.Identity.Fork.HTTPURL},
		{"config", "--replace-all", "remote.origin.pushurl", receipt.Identity.Fork.HTTPURL},
		{"config", "--replace-all", "remote.upstream.url", upstream},
		{"config", "--replace-all", "remote.upstream.pushurl", "disabled://upstream-read-only"},
	} {
		if _, err := forkGit(ctx, dir, args...); err != nil {
			return err
		}
	}
	return nil
}

func prepareForkProject(ctx context.Context, dir, baseline string, receipt workOrderForkReceipt) error {
	if !workorder.ValidateRef(receipt.ProjectBranch) || !workorder.ValidateRef(receipt.TargetBranch) {
		return fmt.Errorf("personal project and upstream version branches must be explicit valid refs")
	}
	// A product tag or SHA can be checked out but is not a review target.
	target, err := forkGit(ctx, dir, "ls-remote", "--exit-code", "upstream", "refs/heads/"+receipt.TargetBranch)
	if err != nil {
		return fmt.Errorf("read configured upstream version branch %s (check branch existence and read permission; no default branch will be used): %w", receipt.TargetBranch, err)
	}
	if target == "" {
		return fmt.Errorf("configured upstream version branch %s is missing or inaccessible; no default branch will be used", receipt.TargetBranch)
	}
	current, err := forkGit(ctx, dir, "rev-parse", "HEAD")
	if err != nil {
		return err
	}
	if current != baseline {
		return fmt.Errorf("checkout already contains local work without a fork receipt; retain it and prepare a fresh task directory")
	}
	status, err := forkGit(ctx, dir, "status", "--porcelain")
	if err != nil || status != "" {
		return fmt.Errorf("personal fork initialization requires a clean checkout; local files were retained")
	}
	remote, err := forkGit(ctx, dir, "ls-remote", "origin", "refs/heads/"+receipt.ProjectBranch)
	if err != nil {
		return fmt.Errorf("read personal project branch: %w", err)
	}
	if remote != "" {
		const syncRef = "refs/multica/fork-project"
		if _, err := forkGit(ctx, dir, "fetch", "--no-tags", "origin", "+refs/heads/"+receipt.ProjectBranch+":"+syncRef); err != nil {
			return fmt.Errorf("fetch personal project branch: %w", err)
		}
		if _, err := forkGit(ctx, dir, "-c", "user.name=Multica", "-c", "user.email=probe@multica.local",
			"-c", "commit.gpgsign=false", "merge", "--no-edit", syncRef); err != nil {
			_, _ = forkGit(ctx, dir, "merge", "--abort")
			return fmt.Errorf("personal project branch conflicts with configured product version; resolve the conflict before retrying: %w", err)
		}
	}
	if _, err := forkGit(ctx, dir, "push", "origin", "HEAD:refs/heads/"+receipt.ProjectBranch); err != nil {
		return fmt.Errorf("synchronize personal project branch (check fork write permission; no force push was attempted): %w", err)
	}
	return nil
}

func readWorkOrderManifest(workDir string) (workOrderManifest, error) {
	var manifest workOrderManifest
	data, err := os.ReadFile(filepath.Join(workDir, "work-order-manifest.json"))
	if err != nil {
		return manifest, err
	}
	err = json.Unmarshal(data, &manifest)
	return manifest, err
}

func (d *Daemon) publishWorkOrderForks(ctx context.Context, task Task, workDir string) (string, error) {
	if task.WorkOrderPlan == nil || !task.WorkOrderPlan.PersonalFork {
		return "", nil
	}
	manifest, err := readWorkOrderManifest(workDir)
	if err != nil {
		return "", fmt.Errorf("read fork delivery manifest: %w", err)
	}
	if len(manifest.Checkouts) == 0 {
		return "", fmt.Errorf("fork delivery manifest has no completed checkouts")
	}
	for _, repo := range task.WorkOrderPlan.Repos {
		prepared := false
		for _, checkout := range manifest.Checkouts {
			if checkout.Directory == repo.Directory {
				prepared = true
				break
			}
		}
		if !prepared {
			return "", fmt.Errorf("module %s preparation did not complete; local work was retained", repo.ModuleKey)
		}
	}
	var reviews []string
	for i := range manifest.Checkouts {
		checkout := &manifest.Checkouts[i]
		if checkout.Fork == nil || !filepath.IsLocal(checkout.Directory) || strings.ContainsAny(checkout.Directory, "\\:") {
			return strings.Join(reviews, "\n"), fmt.Errorf("module %s has no verified personal fork receipt", checkout.Directory)
		}
		var repo *workorder.Checkout
		for j := range task.WorkOrderPlan.Repos {
			if task.WorkOrderPlan.Repos[j].Directory == checkout.Directory {
				repo = &task.WorkOrderPlan.Repos[j]
				break
			}
		}
		if repo == nil || checkout.Fork.TargetBranch != upstreamVersionRef(*repo) {
			return strings.Join(reviews, "\n"), fmt.Errorf("fork receipt no longer matches the configured product version")
		}
		dir := filepath.Join(workDir, filepath.FromSlash(checkout.Directory))
		status, err := forkGit(ctx, dir, "status", "--porcelain")
		if err != nil || status != "" {
			return strings.Join(reviews, "\n"), fmt.Errorf("module %s has uncommitted files; commit the intended changes before upstream submission; local work was retained", repo.ModuleKey)
		}
		branch, err := forkGit(ctx, dir, "symbolic-ref", "--short", "HEAD")
		if err != nil || branch != checkout.Branch || branch == checkout.Fork.ProjectBranch || branch == checkout.Fork.TargetBranch {
			return strings.Join(reviews, "\n"), fmt.Errorf("module %s is not on its recorded feature branch", repo.ModuleKey)
		}
		sha, err := forkGit(ctx, dir, "rev-parse", "HEAD")
		if err != nil {
			return strings.Join(reviews, "\n"), err
		}
		if sha == checkout.SHA {
			continue
		}
		client, err := d.workspaceGitLab(ctx, task.WorkspaceID, repo.RepoURL)
		if err != nil {
			return strings.Join(reviews, "\n"), err
		}
		apiCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		identity, err := client.EnsurePersonalFork(apiCtx, repo.RepoURL)
		cancel()
		if err != nil {
			return strings.Join(reviews, "\n"), err
		}
		if identity.Fork.ID != checkout.Fork.Identity.Fork.ID || identity.Upstream.ID != checkout.Fork.Identity.Upstream.ID {
			return strings.Join(reviews, "\n"), fmt.Errorf("workspace GitLab identity changed after preparation; reconcile the existing fork before submitting")
		}
		gitCtx := repocache.WithGitLabCredential(ctx, client.InstanceURL, client.Token, repo.RepoURL, identity.Upstream.HTTPURL)
		if err := configureForkRemotes(gitCtx, dir, repo.RepoURL, *checkout.Fork); err != nil {
			return strings.Join(reviews, "\n"), err
		}
		if _, err := forkGit(gitCtx, dir, "push", "origin", "HEAD:refs/heads/"+branch); err != nil {
			return strings.Join(reviews, "\n"), fmt.Errorf("push module %s feature branch (local work retained): %w", repo.ModuleKey, err)
		}
		title := task.IssueIdentifier
		if title == "" {
			title = task.ID
		}
		mr, err := client.SubmitForkMergeRequest(ctx, identity, branch, checkout.Fork.TargetBranch, sha, title+" "+repo.ModuleKey)
		if err != nil {
			return strings.Join(reviews, "\n"), fmt.Errorf("submit module %s for upstream review (feature branch retained): %w", repo.ModuleKey, err)
		}
		checkout.Fork.ReviewURL, checkout.Fork.SubmittedSHA = mr.WebURL, sha
		reviews = append(reviews, fmt.Sprintf("%s: %s -> %s\n%s", repo.ModuleKey, branch, checkout.Fork.TargetBranch, mr.WebURL))
		if err := writeWorkOrderManifest(workDir, manifest); err != nil {
			return strings.Join(reviews, "\n"), err
		}
	}
	return strings.Join(reviews, "\n"), nil
}
