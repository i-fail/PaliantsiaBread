-- Existing products start as not shippable until an admin turns it on.
ALTER TABLE products ADD COLUMN IF NOT EXISTS shipping_available BOOLEAN NOT NULL DEFAULT FALSE;
