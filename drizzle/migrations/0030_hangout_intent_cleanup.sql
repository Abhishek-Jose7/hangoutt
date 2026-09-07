-- Remove catalog false positives from default hangout discovery.
-- Keep source rows for audit, but mark them hidden and lower planner intent
-- scores so a restaurant rating is never presented as hangout suitability.

CREATE INDEX IF NOT EXISTS places_geo_visibility_idx
  ON places(is_hidden, business_status, lat, lng);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS place_categories_place_category_idx
  ON place_categories(place_id, category);
--> statement-breakpoint

-- A&M Arts And Memories is a gift shop, not a cafe.
UPDATE places
SET is_hidden = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE lower(name) = 'a & m arts and memories';
--> statement-breakpoint
DELETE FROM place_categories
WHERE place_id IN (SELECT id FROM places WHERE lower(name) = 'a & m arts and memories')
  AND category = 'CAFE';
--> statement-breakpoint
INSERT OR IGNORE INTO place_categories (id, place_id, category)
SELECT lower(hex(randomblob(16))), id, 'GIFT_SHOP'
FROM places
WHERE lower(name) = 'a & m arts and memories';
--> statement-breakpoint

-- Generic Google branch labels duplicate more specific District listings at
-- the same address. Keep District's named venue/source as canonical.
UPDATE places AS generic
SET is_hidden = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE generic.source_name = 'GOOGLE'
  AND replace(replace(lower(generic.name), ' ', ''), '.', '') LIKE '1bhk%'
  AND EXISTS (
    SELECT 1 FROM places AS canonical
    WHERE canonical.source_name = 'DISTRICT_WEB'
      AND abs(canonical.lat - generic.lat) < 0.01
      AND abs(canonical.lng - generic.lng) < 0.01
  );
--> statement-breakpoint

-- Roadside / takeaway / family-dining anchors are not default hangout
-- destinations. Preserve them in admin data, exclude from public plans.
UPDATE places
SET is_hidden = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE source_name = 'DISTRICT_WEB'
  AND (
    lower(name) LIKE '%dhaba%'
    OR lower(name) LIKE '%family restaurant%'
    OR lower(name) LIKE '%fast food%'
    OR lower(name) LIKE '%food centre%'
    OR lower(name) LIKE '%food center%'
    OR lower(name) LIKE '%juice centre%'
    OR lower(name) LIKE '%juice center%'
    OR lower(name) LIKE '%snacks corner%'
    OR lower(name) LIKE '%roadside%'
    OR lower(name) LIKE '%takeaway only%'
  );
--> statement-breakpoint

UPDATE place_scores
SET popularity = MIN(popularity, 0.20),
    overall = MIN(overall, 0.20)
WHERE place_id IN (
  SELECT id FROM places WHERE is_hidden = 1
    AND (
      lower(name) = 'a & m arts and memories'
      OR source_name = 'DISTRICT_WEB' AND (
        lower(name) LIKE '%dhaba%'
        OR lower(name) LIKE '%family restaurant%'
        OR lower(name) LIKE '%fast food%'
        OR lower(name) LIKE '%food centre%'
        OR lower(name) LIKE '%food center%'
        OR lower(name) LIKE '%juice centre%'
        OR lower(name) LIKE '%juice center%'
        OR lower(name) LIKE '%snacks corner%'
        OR lower(name) LIKE '%roadside%'
        OR lower(name) LIKE '%takeaway only%'
      )
    )
);
