CREATE TABLE work_order_setting (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    kb_root_id text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_version_code (
    version_id uuid PRIMARY KEY,
    config jsonb NOT NULL DEFAULT '{"modules":[],"dependencies":[]}',
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order_workspace (
    workspace_id uuid PRIMARY KEY,
    execution_project_id uuid,
    squad_id uuid,
    mis_url text NOT NULL DEFAULT '',
    mis_credentials text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    source text NOT NULL DEFAULT 'manual',
    external_id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    source_status text NOT NULL DEFAULT '',
    source_product text NOT NULL DEFAULT '',
    source_version text NOT NULL DEFAULT '',
    source_project text NOT NULL DEFAULT '',
    source_branch text NOT NULL DEFAULT '',
    product_version_id uuid,
    customer_project_id uuid,
    assignee_id uuid,
    draft text NOT NULL DEFAULT '',
    branch_overrides jsonb NOT NULL DEFAULT '{}',
    stage text NOT NULL DEFAULT 'pending' CHECK (stage IN ('pending', 'processing', 'review', 'accepted', 'blocked')),
    issue_id uuid,
    execution_plan jsonb,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order_event (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_order_project_branch (
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_id uuid NOT NULL,
    module_key text NOT NULL,
    resource_id uuid NOT NULL,
    PRIMARY KEY (workspace_id, project_id, version_id, module_key)
);
