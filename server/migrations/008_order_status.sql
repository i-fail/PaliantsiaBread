-- An order's progress: unpaid -> paid -> shipped -> delivered. Every order starts as unpaid.
-- Orders saved before this change had the placeholder status "placed", which is the same as unpaid.
UPDATE orders SET status = 'unpaid' WHERE status = 'placed';

ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'unpaid';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_valid') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_status_valid CHECK (status IN ('unpaid', 'paid', 'shipped', 'delivered'));
  END IF;
END $$;
