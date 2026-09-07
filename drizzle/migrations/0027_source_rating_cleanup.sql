-- Remove unsourced hand-curated anchors from planner candidates.
-- Sourced District/venue rows and named current experiences remain available.
UPDATE places
SET is_hidden = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE source_name = 'CURATED'
  AND (source_url IS NULL OR trim(source_url) = '');
--> statement-breakpoint

-- Refresh stale 1522 data from current District listing.
UPDATE places
SET rating = 4.3,
    review_count = 7454,
    source_name = 'DISTRICT_WEB',
    source_place_id = 'district_1522_bar_and_kitchen_mahakali',
    source_url = 'https://www.district.in/dining/mumbai/1522-bar-and-kitchen-mahakali',
    image_url = 'https://b.zmtcdn.com/data/pictures/2/19251402/a48975c6edb91570f575b9173b7089b8.jpg',
    last_verified = CURRENT_TIMESTAMP,
    verified_at = CURRENT_TIMESTAMP,
    business_status = 'OPERATIONAL',
    updated_at = CURRENT_TIMESTAMP
WHERE lower(name) = '1522 bar & kitchen mumbai';
--> statement-breakpoint

-- Replace Cat Café's logo-only image with a venue-owned cat photo.
UPDATE places
SET image_url = 'https://catcafestudio.com/wp-content/uploads/2024/11/Yuzuru.webp',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'curated_cat_cafe_studio';
