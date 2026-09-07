-- Admin catalog query indexes and rating-aware popularity floor.
-- Behavioral metrics must not push a highly-rated venue below its sourced rating.
CREATE INDEX IF NOT EXISTS places_name_nocase_idx ON places(name COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS places_source_name_idx ON places(source_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS places_visibility_name_idx ON places(is_hidden, name COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS place_categories_category_idx ON place_categories(category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS experiences_active_end_city_idx ON experiences(is_active, end_date, city);
--> statement-breakpoint

UPDATE place_scores
SET popularity = (
  SELECT MAX(place_scores.popularity, MIN(1.0, MAX(0.0, p.rating / 5.0)))
  FROM places p
  WHERE p.id = place_scores.place_id
)
WHERE place_id IN (SELECT id FROM places WHERE rating IS NOT NULL AND rating > 0);
--> statement-breakpoint

UPDATE place_scores
SET overall = (popularity + conversation + experience_score) / 3.0;
