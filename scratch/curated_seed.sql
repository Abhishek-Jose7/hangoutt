-- Seeding Experience Categories
INSERT OR IGNORE INTO experience_categories (id, name, description) VALUES
('POTTERY', 'Pottery', 'Pottery workshops'),
('PAINTING', 'Painting', 'Painting sessions'),
('STANDUP_COMEDY', 'Standup Comedy', 'Standup comedy shows'),
('WORKSHOP', 'Workshop', 'General workshops');

-- Seeding Curated Places
INSERT OR REPLACE INTO places (id, name, address, lat, lng, rating, review_count, source_name, source_place_id, last_verified, verified_at, is_featured, is_hidden, boost_factor) VALUES 
('curated_creeda', 'Creeda Board Game Cafe', 'Ground Floor, New Excelsior Cinema, Fort, Mumbai', 18.9372, 72.8351, 4.7, 850, 'CURATED', 'curated_creeda', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.8),
('curated_pairadice', 'Pair A Dice Cafe', 'Sector 17, Vashi, Navi Mumbai', 19.0760, 72.9990, 4.8, 620, 'CURATED', 'curated_pairadice', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.8),
('curated_doolally_khar', 'Doolally Taproom Khar', 'Rajkutir 10A, Khar West, Mumbai', 19.0682, 72.8355, 4.5, 2500, 'CURATED', 'curated_doolally_khar', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4),
('curated_doolally_andheri', 'Doolally Taproom Andheri', 'Near Fun Republic, Veera Desai Road, Andheri West', 19.1352, 72.8311, 4.5, 3100, 'CURATED', 'curated_doolally_andheri', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4),
('curated_csmvs', 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya (CSMVS)', 'MG Road, Fort, Mumbai', 18.9269, 72.8327, 4.7, 9800, 'CURATED', 'curated_csmvs', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.6),
('curated_bdlad', 'Dr. Bhau Daji Lad Museum', 'Byculla East, Mumbai', 18.9790, 72.8348, 4.6, 2100, 'CURATED', 'curated_bdlad', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.5),
('curated_nehru_science', 'Nehru Science Centre', 'Dr E. Moses Road, Worli, Mumbai', 18.9902, 72.8188, 4.4, 5400, 'CURATED', 'curated_nehru_science', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.3),
('curated_mani_bhavan', 'Mani Bhavan Gandhi Sangrahalaya', 'Laburnum Road, Gamdevi, Mumbai', 18.9602, 72.8118, 4.7, 1800, 'CURATED', 'curated_mani_bhavan', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.3),
('curated_ngma', 'National Gallery of Modern Art (NGMA)', 'Sir Cowasji Jahangir Hall, MG Road, Colaba, Mumbai', 18.9261, 72.8322, 4.5, 1200, 'CURATED', 'curated_ngma', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4),
('curated_prithvi_cafe', 'Prithvi Cafe', 'Janki Kutir, Juhu, Mumbai', 19.1062, 72.8258, 4.6, 15000, 'CURATED', 'curated_prithvi_cafe', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.5),
('curated_carter_road', 'Carter Road Promenade', 'Bandra West, Mumbai', 19.0690, 72.8360, 4.6, 8200, 'CURATED', 'curated_carter_road', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.3),
('curated_candies', 'Candies Bandra', 'Pali Hill, Bandra West, Mumbai', 19.0620, 72.8270, 4.4, 11000, 'CURATED', 'curated_candies', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4),
('curated_marine_drive', 'Marine Drive', 'Netaji Subhash Chandra Bose Road, Mumbai', 18.9430, 72.8230, 4.8, 45000, 'CURATED', 'curated_marine_drive', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4),
('curated_sassy_spoon', 'The Sassy Spoon Nariman Point', 'Express Towers, Nariman Point, Mumbai', 18.9281, 72.8214, 4.3, 1500, 'CURATED', 'curated_sassy_spoon', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.3),
('curated_bayview_cafe', 'Bayview Cafe Colaba', ' Strand Road, Colaba, Mumbai', 18.9234, 72.8335, 4.2, 2800, 'CURATED', 'curated_bayview_cafe', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4),
('curated_aer_lounge', 'Aer Lounge Worli', 'Four Seasons Hotel, Worli, Mumbai', 18.9950, 72.8200, 4.6, 950, 'CURATED', 'curated_aer_lounge', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.5),
('curated_game_palacio', 'The Game Palacio Bandra', 'Bandra West, Mumbai', 19.0596, 72.8295, 4.6, 1200, 'CURATED', 'curated_game_palacio', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.6),
('curated_smaaash', 'Smaaash Kamala Mills', 'Kamala Mills Compound, Lower Parel, Mumbai', 19.0034, 72.8276, 4.2, 5800, 'CURATED', 'curated_smaaash', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.3),
('curated_clue_hunt', 'Clue Hunt Bandra', 'Pali Hill, Bandra West, Mumbai', 19.0610, 72.8310, 4.8, 450, 'CURATED', 'curated_clue_hunt', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.7),
('curated_mystery_rooms', 'Mystery Rooms Andheri', 'Veera Desai Road, Andheri West, Mumbai', 19.1360, 72.8320, 4.7, 720, 'CURATED', 'curated_mystery_rooms', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.7),
('curated_snow_world', 'Snow World Mumbai', 'Phoenix Marketcity, Kurla, Mumbai', 19.0607, 72.8826, 4.2, 4200, 'CURATED', 'curated_snow_world', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.3),
('curated_lets_play', 'Lets Play Trampoline Park', 'Link Road, Andheri West, Mumbai', 19.1410, 72.8315, 4.5, 980, 'CURATED', 'curated_lets_play', '2026-06-16T00:00:00Z', '2026-06-16T00:00:00Z', 1, 0, 1.4);

-- Seeding Costs
INSERT OR REPLACE INTO place_costs (place_id, mandatory_cost, optional_cost_min, optional_cost_max) VALUES
('curated_creeda', 200, 100, 300),
('curated_pairadice', 150, 100, 300),
('curated_doolally_khar', 0, 500, 1500),
('curated_doolally_andheri', 0, 500, 1500),
('curated_csmvs', 150, 0, 50),
('curated_bdlad', 20, 0, 50),
('curated_nehru_science', 100, 0, 100),
('curated_mani_bhavan', 20, 0, 0),
('curated_ngma', 20, 0, 50),
('curated_prithvi_cafe', 0, 150, 400),
('curated_carter_road', 0, 0, 100),
('curated_candies', 0, 200, 500),
('curated_marine_drive', 0, 0, 100),
('curated_sassy_spoon', 0, 800, 2500),
('curated_bayview_cafe', 0, 400, 1200),
('curated_aer_lounge', 0, 1500, 4000),
('curated_game_palacio', 1000, 200, 500),
('curated_smaaash', 800, 200, 500),
('curated_clue_hunt', 700, 0, 0),
('curated_mystery_rooms', 800, 0, 0),
('curated_snow_world', 600, 0, 0),
('curated_lets_play', 500, 0, 0);

-- Seeding Scores
INSERT OR REPLACE INTO place_scores (place_id, popularity, budget_friendliness, conversation, group_suitability, date_suitability, friends_suitability, family_suitability, weather_suitability, uniqueness, experience_score, overall) VALUES
('curated_creeda', 0.9, 0.8, 0.9, 0.9, 0.8, 1.0, 0.7, 1.0, 1.0, 0.9, 0.9),
('curated_pairadice', 0.9, 0.8, 0.9, 0.9, 0.8, 1.0, 0.7, 1.0, 1.0, 0.9, 0.9),
('curated_doolally_khar', 0.8, 0.5, 0.8, 0.9, 0.8, 0.9, 0.7, 1.0, 0.7, 0.8, 0.8),
('curated_doolally_andheri', 0.8, 0.5, 0.8, 0.9, 0.8, 0.9, 0.7, 1.0, 0.7, 0.8, 0.8),
('curated_csmvs', 0.9, 0.9, 0.7, 0.7, 0.8, 0.6, 0.9, 1.0, 0.9, 0.8, 0.8),
('curated_bdlad', 0.8, 0.9, 0.8, 0.7, 0.9, 0.6, 0.8, 1.0, 0.9, 0.8, 0.8),
('curated_nehru_science', 0.7, 0.8, 0.6, 0.8, 0.5, 0.7, 0.9, 1.0, 0.8, 0.7, 0.7),
('curated_mani_bhavan', 0.7, 0.9, 0.7, 0.5, 0.7, 0.5, 0.8, 1.0, 0.8, 0.7, 0.7),
('curated_ngma', 0.7, 0.9, 0.8, 0.6, 0.8, 0.6, 0.7, 1.0, 0.8, 0.7, 0.7),
('curated_prithvi_cafe', 0.9, 0.8, 0.9, 0.8, 0.9, 0.9, 0.7, 0.8, 0.8, 0.8, 0.85),
('curated_carter_road', 0.8, 1.0, 0.9, 0.8, 0.9, 0.8, 0.8, 0.6, 0.7, 0.7, 0.8),
('curated_candies', 0.8, 0.8, 0.8, 0.9, 0.8, 0.9, 0.7, 0.9, 0.7, 0.75, 0.78),
('curated_marine_drive', 1.0, 1.0, 0.9, 0.9, 1.0, 0.9, 0.9, 0.5, 0.8, 0.7, 0.9),
('curated_sassy_spoon', 0.7, 0.3, 0.8, 0.7, 0.9, 0.7, 0.8, 1.0, 0.7, 0.75, 0.72),
('curated_bayview_cafe', 0.6, 0.6, 0.8, 0.8, 0.9, 0.8, 0.6, 0.9, 0.7, 0.7, 0.72),
('curated_aer_lounge', 0.8, 0.1, 0.8, 0.6, 0.9, 0.7, 0.6, 0.9, 0.8, 0.8, 0.7),
('curated_game_palacio', 0.9, 0.4, 0.7, 0.9, 0.8, 1.0, 0.7, 1.0, 0.8, 0.85, 0.8),
('curated_smaaash', 0.8, 0.5, 0.6, 0.9, 0.7, 0.9, 0.8, 1.0, 0.7, 0.75, 0.75),
('curated_clue_hunt', 0.8, 0.6, 0.8, 1.0, 0.8, 1.0, 0.6, 1.0, 0.9, 0.8, 0.83),
('curated_mystery_rooms', 0.8, 0.6, 0.8, 1.0, 0.8, 1.0, 0.6, 1.0, 0.9, 0.8, 0.83),
('curated_snow_world', 0.7, 0.7, 0.6, 0.9, 0.7, 0.9, 0.8, 1.0, 0.8, 0.75, 0.76),
('curated_lets_play', 0.7, 0.7, 0.6, 0.9, 0.6, 0.9, 0.7, 1.0, 0.7, 0.75, 0.73);

-- Seeding Categories
INSERT OR IGNORE INTO place_categories (id, place_id, category) VALUES
('cat_creeda_1', 'curated_creeda', 'BOARD_GAMES'),
('cat_creeda_2', 'curated_creeda', 'PRIMARY_EXPERIENCE'),
('cat_pairadice_1', 'curated_pairadice', 'BOARD_GAMES'),
('cat_pairadice_2', 'curated_pairadice', 'PRIMARY_EXPERIENCE'),
('cat_doolally_khar_1', 'curated_doolally_khar', 'CAFE'),
('cat_doolally_khar_2', 'curated_doolally_khar', 'BOARD_GAMES'),
('cat_doolally_khar_3', 'curated_doolally_khar', 'FOOD_STOP'),
('cat_doolally_andheri_1', 'curated_doolally_andheri', 'CAFE'),
('cat_doolally_andheri_2', 'curated_doolally_andheri', 'BOARD_GAMES'),
('cat_doolally_andheri_3', 'curated_doolally_andheri', 'FOOD_STOP'),
('cat_csmvs_1', 'curated_csmvs', 'MUSEUM'),
('cat_csmvs_2', 'curated_csmvs', 'PRIMARY_EXPERIENCE'),
('cat_bdlad_1', 'curated_bdlad', 'MUSEUM'),
('cat_bdlad_2', 'curated_bdlad', 'PRIMARY_EXPERIENCE'),
('cat_nehru_science_1', 'curated_nehru_science', 'MUSEUM'),
('cat_nehru_science_2', 'curated_nehru_science', 'PRIMARY_EXPERIENCE'),
('cat_mani_bhavan_1', 'curated_mani_bhavan', 'MUSEUM'),
('cat_mani_bhavan_2', 'curated_mani_bhavan', 'PRIMARY_EXPERIENCE'),
('cat_ngma_1', 'curated_ngma', 'MUSEUM'),
('cat_ngma_2', 'curated_ngma', 'PRIMARY_EXPERIENCE'),
('cat_prithvi_cafe_1', 'curated_prithvi_cafe', 'CAFE'),
('cat_prithvi_cafe_2', 'curated_prithvi_cafe', 'FOOD_STOP'),
('cat_carter_road_1', 'curated_carter_road', 'PARK'),
('cat_carter_road_2', 'curated_carter_road', 'OPTIONAL_STOP'),
('cat_candies_1', 'curated_candies', 'CAFE'),
('cat_candies_2', 'curated_candies', 'FOOD_STOP'),
('cat_marine_drive_1', 'curated_marine_drive', 'PARK'),
('cat_marine_drive_2', 'curated_marine_drive', 'OPTIONAL_STOP'),
('cat_sassy_spoon_1', 'curated_sassy_spoon', 'RESTAURANT'),
('cat_sassy_spoon_2', 'curated_sassy_spoon', 'FOOD_STOP'),
('cat_bayview_cafe_1', 'curated_bayview_cafe', 'CAFE'),
('cat_bayview_cafe_2', 'curated_bayview_cafe', 'FOOD_STOP'),
('cat_aer_lounge_1', 'curated_aer_lounge', 'RESTAURANT'),
('cat_aer_lounge_2', 'curated_aer_lounge', 'FOOD_STOP'),
('cat_game_palacio_1', 'curated_game_palacio', 'BOWLING'),
('cat_game_palacio_2', 'curated_game_palacio', 'ARCADE'),
('cat_game_palacio_3', 'curated_game_palacio', 'PRIMARY_EXPERIENCE'),
('cat_smaaash_1', 'curated_smaaash', 'ARCADE'),
('cat_smaaash_2', 'curated_smaaash', 'PRIMARY_EXPERIENCE'),
('cat_clue_hunt_1', 'curated_clue_hunt', 'ESCAPE_ROOM'),
('cat_clue_hunt_2', 'curated_clue_hunt', 'PRIMARY_EXPERIENCE'),
('cat_mystery_rooms_1', 'curated_mystery_rooms', 'ESCAPE_ROOM'),
('cat_mystery_rooms_2', 'curated_mystery_rooms', 'PRIMARY_EXPERIENCE'),
('cat_snow_world_1', 'curated_snow_world', 'SPORTS'),
('cat_snow_world_2', 'curated_snow_world', 'PRIMARY_EXPERIENCE'),
('cat_lets_play_1', 'curated_lets_play', 'SPORTS'),
('cat_lets_play_2', 'curated_lets_play', 'PRIMARY_EXPERIENCE');

-- Seeding Experiences (Workshops)
INSERT OR REPLACE INTO experiences (id, title, description, category, city, latitude, longitude, start_date, end_date, ticket_price, source, source_url, image_url, rating, popularity_score, is_recurring) VALUES
('exp_pottery_1', 'Traditional Wheel Pottery Masterclass', 'Learn traditional clay wheel pottery from master artisan Sanjay in a cozy Bandra studio.', 'POTTERY', 'Mumbai', 19.0500, 72.8300, '2026-06-01', '2026-12-31', 1200, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/pottery-masterclass', 'https://images.unsplash.com/photo-1565192647048-f997ded87958?w=500', 4.8, 0.9, 1),
('exp_painting_1', 'Canvas Painting Social by Paintology', 'Unleash your creativity with guided painting, mocktails, and music in Andheri West.', 'PAINTING', 'Mumbai', 19.1329, 72.8147, '2026-06-01', '2026-12-31', 900, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/painting-social', 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500', 4.6, 0.8, 1),
('exp_standup_1', 'Mumbai Standup Comedy Showcase', 'Catch Mumbai''s funniest comics live at the Lower Parel comedy club.', 'STANDUP_COMEDY', 'Mumbai', 19.0034, 72.8276, '2026-06-01', '2026-12-31', 499, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/standup-showcase', 'https://images.unsplash.com/photo-1585699324551-f6c309eed262?w=500', 4.7, 0.85, 1),
('exp_baking_1', 'Culinary Craft Artisan Baking Workshop', 'Learn to bake delicious sourdough, French pastries, and cakes in Chembur.', 'WORKSHOP', 'Mumbai', 19.0520, 72.8980, '2026-06-01', '2026-12-31', 1500, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/baking-workshop', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500', 4.8, 0.8, 1),
('exp_hoop_1', 'The Hula Hoop Dance Class', 'A high energy workout learning rhythmic hula hoop flows at Juhu Beach.', 'WORKSHOP', 'Mumbai', 19.1075, 72.8263, '2026-06-01', '2026-12-31', 600, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/hoop-class', 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=500', 4.5, 0.7, 1),
('exp_macrame_1', 'Macrame Wall Hanging Art Class', 'Learn knotting techniques to create beautiful boho home decor in Dadar.', 'WORKSHOP', 'Mumbai', 19.0178, 72.8478, '2026-06-01', '2026-12-31', 800, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/macrame-art', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=500', 4.7, 0.75, 1),
('exp_resin_1', 'Fluid Art and Resin Coaster Workshop', 'Create custom glossy resin coasters in this hands-on workshop in Worli.', 'WORKSHOP', 'Mumbai', 19.0176, 72.8179, '2026-06-01', '2026-12-31', 1100, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/resin-workshop', 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=500', 4.6, 0.78, 1),
('exp_bonsai_1', 'Bonsai Gardening Workshop', 'Learn the ancient art of growing and grooming bonsai trees in Shivaji Park.', 'WORKSHOP', 'Mumbai', 19.0268, 72.8415, '2026-06-01', '2026-12-31', 750, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/bonsai-workshop', 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=500', 4.7, 0.74, 1),
('exp_dance_1', 'Salsa and Bachata Beginners Boot Camp', 'Learn the basics of Latin social dancing in a fun, friendly Kurla studio.', 'WORKSHOP', 'Mumbai', 19.0607, 72.8826, '2026-06-01', '2026-12-31', 500, 'BOOKMYSHOW', 'https://bookmyshow.com/mumbai/events/latin-bootcamp', 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500', 4.8, 0.83, 1);

-- Seeding Featured Places Lists (Hidden Gems)
INSERT OR REPLACE INTO featured_places (id, list_name, place_id, experience_id, description) VALUES
-- Best Board Game Cafes
('f_board_1', 'Best Board Game Cafes', 'curated_creeda', NULL, 'Excellent game selection and helpful curators who explain rules.'),
('f_board_2', 'Best Board Game Cafes', 'curated_pairadice', NULL, 'Cozy environment with delicious milkshakes and extensive board game catalog.'),
('f_board_3', 'Best Board Game Cafes', 'curated_doolally_khar', NULL, 'Allows pet entry, craft beer on tap, and a solid drawer of classic board games.'),
('f_board_4', 'Best Board Game Cafes', 'curated_doolally_andheri', NULL, 'Popular suburb brewery hangout featuring board game shelves and great pub food.'),

-- Best Workshops
('f_work_1', 'Best Workshops', NULL, 'exp_pottery_1', 'Highly rated hands-on clay pottery session on standard wheels.'),
('f_work_2', 'Best Workshops', NULL, 'exp_painting_1', 'Unwind with wine/mocktails and canvas paints on a Sunday afternoon.'),
('f_work_3', 'Best Workshops', NULL, 'exp_baking_1', 'Professional masterclass on baking breads and fancy pastries.'),
('f_work_4', 'Best Workshops', NULL, 'exp_hoop_1', 'Fun hula hoop movements with dance steps on Juhu beach.'),
('f_work_5', 'Best Workshops', NULL, 'exp_macrame_1', 'Relaxing yarn crafting and wall hanging knots class.'),
('f_work_6', 'Best Workshops', NULL, 'exp_resin_1', 'Glossy artistic coaster creation workshop in Worli.'),

-- Best Museums
('f_museum_1', 'Best Museums', 'curated_csmvs', NULL, 'Mumbai''s premier heritage museum with amazing art, sculpture and natural history galleries.'),
('f_museum_2', 'Best Museums', 'curated_bdlad', NULL, 'Stunning 19th-century architecture housing Mumbai''s cultural evolution map files.'),
('f_museum_3', 'Best Museums', 'curated_nehru_science', NULL, 'Interactive science models, 3D shows and giant outdoor activity exhibits.'),
('f_museum_4', 'Best Museums', 'curated_mani_bhavan', NULL, 'Serene residential building turned museum dedicated to Mahatma Gandhi''s Bombay years.'),
('f_museum_5', 'Best Museums', 'curated_ngma', NULL, 'Hosts national and international contemporary art exhibitions.'),

-- Best Date Spots
('f_date_1', 'Best Date Spots', 'curated_prithvi_cafe', NULL, 'Beautiful open-air setting with Irish coffee, kadhai biryani, and live music/theater vibe.'),
('f_date_2', 'Best Date Spots', 'curated_carter_road', NULL, 'Seafront walk with sunset views, cool breeze, and street food stops.'),
('f_date_3', 'Best Date Spots', 'curated_candies', NULL, 'Multi-tiered vintage cafe with Portuguese style tiling and cozy corner seating.'),
('f_date_4', 'Best Date Spots', 'curated_marine_drive', NULL, 'Iconic Queen''s Necklace promenade, perfect for late night talks.'),
('f_date_5', 'Best Date Spots', 'curated_sassy_spoon', NULL, 'Chic interior, elegant seating, and fine cuisine for a special dinner date.'),
('f_date_6', 'Best Date Spots', 'curated_bayview_cafe', NULL, 'Rooftop cafe overlooking the Gateway of India and the harbor.'),
('f_date_7', 'Best Date Spots', 'curated_aer_lounge', NULL, 'Premium luxury rooftop offering panoramic ocean views and fine cocktails.'),

-- Best Group Activities
('f_group_1', 'Best Group Activities', 'curated_game_palacio', NULL, 'Elite boutique bowling alley with arcade, VR games and live DJ.'),
('f_group_2', 'Best Group Activities', 'curated_smaaash', NULL, 'Thrilling multi-level go-karting, simulator sports, and bumper cars.'),
('f_group_3', 'Best Group Activities', 'curated_clue_hunt', NULL, 'Interactive escape rooms with mystery cases to solve in 60 minutes.'),
('f_group_4', 'Best Group Activities', 'curated_mystery_rooms', NULL, 'Immersive themed physical escape games for team challenges.'),
('f_group_5', 'Best Group Activities', 'curated_snow_world', NULL, 'Real indoor snow park with toboggan runs, ice skating and snow play.'),
('f_group_6', 'Best Group Activities', 'curated_lets_play', NULL, 'Massive trampoline arena with foam pits and slam dunk courts.');
