CREATE INDEX CONCURRENTLY IF NOT EXISTS work_order_assignee ON work_order (workspace_id, assignee_id, updated_at DESC);
