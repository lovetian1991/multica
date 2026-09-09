ALTER TABLE product_version ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_product_version_enabled ON product_version(product_id, enabled);
