CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS vcs_delivery_commit_unique ON vcs_delivery (workspace_id, issue_id, project_config_id, sha, ref);
