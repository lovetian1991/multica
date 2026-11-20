package vcs

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type GitLabForkProject struct {
	ID                int64  `json:"id"`
	Path              string `json:"path"`
	PathWithNamespace string `json:"path_with_namespace"`
	HTTPURL           string `json:"http_url_to_repo"`
	ImportStatus      string `json:"import_status"`
	Namespace         struct {
		ID   int64  `json:"id"`
		Path string `json:"full_path"`
		Kind string `json:"kind"`
	} `json:"namespace"`
	ForkedFrom *struct {
		ID int64 `json:"id"`
	} `json:"forked_from_project"`
}

type GitLabPersonalFork struct {
	Upstream GitLabForkProject `json:"upstream"`
	Fork     GitLabForkProject `json:"fork"`
}

// EnsurePersonalFork never treats a same-named copy as a fork.
func (c GitLabDeliveryClient) EnsurePersonalFork(ctx context.Context, remote string) (GitLabPersonalFork, error) {
	var result GitLabPersonalFork
	path, ok := RepositoryProject(remote, c.InstanceURL)
	if !ok {
		return result, errors.New("repository does not belong to the workspace GitLab connection")
	}
	var user struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if err := c.get(ctx, "/user", &user); err != nil {
		return result, fmt.Errorf("read workspace GitLab identity: %w", err)
	}
	if user.ID <= 0 || user.Username == "" {
		return result, errors.New("workspace GitLab identity is missing")
	}
	if err := c.get(ctx, "/projects/"+url.PathEscape(path), &result.Upstream); err != nil {
		return result, fmt.Errorf("read configured upstream %s: %w", path, err)
	}
	if result.Upstream.ID <= 0 || result.Upstream.Path == "" || !strings.EqualFold(result.Upstream.PathWithNamespace, path) {
		return result, errors.New("configured upstream identity does not match GitLab")
	}
	if parsed, ok := RepositoryProject(result.Upstream.HTTPURL, c.InstanceURL); !ok || !strings.EqualFold(parsed, path) {
		return result, errors.New("upstream clone URL does not match the configured product repository")
	}
	if strings.EqualFold(result.Upstream.Namespace.Path, user.Username) {
		return result, errors.New("configured upstream is already in the workspace account; select the standard product repository")
	}
	forkPath := user.Username + "/" + result.Upstream.Path
	endpoint := "/projects/" + url.PathEscape(forkPath)
	err := c.get(ctx, endpoint, &result.Fork)
	if errors.Is(err, ErrGitLabNotFound) {
		err = c.request(ctx, http.MethodPost, fmt.Sprintf("/projects/%d/fork", result.Upstream.ID),
			map[string]any{"namespace": user.Username}, &result.Fork)
		if err != nil {
			return result, fmt.Errorf("create personal fork %s (check fork/project creation permissions): %w", forkPath, err)
		}
	} else if err != nil {
		return result, fmt.Errorf("read personal fork %s: %w", forkPath, err)
	}
	for {
		p := result.Fork
		if p.ID <= 0 || p.ID == result.Upstream.ID || !strings.EqualFold(p.PathWithNamespace, forkPath) ||
			!strings.EqualFold(p.Namespace.Path, user.Username) || p.Namespace.Kind != "user" ||
			p.ForkedFrom == nil || p.ForkedFrom.ID != result.Upstream.ID {
			return result, fmt.Errorf("personal repository %s is not a verified fork of %s; resolve the name collision before retrying", forkPath, path)
		}
		if parsed, ok := RepositoryProject(p.HTTPURL, c.InstanceURL); !ok || !strings.EqualFold(parsed, forkPath) {
			return result, errors.New("personal fork clone URL does not match the workspace GitLab connection")
		}
		switch p.ImportStatus {
		case "", "none", "finished":
			return result, nil
		case "failed":
			return result, fmt.Errorf("personal fork %s import failed in GitLab", forkPath)
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return result, fmt.Errorf("wait for personal fork import: %w", ctx.Err())
		case <-timer.C:
		}
		if err := c.get(ctx, endpoint, &result.Fork); err != nil {
			return result, fmt.Errorf("wait for personal fork import: %w", err)
		}
	}
}

type GitLabForkMergeRequest struct {
	IID             int64  `json:"iid"`
	SourceProjectID int64  `json:"source_project_id"`
	TargetProjectID int64  `json:"target_project_id"`
	SourceBranch    string `json:"source_branch"`
	TargetBranch    string `json:"target_branch"`
	SHA             string `json:"sha"`
	State           string `json:"state"`
	WebURL          string `json:"web_url"`
}

// SubmitForkMergeRequest requests upstream review, never approval or merging.
func (c GitLabDeliveryClient) SubmitForkMergeRequest(ctx context.Context, fork GitLabPersonalFork, source, target, sha, title string) (GitLabForkMergeRequest, error) {
	var result GitLabForkMergeRequest
	if fork.Fork.ID <= 0 || fork.Upstream.ID <= 0 || fork.Fork.ID == fork.Upstream.ID ||
		fork.Fork.ForkedFrom == nil || fork.Fork.ForkedFrom.ID != fork.Upstream.ID ||
		source == "" || target == "" || sha == "" {
		return result, errors.New("verified fork, explicit source, target and commit are required")
	}
	base := "/projects/" + strconv.FormatInt(fork.Fork.ID, 10) + "/merge_requests"
	q := url.Values{"state": {"opened"}, "source_branch": {source}, "per_page": {"100"}}
	var existing []GitLabForkMergeRequest
	if err := c.get(ctx, base+"?"+q.Encode(), &existing); err != nil {
		return result, fmt.Errorf("find upstream review request: %w", err)
	}
	for _, mr := range existing {
		if mr.SourceProjectID == fork.Fork.ID && mr.TargetProjectID == fork.Upstream.ID &&
			mr.SourceBranch == source && mr.TargetBranch == target {
			if result.IID != 0 {
				return result, errors.New("multiple upstream review requests match this feature branch")
			}
			result = mr
		}
	}
	if result.IID == 0 {
		if len(existing) >= 100 {
			return result, errors.New("too many open review requests for this feature branch")
		}
		err := c.request(ctx, http.MethodPost, base, map[string]any{
			"source_branch": source, "target_branch": target, "target_project_id": fork.Upstream.ID,
			"title": title, "remove_source_branch": true,
		}, &result)
		if err != nil {
			return result, fmt.Errorf("submit upstream review request (check merge request permission): %w", err)
		}
	}
	if result.IID <= 0 || result.SourceProjectID != fork.Fork.ID || result.TargetProjectID != fork.Upstream.ID ||
		result.SourceBranch != source || result.TargetBranch != target || result.SHA != sha ||
		result.State != "opened" || c.providerLink(result.WebURL) == "" {
		return result, errors.New("upstream review request does not match the pushed feature commit and configured product branch")
	}
	return result, nil
}
