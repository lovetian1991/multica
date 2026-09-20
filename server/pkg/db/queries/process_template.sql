-- name: ListProcessTemplates :many
SELECT
    t.id,
    t.slug,
    t.name,
    t.description,
    t.created_by,
    t.created_at,
    t.updated_at,
    v.id AS latest_version_id,
    v.version AS latest_version,
    v.checksum AS latest_checksum,
    v.file_name AS latest_file_name,
    v.file_size AS latest_file_size,
    v.manifest AS latest_manifest,
    v.created_at AS latest_created_at
FROM process_template t
LEFT JOIN LATERAL (
    SELECT id, version, checksum, file_name, file_size, manifest, created_at
    FROM process_template_version
    WHERE template_id = t.id
    ORDER BY version DESC
    LIMIT 1
) v ON true
ORDER BY t.updated_at DESC, t.id DESC;

-- name: GetProcessTemplate :one
SELECT *
FROM process_template
WHERE id = $1;

-- name: GetProcessTemplateBySlug :one
SELECT *
FROM process_template
WHERE slug = $1;

-- name: CreateProcessTemplate :one
INSERT INTO process_template (slug, name, description, created_by)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateProcessTemplate :one
UPDATE process_template
SET slug = $2,
    name = $3,
    description = $4,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProcessTemplate :one
DELETE FROM process_template
WHERE id = $1
RETURNING id;

-- name: ListProcessTemplateVersions :many
SELECT
    id,
    template_id,
    version,
    checksum,
    file_name,
    file_size,
    manifest,
    created_by,
    created_at
FROM process_template_version
WHERE template_id = $1
ORDER BY version DESC;

-- name: GetProcessTemplateVersion :one
SELECT
    id,
    template_id,
    version,
    checksum,
    file_name,
    file_size,
    manifest,
    created_by,
    created_at
FROM process_template_version
WHERE id = $1;

-- name: GetProcessTemplateVersionInTemplate :one
SELECT
    id,
    template_id,
    version,
    checksum,
    file_name,
    file_size,
    manifest,
    created_by,
    created_at
FROM process_template_version
WHERE id = $1 AND template_id = $2;

-- name: GetLatestProcessTemplateVersion :one
SELECT
    id,
    template_id,
    version,
    checksum,
    file_name,
    file_size,
    manifest,
    created_by,
    created_at
FROM process_template_version
WHERE template_id = $1
ORDER BY version DESC
LIMIT 1;

-- name: GetProcessTemplateVersionZip :one
SELECT zip_data
FROM process_template_version
WHERE id = $1;

-- name: CreateProcessTemplateVersion :one
INSERT INTO process_template_version (
    template_id, version, checksum, file_name, file_size, zip_data, manifest, created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING
    id,
    template_id,
    version,
    checksum,
    file_name,
    file_size,
    manifest,
    created_by,
    created_at;

-- name: ListWorkspaceProcessTemplates :many
SELECT
    t.id,
    t.slug,
    t.name,
    t.description,
    t.created_at,
    t.updated_at,
    v.id AS latest_version_id,
    v.version AS latest_version,
    v.checksum AS latest_checksum,
    v.file_name AS latest_file_name,
    v.file_size AS latest_file_size,
    v.manifest AS latest_manifest,
    wpt.template_version_id AS installed_version_id,
    iv.version AS installed_version,
    wpt.applied_at,
    wpt.applied_by
FROM process_template t
LEFT JOIN LATERAL (
    SELECT id, version, checksum, file_name, file_size, manifest
    FROM process_template_version
    WHERE template_id = t.id
    ORDER BY version DESC
    LIMIT 1
) v ON true
LEFT JOIN workspace_process_template wpt
    ON wpt.template_id = t.id AND wpt.workspace_id = $1
LEFT JOIN process_template_version iv
    ON iv.id = wpt.template_version_id
ORDER BY t.name ASC, t.id ASC;

-- name: GetWorkspaceProcessTemplate :one
SELECT *
FROM workspace_process_template
WHERE workspace_id = $1 AND template_id = $2;

-- name: UpsertWorkspaceProcessTemplate :one
INSERT INTO workspace_process_template (
    workspace_id, template_id, template_version_id, applied_at, applied_by
) VALUES ($1, $2, $3, now(), $4)
ON CONFLICT (workspace_id, template_id) DO UPDATE SET
    template_version_id = EXCLUDED.template_version_id,
    applied_at = now(),
    applied_by = EXCLUDED.applied_by
RETURNING *;

-- name: TouchProcessTemplate :exec
UPDATE process_template
SET updated_at = now()
WHERE id = $1;
