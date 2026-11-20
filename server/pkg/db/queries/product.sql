-- name: ListProducts :many
SELECT *
FROM product
ORDER BY created_at DESC, id DESC;

-- name: GetProduct :one
SELECT *
FROM product
WHERE id = $1;

-- name: CreateProduct :one
INSERT INTO product (name, description, slug)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateProduct :one
UPDATE product
SET name = $2,
    description = $3,
    slug = COALESCE(sqlc.narg(slug)::text, slug),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProduct :one
WITH deleted_code AS (
    DELETE FROM product_version_code
    WHERE version_id IN (SELECT product_version.id FROM product_version WHERE product_id = $1)
), deleted_branches AS (
    DELETE FROM work_order_project_branch
    WHERE version_id IN (SELECT product_version.id FROM product_version WHERE product_id = $1)
)
DELETE FROM product
WHERE product.id = $1
RETURNING product.id;
