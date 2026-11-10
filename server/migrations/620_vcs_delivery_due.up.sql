CREATE INDEX CONCURRENTLY IF NOT EXISTS vcs_delivery_due ON vcs_delivery (next_poll_at) WHERE notified_at IS NULL;
