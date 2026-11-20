package daemon

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/internal/workorder"
	"github.com/multica-ai/multica/server/pkg/redact"
)

// ResolveProductCodePlan reads the same catalog configuration used by task
// claims, without requiring a task or changing the product configuration.
func (c *Client) ResolveProductCodePlan(ctx context.Context, versionID string) (workorder.Plan, error) {
	var catalog struct {
		Products []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Slug string `json:"slug"`
		} `json:"products"`
	}
	if err := c.getJSON(ctx, "/api/products", &catalog); err != nil {
		return workorder.Plan{}, err
	}
	versions := map[string]workorder.Version{}
	for _, product := range catalog.Products {
		var response struct {
			Versions []struct {
				ID      string `json:"id"`
				Name    string `json:"name"`
				Enabled bool   `json:"enabled"`
			} `json:"versions"`
		}
		if err := c.getJSON(ctx, "/api/products/"+product.ID+"/versions", &response); err != nil {
			return workorder.Plan{}, err
		}
		for _, version := range response.Versions {
			if version.Enabled {
				versions[version.ID] = workorder.Version{
					ID: version.ID, ProductID: product.ID, ProductName: product.Name,
					ProductSlug: product.Slug, Name: version.Name,
				}
			}
		}
	}
	return workorder.Resolve(ctx, versionID, "", nil, nil, func(ctx context.Context, id string) (workorder.Version, error) {
		version, ok := versions[id]
		if !ok {
			return version, fmt.Errorf("product version %s is unavailable on %s", id, c.baseURL)
		}
		path := "/api/products/" + version.ProductID + "/versions/" + id + "/code"
		if err := c.getJSON(ctx, path, &version.Config); err != nil {
			return version, fmt.Errorf("read code configuration for %s: %w", id, err)
		}
		return version, nil
	})
}

type productPrepareRequest struct {
	WorkspaceID  string `json:"workspace_id"`
	VersionID    string `json:"version_id"`
	PersonalFork bool   `json:"personal_fork"`
	ProjectName  string `json:"project_name"`
	WorkDir      string `json:"workdir"`
}

type productPrepareEvent struct {
	Stage     string          `json:"stage"`
	ServerURL string          `json:"server_url,omitempty"`
	WorkDir   string          `json:"workdir,omitempty"`
	Directory string          `json:"directory,omitempty"`
	Ref       string          `json:"ref,omitempty"`
	SHA       string          `json:"sha,omitempty"`
	Plan      *workorder.Plan `json:"plan,omitempty"`
	Error     string          `json:"error,omitempty"`
}

func (d *Daemon) productPrepareHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// This operator-only entry point must not borrow a task's credential.
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if d.client.Token() == "" || subtle.ConstantTimeCompare([]byte(token), []byte(d.client.Token())) != 1 {
			http.Error(w, "the daemon profile's login credential is required", http.StatusUnauthorized)
			return
		}
		var req productPrepareRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		for _, id := range []string{req.WorkspaceID, req.VersionID} {
			if _, err := util.ParseUUID(id); err != nil {
				http.Error(w, "workspace_id and version_id must be UUIDs", http.StatusBadRequest)
				return
			}
		}
		d.mu.Lock()
		_, watched := d.workspaces[req.WorkspaceID]
		d.mu.Unlock()
		if !watched {
			http.Error(w, "workspace is not watched by this daemon", http.StatusBadRequest)
			return
		}
		plan, err := d.client.ResolveProductCodePlan(r.Context(), req.VersionID)
		if err != nil {
			http.Error(w, redact.Text(err.Error()), http.StatusBadRequest)
			return
		}
		plan.PersonalFork = req.PersonalFork
		root := filepath.Join(d.cfg.WorkspacesRoot, ".code-checks", req.WorkspaceID)
		if err := os.MkdirAll(root, 0o700); err != nil {
			http.Error(w, redact.Text(err.Error()), http.StatusInternalServerError)
			return
		}
		workDir := req.WorkDir
		if workDir == "" {
			workDir, err = os.MkdirTemp(root, "product-")
		} else {
			var resolvedRoot, resolvedDir string
			resolvedRoot, err = filepath.EvalSymlinks(root)
			if err == nil {
				resolvedDir, err = filepath.EvalSymlinks(workDir)
			}
			if err == nil {
				var rel string
				rel, err = filepath.Rel(resolvedRoot, resolvedDir)
				if err == nil && (!filepath.IsLocal(rel) || rel == ".") {
					err = fmt.Errorf("workdir must be an existing code-check directory inside this workspace")
				}
				workDir = resolvedDir
			}
		}
		if err != nil {
			http.Error(w, redact.Text(err.Error()), http.StatusInternalServerError)
			return
		}
		d.mu.Lock()
		ws := d.workspaces[req.WorkspaceID]
		if ws == nil {
			d.mu.Unlock()
			http.Error(w, "workspace is no longer watched", http.StatusConflict)
			return
		}
		if ws.taskRepoURLs == nil {
			ws.taskRepoURLs = map[string]struct{}{}
		}
		for _, repo := range plan.Repos {
			ws.taskRepoURLs[repo.RepoURL] = struct{}{}
		}
		d.mu.Unlock()
		// Keep the daemon's idle/reload barrier closed throughout preparation.
		d.activeTasks.Add(1)
		defer d.activeTasks.Add(-1)
		w.Header().Set("Content-Type", "application/x-ndjson")
		encoder := json.NewEncoder(w)
		emit := func(event productPrepareEvent) {
			_ = encoder.Encode(event)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		emit(productPrepareEvent{Stage: "plan", ServerURL: d.cfg.ServerBaseURL, WorkDir: workDir, Plan: &plan})
		task := Task{ID: filepath.Base(workDir), WorkspaceID: req.WorkspaceID, ProjectTitle: req.ProjectName, WorkOrderPlan: &plan}
		err = d.prepareWorkOrderReposWithProgress(r.Context(), task, workDir, "Code Verification", func(stage string, repo workorder.Checkout, sha string) {
			emit(productPrepareEvent{Stage: stage, Directory: repo.Directory, Ref: repo.Ref, SHA: sha})
		})
		if err != nil {
			emit(productPrepareEvent{Stage: "failed", WorkDir: workDir, Error: redact.Text(err.Error())})
			return
		}
		emit(productPrepareEvent{Stage: "complete", WorkDir: workDir})
	}
}
