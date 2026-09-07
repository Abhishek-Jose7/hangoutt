-- 1522 is a bar/restaurant, not a cafe. Current listings place it around
-- ₹1,800–2,000 for two; store the usable per-head range.
DELETE FROM place_categories
WHERE place_id IN (SELECT id FROM places WHERE lower(name) = '1522 bar & kitchen mumbai')
  AND category = 'CAFE';
--> statement-breakpoint
INSERT OR IGNORE INTO place_categories (id, place_id, category)
SELECT lower(hex(randomblob(16))), id, 'RESTAURANT'
FROM places
WHERE lower(name) = '1522 bar & kitchen mumbai';
--> statement-breakpoint
UPDATE place_costs
SET optional_cost_min = 900,
    optional_cost_max = 1000
WHERE place_id IN (SELECT id FROM places WHERE lower(name) = '1522 bar & kitchen mumbai');
