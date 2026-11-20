-- Global-only projects cannot be represented by the old workspace-owned schema.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM customer_project c WHERE NOT EXISTS (SELECT 1 FROM project p WHERE p.id = c.id)) THEN
        RAISE EXCEPTION 'Global customer projects exist; export and map them to workspace projects before rollback';
    END IF;
END $$;

ALTER TABLE work_order_project_branch ADD COLUMN workspace_id uuid, ADD COLUMN resource_id uuid;

INSERT INTO project_resource (id, project_id, workspace_id, resource_type, resource_ref)
SELECT b.id, b.project_id, p.workspace_id, 'github_repo', jsonb_build_object('url', b.repo_url, 'ref', b.ref)
FROM work_order_project_branch b JOIN project p ON p.id = b.project_id
ON CONFLICT (project_id, resource_type, resource_ref) DO NOTHING;

UPDATE work_order_project_branch b
SET workspace_id = p.workspace_id, resource_id = r.id
FROM project p, project_resource r
WHERE p.id = b.project_id AND r.project_id = p.id AND r.resource_type = 'github_repo'
  AND r.resource_ref = jsonb_build_object('url', b.repo_url, 'ref', b.ref);

UPDATE project p SET product_id = c.product_id, product_version_id = c.product_version_id
FROM customer_project c WHERE p.id = c.id;

ALTER TABLE work_order_project_branch ALTER COLUMN workspace_id SET NOT NULL, ALTER COLUMN resource_id SET NOT NULL;
ALTER TABLE work_order_project_branch DROP CONSTRAINT work_order_project_branch_pkey;
ALTER TABLE work_order_project_branch ADD PRIMARY KEY (workspace_id, project_id, version_id, module_key);
ALTER TABLE work_order_project_branch DROP COLUMN id, DROP COLUMN repo_url, DROP COLUMN ref;
DROP TABLE customer_project;
