CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL CHECK (length(sku) BETWEEN 1 AND 64),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_key ON products (lower(sku));

CREATE TABLE IF NOT EXISTS product_photos (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  data BYTEA NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_photos_product_id_idx ON product_photos (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_photos_one_main_key ON product_photos (product_id) WHERE is_main;
