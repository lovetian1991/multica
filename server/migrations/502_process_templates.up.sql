-- Process templates are a deployment-scoped catalog of versioned zip bundles.
-- A workspace records which version it last applied; later catalog versions
-- become an upgrade, and apply never deletes workspace-local extras.
CREATE TABLE process_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 128),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE process_template_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES process_template(id) ON DELETE CASCADE,
    version INT NOT NULL CHECK (version >= 1),
    checksum TEXT NOT NULL CHECK (char_length(checksum) = 64),
    file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    zip_data BYTEA NOT NULL,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, version)
);

CREATE TABLE workspace_process_template (
    workspace_id UUID NOT NULL,
    template_id UUID NOT NULL REFERENCES process_template(id) ON DELETE CASCADE,
    template_version_id UUID NOT NULL REFERENCES process_template_version(id) ON DELETE CASCADE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by UUID,
    PRIMARY KEY (workspace_id, template_id)
);

CREATE INDEX idx_process_template_version_template_id
    ON process_template_version (template_id, version DESC);

CREATE INDEX idx_workspace_process_template_workspace
    ON workspace_process_template (workspace_id);