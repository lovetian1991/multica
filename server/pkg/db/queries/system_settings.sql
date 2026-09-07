-- name: GetSystemSettings :one
SELECT *
FROM system_setting
WHERE id = TRUE;

-- name: UpsertSystemSettings :one
INSERT INTO system_setting (
    id,
    kb_environment_url,
    kb_integration_key_encrypted
)
VALUES (TRUE, $1, $2)
ON CONFLICT (id) DO UPDATE SET
    kb_environment_url = EXCLUDED.kb_environment_url,
    kb_integration_key_encrypted = EXCLUDED.kb_integration_key_encrypted,
    updated_at = now()
RETURNING *;
