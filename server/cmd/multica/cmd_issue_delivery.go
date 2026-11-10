package main

import (
	"context"
	"net/url"
	"os"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/spf13/cobra"
)

func init() { issueCmd.AddCommand(newIssueDeliveryCommand()) }

func newIssueDeliveryCommand() *cobra.Command {
	root := &cobra.Command{Use: "delivery", Short: "Register and inspect passive GitLab delivery tracking"}
	projects := &cobra.Command{
		Use: "projects", Args: cobra.NoArgs, Short: "List configured GitLab delivery projects in this workspace",
		RunE: func(cmd *cobra.Command, _ []string) error {
			ws, err := requireWorkspaceID(cmd)
			if err != nil {
				return err
			}
			client, err := newAPIClient(cmd)
			if err != nil {
				return err
			}
			ctx, cancel := cli.APIContext(context.Background())
			defer cancel()
			var out map[string]any
			if err := client.GetJSON(ctx, "/api/workspaces/"+url.PathEscape(ws)+"/vcs/delivery-projects", &out); err != nil {
				return err
			}
			return cli.PrintJSON(os.Stdout, out)
		},
	}
	root.AddCommand(projects)
	for _, action := range []string{"list", "register", "resume"} {
		use, count := action+" <issue-id>", 1
		if action == "resume" {
			use, count = use+" <delivery-id>", 2
		}
		c := &cobra.Command{
			Use: use, Args: cobra.ExactArgs(count), Short: action + " issue delivery tracking",
			Long: "Tracking only: never starts a GitLab pipeline, retries a job, deploys, or dispatches an agent. Register only a commit already pushed successfully. Resume is an explicit request to recheck the bound pipeline.",
			RunE: func(cmd *cobra.Command, args []string) error {
				client, err := newAPIClient(cmd)
				if err != nil {
					return err
				}
				ctx, cancel := cli.APIContext(context.Background())
				defer cancel()
				issue, err := resolveIssueRef(ctx, client, args[0])
				if err != nil {
					return err
				}
				path := "/api/issues/" + url.PathEscape(issue.ID) + "/deliveries"
				var out map[string]any
				switch action {
				case "list":
					err = client.GetJSON(ctx, path, &out)
				case "register":
					project, _ := cmd.Flags().GetString("project-config-id")
					sha, _ := cmd.Flags().GetString("sha")
					ref, _ := cmd.Flags().GetString("ref")
					err = client.PostJSON(ctx, path, map[string]string{"project_config_id": project, "sha": sha, "ref": ref}, &out)
				case "resume":
					err = client.PostJSON(ctx, path+"/"+url.PathEscape(args[1])+"/resume", map[string]any{}, &out)
				}
				if err != nil {
					return err
				}
				return cli.PrintJSON(os.Stdout, out)
			},
		}
		if action == "register" {
			c.Flags().String("project-config-id", "", "Configuration UUID from delivery projects (not the numeric GitLab project ID)")
			c.Flags().String("sha", "", "Full commit SHA confirmed pushed to the remote")
			c.Flags().String("ref", "", "Actual remote branch or tag")
			for _, flag := range []string{"project-config-id", "sha", "ref"} {
				_ = c.MarkFlagRequired(flag)
			}
		}
		root.AddCommand(c)
	}
	return root
}
