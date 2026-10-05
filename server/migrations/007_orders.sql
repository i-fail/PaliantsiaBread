CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  -- Random public reference for the order: 16 letters and digits.
  slug TEXT NOT NULL CHECK (slug ~ '^[A-Za-z0-9]{16}$'),
  status TEXT NOT NULL DEFAULT 'placed',
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  -- The address is only collected when something is shipped: all five columns are set, or none.
  ship_name TEXT,
  ship_street TEXT,
  ship_city TEXT,
  ship_state TEXT,
  ship_zip TEXT,
  -- One entry per cart line, as it was at checkout: product id, SKU, title, unit price, quantity, delivery.
  items JSONB NOT NULL,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  shipped_units INTEGER NOT NULL CHECK (shipped_units >= 0),
  boxes INTEGER NOT NULL CHECK (boxes >= 0),
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (total_cents = subtotal_cents + shipping_cents),
  CHECK ((ship_name IS NULL) = (ship_street IS NULL)
    AND (ship_name IS NULL) = (ship_city IS NULL)
    AND (ship_name IS NULL) = (ship_state IS NULL)
    AND (ship_name IS NULL) = (ship_zip IS NULL)),
  CHECK ((shipped_units > 0) = (ship_name IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_slug_key ON orders (slug);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
