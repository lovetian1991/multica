-- name: ListProducts :many
SELECT *
FROM product
ORDER BY created_at DESC, id DESC;

-- name: GetProduct :one
SELECT *
FROM product
WHERE id = $1;

-- name: CreateProduct :one
INSERT INTO product (name, description)
VALUES ($1, $2)
RETURNING *;

-- name: UpdateProduct :one
UPDATE product
SET name = $2,
    description = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteProduct :one
DELETE FROM product
WHERE id = $1
RETURNING id;
