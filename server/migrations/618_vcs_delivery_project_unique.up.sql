CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS vcs_delivery_project_unique ON vcs_delivery_project (workspace_id, connection_id, project_id);
