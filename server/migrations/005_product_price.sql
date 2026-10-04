-- Prices are whole cents. Products created before prices existed stay NULL until an admin sets one.
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_cents INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_price_cents_range') THEN
    ALTER TABLE products ADD CONSTRAINT products_price_cents_range CHECK (price_cents BETWEEN 1 AND 10000000);
  END IF;
END $$;
