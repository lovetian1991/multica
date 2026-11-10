package vcs

import (
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
	if r.DeploymentJob == "" || len(r.DeploymentJob) > 200 {
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
	if len(r.AllowedHosts) == 0 || len(r.AllowedHosts) > 20 {
		return errors.New("allowed_hosts must contain 1 to 20 exact hostnames")
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
	PipelineID     int64  `json:"pipeline_id"`
	PipelineStatus string `json:"pipeline_status"`
	PipelineURL    string `json:"pipeline_url"`
	JobID          int64  `json:"job_id"`
	JobStatus      string `json:"job_status"`
	JobURL         string `json:"job_url"`
	DeploymentURL  string `json:"deployment_url"`
	URLSource      string `json:"url_source"`
	Reason         string `json:"reason"`
}

func DeliveryTerminal(status string) bool {
	switch status {
	case "deployed", "failed", "canceled", "skipped", "address_missing", "ambiguous", "timed_out", "blocked":
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, NormalizeInstanceURL(c.InstanceURL)+"/api/v4"+path, nil)
	if err != nil {
		return errors.New("invalid GitLab endpoint")
	}
	req.Header.Set("PRIVATE-TOKEN", c.Token)
	req.Header.Set("Accept", "application/json")
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
	if resp.StatusCode != http.StatusOK {
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

type deliveryPipeline struct {
	ID     int64  `json:"id"`
	SHA    string `json:"sha"`
	Ref    string `json:"ref"`
	Source string `json:"source"`
	Status string `json:"status"`
	WebURL string `json:"web_url"`
}

type deliveryJob struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	WebURL       string `json:"web_url"`
	AllowFailure bool   `json:"allow_failure"`
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
	var jobs []deliveryJob
	for page := 1; ; page++ {
		var batch []deliveryJob
		if err := c.get(ctx, fmt.Sprintf("%s/pipelines/%d/jobs?include_retried=false&per_page=100&page=%d", base, pipelineID, page), &batch); err != nil {
			return "", result, err
		}
		jobs = append(jobs, batch...)
		if len(batch) < 100 {
			break
		}
		if page >= 20 {
			return "", result, errors.New("GitLab jobs exceed pagination limit")
		}
	}
	var deploy []deliveryJob
	for _, j := range jobs {
		if j.Name == rules.DeploymentJob {
			deploy = append(deploy, j)
		}
		if j.Status == "failed" && !j.AllowFailure && result.JobID == 0 {
			result.JobID, result.JobStatus, result.JobURL = j.ID, j.Status, c.providerLink(j.WebURL)
		}
	}
	if p.Status == "failed" || p.Status == "canceled" || p.Status == "skipped" {
		return p.Status, result, nil
	}
	if len(deploy) > 1 {
		result.Reason = "Deployment job name is not unique in this pipeline."
		return "ambiguous", result, nil
	}
	if len(deploy) == 0 {
		if p.Status == "success" {
			result.Reason = "Configured deployment job was not found. Downstream pipelines require a separate integration."
			return "blocked", result, nil
		}
		if p.Status == "manual" {
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
	if p.Status != "success" {
		if p.Status == "manual" {
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
		allowed := false
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
