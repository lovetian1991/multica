package vcs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DeliveryRules are snapshotted at registration so later settings changes
// cannot silently change which deployment an existing delivery represents.
type DeliveryRules struct {
	AutoDiscover   bool     `json:"auto_discover,omitempty"`
	DeploymentJob  string   `json:"deployment_job"`
	PipelineSource string   `json:"pipeline_source"`
	URLPrefix      string   `json:"url_prefix"`
	AllowedHosts   []string `json:"allowed_hosts"`
	TimeoutMinutes int      `json:"timeout_minutes"`
}

func (r *DeliveryRules) Validate() error {
	r.DeploymentJob = strings.TrimSpace(r.DeploymentJob)
	if r.PipelineSource == "" {
		r.PipelineSource = "push"
	}
	if r.URLPrefix == "" {
		r.URLPrefix = "MULTICA_DEPLOY_URL="
	}
	if r.TimeoutMinutes == 0 {
		r.TimeoutMinutes = 120
	}
	if (!r.AutoDiscover && r.DeploymentJob == "") || len(r.DeploymentJob) > 200 {
		return errors.New("deployment_job is required (maximum 200 characters)")
	}
	switch r.PipelineSource {
	case "push", "web", "api", "merge_request_event", "schedule":
	default:
		return errors.New("unsupported pipeline_source")
	}
	if len(r.URLPrefix) > 100 || strings.ContainsAny(r.URLPrefix, "\r\n") {
		return errors.New("url_prefix must be a single line (maximum 100 characters)")
	}
	if r.TimeoutMinutes < 5 || r.TimeoutMinutes > 1440 {
		return errors.New("timeout_minutes must be between 5 and 1440")
	}
	if len(r.AllowedHosts) > 20 {
		return errors.New("allowed_hosts must contain at most 20 exact hostnames")
	}
	if r.AllowedHosts == nil {
		r.AllowedHosts = []string{}
	}
	for i, host := range r.AllowedHosts {
		host = strings.ToLower(strings.TrimSpace(host))
		u, err := url.Parse("https://" + host)
		if err != nil || !deliveryHost.MatchString(host) || u.Hostname() != host || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return errors.New("allowed_hosts must be exact hostnames without scheme, port or path")
		}
		r.AllowedHosts[i] = host
	}
	return nil
}

type DeliveryResult struct {
	Integration         *DeliveryIntegration     `json:"integration,omitempty"`
	PipelineID          int64                    `json:"pipeline_id"`
	PipelineStatus      string                   `json:"pipeline_status"`
	PipelineURL         string                   `json:"pipeline_url"`
	JobID               int64                    `json:"job_id"`
	JobStatus           string                   `json:"job_status"`
	JobURL              string                   `json:"job_url"`
	DeploymentURL       string                   `json:"deployment_url"`
	URLSource           string                   `json:"url_source"`
	Reason              string                   `json:"reason"`
	DownstreamPipelines []DeliveryPipelineResult `json:"downstream_pipelines,omitempty"`
}

type DeliveryPipelineResult struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
	URL    string `json:"url"`
}

func DeliveryTerminal(status string) bool {
	switch status {
	case "ci_passed", "deployed", "failed", "canceled", "skipped", "address_missing", "ambiguous", "timed_out", "blocked":
		return true
	}
	return false
}

type GitLabDeliveryClient struct {
	InstanceURL string
	Token       string
	HTTP        *http.Client
}

// Do not follow redirects: Go's default redirect policy can forward a custom
// PRIVATE-TOKEN header to a different host.
func (c GitLabDeliveryClient) get(ctx context.Context, path string, out any) error {
	return c.request(ctx, http.MethodGet, path, nil, out)
}

func (c GitLabDeliveryClient) request(ctx context.Context, method, path string, body any, out any) error {
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			return errors.New("invalid GitLab request")
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, NormalizeInstanceURL(c.InstanceURL)+"/api/v4"+path, bytes.NewReader(payload))
	if err != nil {
		return errors.New("invalid GitLab endpoint")
	}
	req.Header.Set("PRIVATE-TOKEN", c.Token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	if c.HTTP != nil {
		*client = *c.HTTP
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("GitLab request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return ErrUnauthorized
	}
	if resp.StatusCode == http.StatusNotFound {
		return ErrGitLabNotFound
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("GitLab returned HTTP %d", resp.StatusCode)
	}
	const maxBody = 4 << 20
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return errors.New("GitLab response could not be read")
	}
	if len(b) > maxBody {
		return errors.New("GitLab response exceeds 4 MiB limit")
	}
	if text, ok := out.(*string); ok {
		*text = string(b)
		return nil
	}
	if json.Unmarshal(b, out) != nil {
		return errors.New("invalid GitLab response")
	}
	return nil
}

func (c GitLabDeliveryClient) Project(ctx context.Context, id int64) (string, error) {
	var p struct {
		ID   int64  `json:"id"`
		Path string `json:"path_with_namespace"`
	}
	err := c.get(ctx, "/projects/"+strconv.FormatInt(id, 10), &p)
	if err != nil {
		return "", err
	}
	if p.ID != id || p.Path == "" {
		return "", errors.New("GitLab project identity missing")
	}
	return p.Path, nil
}

func (c GitLabDeliveryClient) ResolveProject(ctx context.Context, path string) (int64, string, error) {
	var p struct {
		ID   int64  `json:"id"`
		Path string `json:"path_with_namespace"`
	}
	if err := c.get(ctx, "/projects/"+url.PathEscape(path), &p); err != nil {
		return 0, "", err
	}
	if p.ID <= 0 || !strings.EqualFold(p.Path, path) {
		return 0, "", errors.New("GitLab project identity does not match the repository")
	}
	return p.ID, p.Path, nil
}

// RepositoryProject matches a remote to a trusted connection, never to an
// endpoint supplied by the caller. SSH ports are independent of API ports.
func RepositoryProject(remote, instance string) (string, bool) {
	base, err := url.Parse(NormalizeInstanceURL(instance))
	if err != nil || base.Hostname() == "" {
		return "", false
	}
	if !strings.Contains(remote, "://") {
		parts := strings.SplitN(remote, ":", 2)
		if len(parts) != 2 {
			return "", false
		}
		remote = "ssh://" + parts[0] + "/" + parts[1]
	}
	u, err := url.Parse(remote)
	if err != nil || !strings.EqualFold(u.Hostname(), base.Hostname()) || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	path := u.Path
	switch u.Scheme {
	case "http", "https":
		if u.User != nil || !strings.EqualFold(u.Host, base.Host) {
			return "", false
		}
		prefix := strings.TrimRight(base.Path, "/") + "/"
		if !strings.HasPrefix(path, prefix) {
			return "", false
		}
		path = strings.TrimPrefix(path, prefix)
	case "ssh":
		if u.User != nil {
			if _, password := u.User.Password(); password {
				return "", false
			}
		}
		path = strings.TrimPrefix(path, "/")
	default:
		return "", false
	}
	path = strings.TrimSuffix(path, ".git")
	segments := strings.Split(path, "/")
	if len(segments) < 2 {
		return "", false
	}
	for _, s := range segments {
		if s == "" || s == "." || s == ".." || strings.ContainsAny(s, "\\ \t\r\n?#") {
			return "", false
		}
	}
	return path, true
}

type deliveryPipeline struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	SHA       string `json:"sha"`
	Ref       string `json:"ref"`
	Source    string `json:"source"`
	Status    string `json:"status"`
	WebURL    string `json:"web_url"`
}

type deliveryBridge struct {
	deliveryJob
	Downstream *deliveryPipeline `json:"downstream_pipeline"`
}

// pipelineTree follows only GitLab-reported same-project child links, never a
// caller-supplied pipeline URL or an unrelated pipeline on the same branch.
func (c GitLabDeliveryClient) pipelineTree(ctx context.Context, base string, projectID int64, root deliveryPipeline, result *DeliveryResult) ([]deliveryJob, string, error) {
	type entry struct {
		pipeline deliveryPipeline
		name     string
	}
	queue := []entry{{pipeline: root}}
	seen := map[int64]bool{root.ID: true}
	var jobs []deliveryJob
	aggregate := "success"
	rank := map[string]int{"success": 0, "running": 1, "manual": 2, "skipped": 3, "canceled": 4, "failed": 5}
	merge := func(status string) {
		if _, known := rank[status]; !known {
			status = "running"
		}
		if rank[status] > rank[aggregate] {
			aggregate = status
		}
	}
	for i := 0; i < len(queue); i++ {
		p := queue[i].pipeline
		if i > 0 {
			if err := c.get(ctx, fmt.Sprintf("%s/pipelines/%d", base, p.ID), &p); err != nil {
				return nil, "", err
			}
			if p.ID != queue[i].pipeline.ID || p.SHA != root.SHA || p.Ref != root.Ref || p.Source != "parent_pipeline" || (p.ProjectID != 0 && p.ProjectID != projectID) {
				result.Reason = "Child pipeline identity does not match the registered commit and ref."
				return nil, "blocked", nil
			}
			result.DownstreamPipelines = append(result.DownstreamPipelines, DeliveryPipelineResult{
				ID: p.ID, Name: queue[i].name, Status: p.Status, URL: c.providerLink(p.WebURL),
			})
		}
		merge(p.Status)
		for page := 1; ; page++ {
			var batch []deliveryJob
			if err := c.get(ctx, fmt.Sprintf("%s/pipelines/%d/jobs?include_retried=false&per_page=100&page=%d", base, p.ID, page), &batch); err != nil {
				return nil, "", err
			}
			jobs = append(jobs, batch...)
			if len(batch) < 100 {
				break
			}
			if page >= 20 {
				return nil, "", errors.New("GitLab jobs exceed pagination limit")
			}
		}
		for page := 1; ; page++ {
			var bridges []deliveryBridge
			if err := c.get(ctx, fmt.Sprintf("%s/pipelines/%d/bridges?per_page=100&page=%d", base, p.ID, page), &bridges); err != nil {
				return nil, "", err
			}
			for _, bridge := range bridges {
				if bridge.Status != "skipped" {
					merge(bridge.Status)
				}
				if bridge.Status == "failed" && result.JobID == 0 {
					result.JobID, result.JobStatus, result.JobURL = bridge.ID, bridge.Status, c.providerLink(bridge.WebURL)
				}
				if bridge.Downstream == nil {
					if bridge.Status == "success" {
						result.Reason = "Trigger succeeded but its downstream pipeline is unavailable."
						return nil, "blocked", nil
					}
					continue
				}
				child := *bridge.Downstream
				if child.ID <= 0 || (child.ProjectID != 0 && child.ProjectID != projectID) {
					result.Reason = "Cross-project downstream pipelines require their own delivery registration."
					return nil, "blocked", nil
				}
				if seen[child.ID] || len(queue) >= 32 {
					result.Reason = "Child pipeline traversal contains a duplicate or exceeds the 32-pipeline limit."
					return nil, "blocked", nil
				}
				seen[child.ID] = true
				queue = append(queue, entry{pipeline: child, name: bridge.Name})
			}
			if len(bridges) < 100 {
				break
			}
			if page >= 20 {
				return nil, "", errors.New("GitLab bridges exceed pagination limit")
			}
		}
	}
	return jobs, aggregate, nil
}

type deliveryJob struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	WebURL       string `json:"web_url"`
	AllowFailure bool   `json:"allow_failure"`
	Stage        string `json:"stage"`
}

func (c GitLabDeliveryClient) Check(ctx context.Context, projectID int64, sha, ref string, pipelineID int64, rules DeliveryRules) (string, DeliveryResult, error) {
	result := DeliveryResult{PipelineID: pipelineID}
	base := "/projects/" + strconv.FormatInt(projectID, 10)
	if pipelineID == 0 {
		q := url.Values{"sha": {sha}, "ref": {ref}, "source": {rules.PipelineSource}, "per_page": {"100"}}
		var pipelines []deliveryPipeline
		if err := c.get(ctx, base+"/pipelines?"+q.Encode(), &pipelines); err != nil {
			return "", result, err
		}
		var matches []deliveryPipeline
		for _, p := range pipelines {
			if p.ID > 0 && p.SHA == sha && p.Ref == ref && p.Source == rules.PipelineSource {
				matches = append(matches, p)
			}
		}
		if len(matches) == 0 {
			return "pending_pipeline", result, nil
		}
		if len(matches) != 1 || len(pipelines) >= 100 {
			result.Reason = "Multiple matching pipelines; register a unique commit or use a narrower pipeline source."
			return "ambiguous", result, nil
		}
		pipelineID = matches[0].ID
		result.PipelineID = pipelineID
	}
	var p deliveryPipeline
	if err := c.get(ctx, base+"/pipelines/"+strconv.FormatInt(pipelineID, 10), &p); err != nil {
		return "", result, err
	}
	if p.ID != pipelineID || p.SHA != sha || p.Ref != ref || p.Source != rules.PipelineSource {
		result.Reason = "Pipeline identity does not match the registered commit, ref and source."
		return "blocked", result, nil
	}
	result.PipelineURL = c.providerLink(p.WebURL)
	result.PipelineStatus = p.Status
	jobs, treeStatus, err := c.pipelineTree(ctx, base, projectID, p, &result)
	if err != nil {
		return "", result, err
	}
	if treeStatus == "blocked" {
		return treeStatus, result, nil
	}
	var deploy []deliveryJob
	failedJob := false
	for _, j := range jobs {
		if (rules.DeploymentJob != "" && j.Name == rules.DeploymentJob) ||
			(rules.AutoDiscover && rules.DeploymentJob == "" && deliveryDeployStage.MatchString(j.Stage)) {
			deploy = append(deploy, j)
		}
		if j.Status == "failed" && !j.AllowFailure && !failedJob {
			result.JobID, result.JobStatus, result.JobURL = j.ID, j.Status, c.providerLink(j.WebURL)
			failedJob = true
			treeStatus = "failed"
		}
	}
	if treeStatus == "failed" || treeStatus == "canceled" || treeStatus == "skipped" {
		if len(result.DownstreamPipelines) > 0 {
			result.Reason = "CI includes child pipelines; parent pipeline success alone does not confirm delivery."
		}
		return treeStatus, result, nil
	}
	if len(deploy) > 1 {
		result.Reason = "Deployment job name is not unique in this pipeline."
		return "ambiguous", result, nil
	}
	if len(deploy) == 0 {
		if treeStatus == "success" {
			if rules.AutoDiscover && rules.DeploymentJob == "" {
				result.Reason = "CI passed; no deployment-stage job was found. Set a deployment job in workspace defaults if this pipeline deploys."
				return "ci_passed", result, nil
			}
			result.Reason = "Configured deployment job was not found in the pipeline or its child pipelines."
			return "blocked", result, nil
		}
		if treeStatus == "manual" {
			return "manual", result, nil
		}
		return "running", result, nil
	}
	job := deploy[0]
	result.JobID, result.JobStatus, result.JobURL = job.ID, job.Status, c.providerLink(job.WebURL)
	switch job.Status {
	case "manual":
		return "manual", result, nil
	case "failed", "canceled", "skipped":
		return job.Status, result, nil
	case "success":
	default:
		return "running", result, nil
	}
	if treeStatus != "success" {
		if treeStatus == "manual" {
			return "manual", result, nil
		}
		return "running", result, nil
	}
	var trace string
	if err := c.get(ctx, fmt.Sprintf("%s/jobs/%d/trace", base, job.ID), &trace); err != nil {
		return "", result, err
	}
	deployURL, err := ExtractDeploymentURL(trace, rules)
	if err != nil {
		result.Reason = err.Error()
		return "address_missing", result, nil
	}
	result.DeploymentURL, result.URLSource = deployURL, "job_trace"
	return "deployed", result, nil
}

func (c GitLabDeliveryClient) providerLink(raw string) string {
	u, err := url.Parse(raw)
	base, baseErr := url.Parse(c.InstanceURL)
	if err != nil || baseErr != nil || u.Scheme != base.Scheme || !strings.EqualFold(u.Host, base.Host) || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return ""
	}
	return u.String()
}

var deliveryANSI = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)
var deliveryHost = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`)
var deliveryDeployStage = regexp.MustCompile(`(?i)(^|[-_])deploy(ment)?($|[-_])`)

func ExtractDeploymentURL(trace string, rules DeliveryRules) (string, error) {
	found := ""
	for _, line := range strings.Split(deliveryANSI.ReplaceAllString(trace, ""), "\n") {
		line = strings.TrimSpace(line)
		// Only a standalone marker is evidence; shell commands containing it
		// (for example "$ echo MULTICA_DEPLOY_URL=...") are not results.
		if !strings.HasPrefix(line, rules.URLPrefix) {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, rules.URLPrefix))
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(raw, " \t\r\n") {
			return "", errors.New("Deployment URL is invalid or contains credentials/query/fragment.")
		}
		allowed := len(rules.AllowedHosts) == 0
		for _, host := range rules.AllowedHosts {
			if strings.EqualFold(u.Hostname(), host) {
				allowed = true
			}
		}
		if !allowed {
			return "", errors.New("Deployment URL host is not allowed.")
		}
		if found != "" && found != u.String() {
			return "", errors.New("Conflicting deployment URLs in job output.")
		}
		found = u.String()
	}
	if found == "" {
		return "", errors.New("Deployment job succeeded but no deployment URL marker was found.")
	}
	return found, nil
}
