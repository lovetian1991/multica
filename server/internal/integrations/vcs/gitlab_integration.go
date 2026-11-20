package vcs

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

var ErrGitLabNotFound = errors.New("GitLab resource not found")

type DeliveryIntegration struct {
	SourceRef       string `json:"source_ref"`
	SourceSHA       string `json:"source_sha"`
	TargetRef       string `json:"target_ref"`
	MergeRequestURL string `json:"merge_request_url"`
	MergeRequestIID int64  `json:"merge_request_iid"`
	MergeSHA        string `json:"merge_sha"`
	State           string `json:"state"`
	Reason          string `json:"reason"`
	SourceCleanup   string `json:"source_cleanup"`
}

type integrationMR struct {
	IID             int64  `json:"iid"`
	SourceProjectID int64  `json:"source_project_id"`
	TargetProjectID int64  `json:"target_project_id"`
	SourceBranch    string `json:"source_branch"`
	TargetBranch    string `json:"target_branch"`
	SHA             string `json:"sha"`
	State           string `json:"state"`
	WebURL          string `json:"web_url"`
	MergeCommitSHA  string `json:"merge_commit_sha"`
	SquashCommitSHA string `json:"squash_commit_sha"`
}

type integrationBranch struct {
	Name      string `json:"name"`
	Protected bool   `json:"protected"`
	Default   bool   `json:"default"`
	Commit    struct {
		ID string `json:"id"`
	} `json:"commit"`
}

// MergeDelivery never schedules an unchecked auto-merge or deletes a branch
// directly. GitLab applies the reviewed-head guard and source cleanup together.
func (c GitLabDeliveryClient) MergeDelivery(ctx context.Context, projectID int64, plan DeliveryIntegration, title string) (DeliveryIntegration, error) {
	plan.State, plan.SourceCleanup = "blocked", "retained"
	if plan.SourceRef == "" || plan.TargetRef == "" || plan.SourceRef == plan.TargetRef || plan.SourceSHA == "" {
		return plan, errors.New("a distinct feature branch and configured target branch are required")
	}
	base := fmt.Sprintf("/projects/%d", projectID)
	matches := func(m integrationMR) bool {
		return m.SourceProjectID == projectID && m.TargetProjectID == projectID &&
			m.SourceBranch == plan.SourceRef && m.TargetBranch == plan.TargetRef &&
			strings.EqualFold(m.SHA, plan.SourceSHA)
	}
	query := url.Values{"scope": {"all"}, "state": {"all"}, "source_branch": {plan.SourceRef},
		"target_branch": {plan.TargetRef}, "per_page": {"100"}, "order_by": {"updated_at"}, "sort": {"desc"}}
	var requests []integrationMR
	if err := c.get(ctx, base+"/merge_requests?"+query.Encode(), &requests); err != nil {
		return plan, err
	}
	var mr integrationMR
	for _, candidate := range requests {
		if matches(candidate) && (candidate.State == "opened" || candidate.State == "merged") {
			mr = candidate
			break
		}
	}
	if mr.IID == 0 && len(requests) >= 100 {
		return plan, errors.New("too many merge requests to identify this delivery safely")
	}
	if mr.State != "merged" {
		var source, target integrationBranch
		if err := c.get(ctx, base+"/repository/branches/"+url.PathEscape(plan.SourceRef), &source); err != nil {
			return plan, err
		}
		if source.Name != plan.SourceRef || !strings.EqualFold(source.Commit.ID, plan.SourceSHA) {
			return plan, errors.New("feature branch changed since verification; register and review its latest commit")
		}
		if source.Protected || source.Default {
			return plan, errors.New("default or protected branches cannot be used as disposable feature branches")
		}
		if err := c.get(ctx, base+"/repository/branches/"+url.PathEscape(plan.TargetRef), &target); err != nil {
			return plan, err
		}
		if target.Name != plan.TargetRef || target.Commit.ID == "" {
			return plan, errors.New("configured integration target is not an existing branch")
		}
		if mr.IID == 0 {
			if err := c.request(ctx, http.MethodPost, base+"/merge_requests", map[string]any{
				"source_branch": plan.SourceRef, "target_branch": plan.TargetRef, "title": title,
				"remove_source_branch": true,
				"description":          "Verified Multica delivery. Merge into the configured version branch and run integration CI there. Business acceptance remains separate.",
			}, &mr); err != nil {
				return plan, err
			}
		}
		if !matches(mr) || mr.IID <= 0 {
			return plan, errors.New("merge request does not match the registered delivery")
		}
		plan.MergeRequestIID, plan.MergeRequestURL = mr.IID, c.providerLink(mr.WebURL)
		if err := c.request(ctx, http.MethodPut, fmt.Sprintf("%s/merge_requests/%d/merge", base, mr.IID),
			map[string]any{"sha": plan.SourceSHA, "should_remove_source_branch": true}, &mr); err != nil {
			plan.Reason = "Merge not completed. Check conflicts, reviews, permissions and required checks in the merge request. " + err.Error()
			return plan, nil
		}
	}
	if !matches(mr) || mr.State != "merged" || mr.IID <= 0 {
		plan.Reason = "GitLab has not confirmed this delivery as merged; the feature branch is retained."
		return plan, nil
	}
	plan.State, plan.MergeRequestIID, plan.MergeRequestURL = "merged", mr.IID, c.providerLink(mr.WebURL)
	plan.MergeSHA = mr.MergeCommitSHA
	if plan.MergeSHA == "" {
		plan.MergeSHA = mr.SquashCommitSHA
	}
	if plan.MergeSHA == "" {
		plan.MergeSHA = mr.SHA
	}
	plan.SourceCleanup = "requested"
	var remaining integrationBranch
	err := c.get(ctx, base+"/repository/branches/"+url.PathEscape(plan.SourceRef), &remaining)
	if errors.Is(err, ErrGitLabNotFound) {
		plan.SourceCleanup = "deleted"
	} else if err == nil && (!strings.EqualFold(remaining.Commit.ID, plan.SourceSHA) || remaining.Protected || remaining.Default) {
		plan.SourceCleanup = "retained"
	}
	return plan, nil
}
