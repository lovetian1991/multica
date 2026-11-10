CREATE TABLE IF NOT EXISTS vcs_delivery_project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    project_id BIGINT NOT NULL,
    project_path TEXT NOT NULL,
    rules JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vcs_delivery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    issue_id UUID NOT NULL,
    project_config_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    project_id BIGINT NOT NULL,
    project_path TEXT NOT NULL,
    rules JSONB NOT NULL,
    sha TEXT NOT NULL,
    ref TEXT NOT NULL,
    pipeline_id BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending_pipeline',
    result JSONB NOT NULL DEFAULT '{}',
    next_poll_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deadline_at TIMESTAMPTZ NOT NULL,
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
