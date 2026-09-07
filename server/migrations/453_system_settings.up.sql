CREATE TABLE IF NOT EXISTS system_setting (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE,
    kb_environment_url TEXT NOT NULL DEFAULT '',
    kb_integration_key_encrypted TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
