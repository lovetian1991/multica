package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/spf13/cobra"
)

func init() {
	cmd := &cobra.Command{
		Use:   "prepare-product <version-id>",
		Short: "Prepare configured product and dependency code using the local daemon",
		Long:  "Reads configured product and dependency modules through the running daemon. By default verifies or creates personal GitLab forks and synchronizes project branches there; never creates upstream branches. Does not start agents, build, or deploy. Prints progress as NDJSON.",
		Args:  exactArgs(1),
		RunE:  runRepoPrepareProduct,
	}
	cmd.Flags().Bool("personal-fork", true, "Prepare personal GitLab fork project branches")
	cmd.Flags().String("project-name", "", "Project name used for default project branch names")
	cmd.Flags().String("workdir", "", "Reuse an existing code-check directory in this workspace")
	repoCmd.AddCommand(cmd)
}

func runRepoPrepareProduct(cmd *cobra.Command, args []string) error {
	if inDaemonTaskIdentityContext() {
		return fmt.Errorf("prepare-product is an operator command; run it outside an agent task")
	}
	if _, err := util.ParseUUID(args[0]); err != nil {
		return fmt.Errorf("version-id must be a UUID")
	}
	workspaceID, err := requireWorkspaceID(cmd)
	if err != nil {
		return err
	}
	profile := resolveProfile(cmd)
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err != nil {
		return err
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return fmt.Errorf("sign in to this daemon profile first")
	}
	port := resolveHealthPort(profile)
	healthCtx, healthCancel := cli.APIContext(cmd.Context())
	health := checkDaemonHealthOnPort(healthCtx, port)
	healthCancel()
	if !daemonAlive(health) {
		return fmt.Errorf("start this profile's daemon first")
	}
	if err := daemonIdentityMismatch(health, profile, port); err != nil {
		return err
	}
	serverURL, _ := health["server_url"].(string)
	expectedURL := resolveDaemonServerURL(cmd, profile)
	if strings.TrimRight(serverURL, "/") != strings.TrimRight(expectedURL, "/") {
		return fmt.Errorf("daemon is connected to %q, but this command targets %q; restart this profile's daemon with the intended server before preparing code", serverURL, expectedURL)
	}
	personalFork, _ := cmd.Flags().GetBool("personal-fork")
	projectName, _ := cmd.Flags().GetString("project-name")
	workDir, _ := cmd.Flags().GetString("workdir")
	data, err := json.Marshal(map[string]any{
		"workspace_id": workspaceID, "version_id": args[0],
		"personal_fork": personalFork, "project_name": projectName, "workdir": workDir,
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(cmd.Context(), repoCheckoutTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/repo/prepare-product", port), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return fmt.Errorf("connect to daemon: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		return fmt.Errorf("prepare product code: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	decoder := json.NewDecoder(resp.Body)
	for {
		var event struct {
			Stage string `json:"stage"`
			Error string `json:"error"`
		}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return fmt.Errorf("preparation ended before completion: %w", err)
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return err
		}
		fmt.Fprintln(os.Stdout, string(raw))
		if event.Stage == "failed" {
			return fmt.Errorf("product code preparation failed: %s", event.Error)
		}
		if event.Stage == "complete" {
			return nil
		}
	}
}
