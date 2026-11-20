CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS work_order_source_unique ON work_order (workspace_id, source, external_id);
