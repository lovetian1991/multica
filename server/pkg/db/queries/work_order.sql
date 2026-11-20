-- name: GetWorkOrderSetting :one
SELECT * FROM work_order_setting WHERE id = true;

-- name: SaveWorkOrderSetting :one
INSERT INTO work_order_setting (id, kb_root_id) VALUES (true, $1)
ON CONFLICT (id) DO UPDATE SET kb_root_id = EXCLUDED.kb_root_id, updated_at = now()
RETURNING *;

-- name: GetProductVersionCode :one
SELECT * FROM product_version_code WHERE version_id = $1;

-- name: SaveProductVersionCode :one
INSERT INTO product_version_code (version_id, config) VALUES ($1, $2)
ON CONFLICT (version_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
RETURNING *;

-- name: GetWorkOrderWorkspace :one
SELECT * FROM work_order_workspace WHERE workspace_id = $1;

-- name: SaveWorkOrderWorkspace :one
INSERT INTO work_order_workspace (workspace_id, execution_project_id, squad_id, mis_url, mis_credentials)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (workspace_id) DO UPDATE SET
execution_project_id = EXCLUDED.execution_project_id, squad_id = EXCLUDED.squad_id,
mis_url = EXCLUDED.mis_url, mis_credentials = EXCLUDED.mis_credentials, updated_at = now()
RETURNING *;

-- name: ListWorkOrders :many
SELECT * FROM work_order
WHERE workspace_id = $1
AND (sqlc.narg('assignee_id')::uuid IS NULL OR assignee_id = sqlc.narg('assignee_id'))
AND (sqlc.arg('search')::text = '' OR title ILIKE '%' || sqlc.arg('search') || '%' OR external_id ILIKE '%' || sqlc.arg('search') || '%')
ORDER BY updated_at DESC, id DESC
LIMIT $2 OFFSET $3;

-- name: CountWorkOrders :one
SELECT count(*) FROM work_order
WHERE workspace_id = $1
AND (sqlc.narg('assignee_id')::uuid IS NULL OR assignee_id = sqlc.narg('assignee_id'))
AND (sqlc.arg('search')::text = '' OR title ILIKE '%' || sqlc.arg('search') || '%' OR external_id ILIKE '%' || sqlc.arg('search') || '%');

-- name: GetWorkOrder :one
SELECT * FROM work_order WHERE id = $1 AND workspace_id = $2;

-- name: GetWorkOrderBySource :one
SELECT * FROM work_order WHERE workspace_id = $1 AND source = $2 AND external_id = $3;

-- name: LockWorkOrder :one
SELECT * FROM work_order WHERE id = $1 AND workspace_id = $2 FOR UPDATE;

-- name: ImportWorkOrder :one
INSERT INTO work_order (
workspace_id, source, external_id, title, description, source_status, source_product,
source_version, source_project, source_branch, assignee_id, product_version_id, created_by, updated_by
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
ON CONFLICT (workspace_id, source, external_id) DO UPDATE SET
title = EXCLUDED.title, description = EXCLUDED.description, source_status = EXCLUDED.source_status,
source_product = EXCLUDED.source_product, source_version = EXCLUDED.source_version,
source_project = EXCLUDED.source_project, source_branch = EXCLUDED.source_branch,
updated_at = now(), updated_by = EXCLUDED.updated_by
RETURNING *;

-- name: UpdateWorkOrder :one
UPDATE work_order SET assignee_id = $3, product_version_id = $4, customer_project_id = $5,
draft = $6, branch_overrides = $7, stage = $8, updated_by = $9, updated_at = now()
WHERE id = $1 AND workspace_id = $2 RETURNING *;

-- name: LinkWorkOrderIssue :one
UPDATE work_order SET issue_id = $3, stage = 'processing', updated_by = $4, execution_plan = $5, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND issue_id IS NULL RETURNING *;

-- name: GetWorkOrderByIssue :one
SELECT * FROM work_order WHERE issue_id = $1 AND workspace_id = $2;

-- name: AddWorkOrderEvent :exec
INSERT INTO work_order_event (work_order_id, workspace_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5);

-- name: ListWorkOrderEvents :many
SELECT * FROM work_order_event WHERE work_order_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 100;

-- name: ListWorkOrderProjectBranches :many
SELECT * FROM work_order_project_branch WHERE project_id = $1;

-- name: SaveWorkOrderProjectBranch :one
INSERT INTO work_order_project_branch (project_id, version_id, module_key, repo_url, ref)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (project_id, version_id, module_key) DO UPDATE SET repo_url = EXCLUDED.repo_url, ref = EXCLUDED.ref
RETURNING *;

-- name: DeleteWorkOrderProjectVersionBranches :exec
DELETE FROM work_order_project_branch WHERE project_id = $1 AND version_id = $2;

-- name: ListCustomerProjects :many
SELECT * FROM customer_project ORDER BY name, id;

-- name: GetCustomerProject :one
SELECT * FROM customer_project WHERE id = $1;

-- name: CreateCustomerProject :one
INSERT INTO customer_project (name, product_id, product_version_id)
VALUES ($1, $2, $3) RETURNING *;

-- name: UpdateCustomerProjectVersion :one
UPDATE customer_project SET product_id = $2, product_version_id = $3, updated_at = now()
WHERE id = $1 RETURNING *;

-- name: RenameCustomerProject :one
UPDATE customer_project SET name = $2, updated_at = now() WHERE id = $1 RETURNING *;

-- name: DeleteUnusedCustomerProject :one
DELETE FROM customer_project
WHERE customer_project.id = $1 AND NOT EXISTS (
    SELECT 1 FROM work_order WHERE customer_project_id = customer_project.id
) RETURNING customer_project.id;

-- name: DeleteCustomerProjectBranches :exec
DELETE FROM work_order_project_branch WHERE project_id = $1;
