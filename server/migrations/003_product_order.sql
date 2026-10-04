ALTER TABLE products ADD COLUMN IF NOT EXISTS position INTEGER;

-- Existing products keep their current alphabetical order until they are reordered.
UPDATE products
SET position = ranked.position
FROM (SELECT id, row_number() OVER (ORDER BY lower(title), id) AS position FROM products) AS ranked
WHERE products.id = ranked.id AND products.position IS NULL;

ALTER TABLE products ALTER COLUMN position SET NOT NULL;
