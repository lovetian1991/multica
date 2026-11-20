CREATE TABLE customer_project (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    product_id uuid,
    product_version_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO customer_project (id, name, product_id, product_version_id, created_at, updated_at)
SELECT p.id, p.title, p.product_id, p.product_version_id, p.created_at, p.updated_at
FROM project p
WHERE EXISTS (SELECT 1 FROM work_order o WHERE o.customer_project_id = p.id)
   OR EXISTS (SELECT 1 FROM work_order_project_branch b WHERE b.project_id = p.id)
   OR (p.product_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM work_order_workspace w WHERE w.execution_project_id = p.id
   ));

ALTER TABLE work_order_project_branch
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN repo_url text NOT NULL DEFAULT '',
    ADD COLUMN ref text NOT NULL DEFAULT '';

UPDATE work_order_project_branch b
SET repo_url = COALESCE(r.resource_ref->>'url', ''),
    ref = COALESCE(r.resource_ref->>'ref', '')
FROM project_resource r
WHERE r.id = b.resource_id AND r.project_id = b.project_id AND r.workspace_id = b.workspace_id;

ALTER TABLE work_order_project_branch DROP CONSTRAINT work_order_project_branch_pkey;
ALTER TABLE work_order_project_branch DROP COLUMN workspace_id, DROP COLUMN resource_id;
ALTER TABLE work_order_project_branch ADD PRIMARY KEY (project_id, version_id, module_key);
