-- Curated Mumbai hangout anchors selected for specific, social use-cases.
-- Sources checked 2026-09-07: venue-owned pages and current listings:
-- Cat Café Studio, Bombay Drawing Room, The Habitat, antiSOCIAL, Leaping Windows,
-- NMACC, and Bastian Hospitality. Re-run safe by design.
INSERT OR IGNORE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status)
VALUES
('curated_cat_cafe_studio', 'Cat Café Studio', '63, Harminder Singh Road, Aram Nagar Part 1, Versova, Andheri West, Mumbai 400061', 19.1363, 72.8114, NULL, 0, 'CURATED', 'curated_cat_cafe_studio', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.45, 'OPERATIONAL'),
('curated_leaping_windows', 'Leaping Windows', '2 & 3, Corner View, Ashok Chopra Marg, opposite Bianca Towers, Versova, Andheri West, Mumbai 400061', 19.1354, 72.8110, 4.0, 2566, 'CURATED', 'curated_leaping_windows', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.30, 'OPERATIONAL'),
('curated_habitat_khar', 'The Habitat', 'Hotel Unicontinental, Road No. 3, Khar West, Mumbai 400052', 19.0713, 72.8393, NULL, 0, 'CURATED', 'curated_habitat_khar', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.40, 'OPERATIONAL'),
('curated_antisocial_lower_parel', 'antiSOCIAL Mumbai', 'Mathuradas Mill Compound, Lower Parel, Mumbai 400013', 18.9987, 72.8258, NULL, 0, 'CURATED', 'curated_antisocial_lower_parel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.40, 'OPERATIONAL'),
('curated_bombay_drawing_room_bkc', 'Bombay Drawing Room', 'Bandra Kurla Complex, Bandra East, Mumbai 400051', 19.0667, 72.8670, NULL, 0, 'CURATED', 'curated_bombay_drawing_room_bkc', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.25, 'OPERATIONAL'),
('curated_nmacc', 'Nita Mukesh Ambani Cultural Centre', 'Jio World Centre, Block G, Bandra Kurla Complex, Bandra East, Mumbai 400051', 19.0686, 72.8680, NULL, 0, 'CURATED', 'curated_nmacc', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.30, 'OPERATIONAL'),
('curated_bastian_at_top', 'Bastian At The Top', 'Kamani Chambers, 30A, Shivaji Park, Dadar West, Mumbai 400028', 19.0268, 72.8396, NULL, 0, 'CURATED', 'curated_bastian_at_top', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.20, 'OPERATIONAL'),
('curated_bastian_beach_club', 'Bastian Beach Club', 'Sun-n-Sand Hotel, Juhu Beach, Juhu, Mumbai 400049', 19.1030, 72.8261, NULL, 0, 'CURATED', 'curated_bastian_beach_club', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.25, 'OPERATIONAL'),
('curated_bombay_coffee_house', 'Bombay Coffee House', '248, Neelkamal Building, Waterfield Road, Bandra West, Mumbai 400050', 19.0603, 72.8350, NULL, 0, 'CURATED', 'curated_bombay_coffee_house', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.20, 'OPERATIONAL'),
('curated_ammakai', 'Ammakai', 'Pali Hill, Bandra West, Mumbai 400050', 19.0595, 72.8330, NULL, 0, 'CURATED', 'curated_ammakai', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.20, 'OPERATIONAL');
--> statement-breakpoint

INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES
('cat_curated_cat_cafe_studio_cafe', 'curated_cat_cafe_studio', 'CAFE'),
('cat_curated_leaping_windows_cafe', 'curated_leaping_windows', 'CAFE'),
('cat_curated_habitat_khar_comedy', 'curated_habitat_khar', 'COMEDY'),
('cat_curated_antisocial_lower_parel_music', 'curated_antisocial_lower_parel', 'LIVE_MUSIC'),
('cat_curated_bombay_drawing_room_painting', 'curated_bombay_drawing_room_bkc', 'PAINTING'),
('cat_curated_nmacc_gallery', 'curated_nmacc', 'ART_GALLERY'),
('cat_curated_bastian_at_top_restaurant', 'curated_bastian_at_top', 'RESTAURANT'),
('cat_curated_bastian_beach_club_restaurant', 'curated_bastian_beach_club', 'RESTAURANT'),
('cat_curated_bombay_coffee_house_cafe', 'curated_bombay_coffee_house', 'CAFE'),
('cat_curated_ammakai_restaurant', 'curated_ammakai', 'RESTAURANT');
--> statement-breakpoint

INSERT OR IGNORE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES
('curated_cat_cafe_studio', 250, 0, 450),
('curated_leaping_windows', 0, 700, 1100),
('curated_habitat_khar', 0, 300, 900),
('curated_antisocial_lower_parel', 0, 500, 1400),
('curated_bombay_drawing_room_bkc', 2099, 0, 0),
('curated_nmacc', 0, 500, 1800),
('curated_bastian_at_top', 0, 1500, 3000),
('curated_bastian_beach_club', 0, 1500, 3200),
('curated_bombay_coffee_house', 0, 300, 800),
('curated_ammakai', 0, 1200, 2600);
--> statement-breakpoint

INSERT OR IGNORE INTO place_scores (place_id, popularity, budget_friendliness, conversation, group_suitability, date_suitability, friends_suitability, family_suitability, weather_suitability, uniqueness, experience_score, overall) VALUES
('curated_cat_cafe_studio', .82, .75, .88, .88, .85, .88, .65, .95, 1, .95, .90),
('curated_leaping_windows', .78, .72, .92, .85, .80, .86, .55, .95, .92, .90, .86),
('curated_habitat_khar', .86, .80, .95, .92, .82, .98, .30, .98, .90, .95, .91),
('curated_antisocial_lower_parel', .84, .62, .82, .90, .75, .98, .20, .98, .90, .95, .88),
('curated_bombay_drawing_room_bkc', .70, .45, .90, .92, .90, .90, .35, .98, .95, .98, .87),
('curated_nmacc', .88, .55, .82, .88, .90, .82, .70, .98, .92, .92, .87),
('curated_bastian_at_top', .84, .45, .78, .82, .86, .85, .35, .98, .80, .85, .80),
('curated_bastian_beach_club', .80, .42, .78, .82, .88, .85, .35, .98, .85, .88, .80),
('curated_bombay_coffee_house', .78, .82, .94, .85, .82, .88, .55, .98, .78, .80, .85),
('curated_ammakai', .76, .50, .82, .80, .84, .85, .35, .98, .82, .84, .80);
