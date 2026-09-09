-- name: ListProductVersions :many
SELECT *
FROM product_version
WHERE product_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListEnabledProductVersions :many
SELECT *
FROM product_version
WHERE product_id = $1 AND enabled = true
ORDER BY created_at DESC, id DESC;

-- name: GetProductVersion :one
SELECT *
FROM product_version
WHERE id = $1;

-- name: CreateProductVersion :one
INSERT INTO product_version (product_id, name, directory, remark, folder_id, enabled)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateProductVersion :one
UPDATE product_version
SET name = $2,
    directory = $3,
    remark = $4,
    folder_id = $5,
    enabled = $6,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProductVersion :one
DELETE FROM product_version
WHERE id = $1
RETURNING id;
