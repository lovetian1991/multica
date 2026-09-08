ALTER TABLE issue
    ADD COLUMN IF NOT EXISTS product_version_id UUID;
