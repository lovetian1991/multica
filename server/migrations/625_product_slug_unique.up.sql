CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS product_slug_unique ON product (lower(slug)) WHERE slug <> '';
