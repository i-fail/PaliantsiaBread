-- Paying through Square Payment Links. When a customer clicks Pay, a payment link is created and remembered here
-- (so clicking again reuses it). Square's webhook then finds the order by square_order_id.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS square_order_id TEXT;
-- Set when a verified payment marks the order paid.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS square_payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
-- Set when a payment arrived but did not match the order (so it was NOT marked paid); needs a person to look.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_problem TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_square_order_id_key ON orders (square_order_id) WHERE square_order_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_link_complete') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_payment_link_complete CHECK (
      (payment_link_id IS NULL) = (payment_link_url IS NULL) AND (payment_link_id IS NULL) = (square_order_id IS NULL)
    );
  END IF;
END $$;
