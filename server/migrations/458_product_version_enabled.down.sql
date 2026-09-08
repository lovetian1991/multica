DROP INDEX IF EXISTS idx_product_version_enabled;

ALTER TABLE product_version DROP COLUMN IF EXISTS enabled;
