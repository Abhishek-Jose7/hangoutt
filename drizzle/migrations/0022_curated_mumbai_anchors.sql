-- Curated Mumbai anchors for heritage, books, art, green space, and group time.
-- Sources checked 2026-09-06: Incredible India, BDL Museum, and venue-owned pages.
INSERT OR IGNORE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor, business_status)
VALUES
('curated_khotachiwadi', 'Khotachiwadi Heritage Precinct', 'Girgaon, Mumbai, Maharashtra 400004', 18.9562, 72.8186, 4.6, 1200, 'CURATED', 'curated_khotachiwadi', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.35, 'OPERATIONAL'),
('curated_kitab_khana', 'Kitab Khana', 'Somaiya Bhavan, Fort, Mumbai, Maharashtra 400001', 18.9327, 72.8318, 4.6, 4500, 'CURATED', 'curated_kitab_khana', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.3, 'OPERATIONAL'),
('curated_g5a', 'G5A Foundation', 'Laxmi Mills Estate, Mahalaxmi, Mumbai, Maharashtra 400011', 18.9823, 72.8225, 4.5, 900, 'CURATED', 'curated_g5a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.25, 'OPERATIONAL'),
('curated_jio_world_garden', 'Jio World Garden', 'Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051', 19.0672, 72.8678, 4.5, 8900, 'CURATED', 'curated_jio_world_garden', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.25, 'OPERATIONAL'),
('curated_cuckoo_club', 'The Cuckoo Club', 'Pali Hill, Bandra West, Mumbai, Maharashtra 400050', 19.0628, 72.8289, 4.4, 1400, 'CURATED', 'curated_cuckoo_club', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.25, 'OPERATIONAL'),
('curated_worli_sea_face', 'Worli Sea Face', 'Worli Sea Face Promenade, Mumbai, Maharashtra 400030', 19.0168, 72.8173, 4.6, 14500, 'CURATED', 'curated_worli_sea_face', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 0, 1.3, 'OPERATIONAL');
--> statement-breakpoint

INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES
('cat_curated_khotachiwadi_park', 'curated_khotachiwadi', 'PARK'),
('cat_curated_kitab_khana_cafe', 'curated_kitab_khana', 'CAFE'),
('cat_curated_kitab_khana_gallery', 'curated_kitab_khana', 'ART_GALLERY'),
('cat_curated_g5a_gallery', 'curated_g5a', 'ART_GALLERY'),
('cat_curated_jio_world_garden_park', 'curated_jio_world_garden', 'PARK'),
('cat_curated_cuckoo_club_workshop', 'curated_cuckoo_club', 'WORKSHOP'),
('cat_curated_worli_sea_face_park', 'curated_worli_sea_face', 'PARK');
--> statement-breakpoint

INSERT OR IGNORE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES
('curated_khotachiwadi', 0, 0, 200), ('curated_kitab_khana', 0, 100, 600), ('curated_g5a', 0, 0, 500),
('curated_jio_world_garden', 0, 0, 300), ('curated_cuckoo_club', 0, 500, 1800), ('curated_worli_sea_face', 0, 0, 200);
--> statement-breakpoint

INSERT OR IGNORE INTO place_scores (place_id, popularity, budget_friendliness, conversation, group_suitability, date_suitability, friends_suitability, family_suitability, weather_suitability, uniqueness, experience_score, overall) VALUES
('curated_khotachiwadi', .7, .95, .95, .8, .7, .75, .7, .8, 1, .9, .88), ('curated_kitab_khana', .75, .85, 1, .8, 1, .85, .55, 1, .9, .88, .87), ('curated_g5a', .6, .9, .85, .75, .9, .8, .5, 1, .95, .85, .83), ('curated_jio_world_garden', .85, .85, .8, .85, .75, .85, .8, .9, .75, .85, .84), ('curated_cuckoo_club', .7, .65, .8, .8, .85, .9, .3, 1, .85, .8, .8), ('curated_worli_sea_face', .9, 1, .9, .9, .8, .9, .8, .65, .85, .9, .88);
