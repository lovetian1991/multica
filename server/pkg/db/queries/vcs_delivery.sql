-- name: ListVCSDeliveryProjects :many
SELECT * FROM vcs_delivery_project WHERE workspace_id = $1 ORDER BY project_path;

-- name: GetVCSDeliveryProject :one
SELECT * FROM vcs_delivery_project WHERE id = $1 AND workspace_id = $2;

-- name: UpsertVCSDeliveryProject :one
INSERT INTO vcs_delivery_project (workspace_id, connection_id, project_id, project_path, rules)
SELECT $1, c.id, $3, $4, $5 FROM vcs_connection c
WHERE c.id = $2 AND c.workspace_id = $1 AND c.provider = 'gitlab'
ON CONFLICT (workspace_id, connection_id, project_id) DO UPDATE SET
    project_path = EXCLUDED.project_path, rules = EXCLUDED.rules, updated_at = now()
RETURNING *;

-- name: DeleteVCSDeliveryProject :exec
DELETE FROM vcs_delivery_project WHERE id = $1 AND workspace_id = $2;

-- name: RegisterVCSDelivery :one
INSERT INTO vcs_delivery (
    workspace_id, issue_id, project_config_id, connection_id, project_id,
    project_path, rules, sha, ref, deadline_at
)
SELECT p.workspace_id, i.id, p.id, p.connection_id, p.project_id,
    p.project_path, p.rules, sqlc.arg('sha'), sqlc.arg('ref'), sqlc.arg('deadline_at')
FROM vcs_delivery_project p
JOIN issue i ON i.workspace_id = p.workspace_id AND i.id = sqlc.arg('issue_id')
JOIN vcs_connection c ON c.id = p.connection_id AND c.workspace_id = p.workspace_id
WHERE p.id = sqlc.arg('project_config_id') AND p.workspace_id = sqlc.arg('workspace_id')
ON CONFLICT (workspace_id, issue_id, project_config_id, sha, ref) DO UPDATE SET sha = EXCLUDED.sha
RETURNING *;

-- name: ListIssueVCSDeliveries :many
SELECT * FROM vcs_delivery WHERE workspace_id = $1 AND issue_id = $2 ORDER BY created_at DESC LIMIT 50;

-- name: ListDueVCSDeliveries :many
SELECT d.* FROM vcs_delivery d
JOIN issue i ON i.id = d.issue_id AND i.workspace_id = d.workspace_id
JOIN vcs_connection c ON c.id = d.connection_id AND c.workspace_id = d.workspace_id
WHERE d.notified_at IS NULL AND d.next_poll_at <= now()
ORDER BY d.next_poll_at LIMIT 10;

-- name: UpdateVCSDelivery :one
UPDATE vcs_delivery SET pipeline_id = $3, status = $4, result = $5,
    next_poll_at = now() + interval '30 seconds', updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND notified_at IS NULL
RETURNING *;

-- name: MarkVCSDeliveryNotified :one
UPDATE vcs_delivery SET notified_at = now()
WHERE id = $1 AND workspace_id = $2 AND notified_at IS NULL
RETURNING *;

-- name: RetryVCSDelivery :one
UPDATE vcs_delivery SET status = 'pending_pipeline', notified_at = NULL, result = '{}',
    next_poll_at = now(), deadline_at = $4, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND issue_id = $3 AND notified_at IS NOT NULL
RETURNING *;
