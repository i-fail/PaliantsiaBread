CREATE TABLE IF NOT EXISTS front_page_content (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 50000),
  subtitle TEXT NOT NULL CHECK (length(subtitle) BETWEEN 1 AND 50000),
  story TEXT NOT NULL CHECK (length(story) BETWEEN 1 AND 50000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO front_page_content (id, title, subtitle, story)
VALUES (
  1,
  'Welcome to <span>Palianytsia Bread</span>',
  'Experience the art of traditional Ukrainian baking.',
  '<p>Palianytsia Bread is a Ukrainian artisan bakery dedicated to carrying forward the ancient traditions of authentic bread making. For generations, true bread has required patience, and we honor that heritage by following time-tested, old-world recipes. Our signature long-fermentation process naturally coaxes out deep, complex flavors and a perfect texture that commercial baking simply cannot replicate.</p>
<p>We believe that what goes into your body matters. That is why we use only thoroughly sourced, organic ingredients, ensuring that every single loaf is completely free from unnecessary additives. By combining these pure ingredients with centuries-old techniques, we create artisan bread that supports your health while delivering an unforgettable taste for your ultimate enjoyment. From our oven to your table, taste the tradition in every bite.</p>'
)
ON CONFLICT (id) DO NOTHING;
