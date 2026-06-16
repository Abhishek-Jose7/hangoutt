-- Seed Zones
INSERT OR REPLACE INTO zones (id, name, center_lat, center_lng, radius) VALUES
('zone_andheri', 'Andheri', 19.1136, 72.8697, 4.0),
('zone_bandra', 'Bandra', 19.0596, 72.8295, 3.0),
('zone_borivali', 'Borivali', 19.2290, 72.8570, 4.0),
('zone_dadar', 'Dadar', 19.0178, 72.8478, 2.5),
('zone_kurla', 'Kurla', 19.0607, 72.8826, 3.0),
('zone_ghatkopar', 'Ghatkopar', 19.0860, 72.9082, 3.0),
('zone_powai', 'Powai', 19.1176, 72.9060, 3.0),
('zone_lower_parel', 'Lower Parel', 19.0034, 72.8276, 2.0),
('zone_worli', 'Worli', 19.0176, 72.8179, 2.5),
('zone_thane', 'Thane', 19.2183, 72.9781, 5.0),
('zone_vashi', 'Vashi', 19.0745, 72.9978, 3.5),
('zone_belapur', 'Belapur', 19.0180, 73.0392, 3.5),
('zone_nerul', 'Nerul', 19.0330, 73.0180, 2.5),
('zone_seawoods', 'Seawoods', 19.0212, 73.0192, 2.5),
('zone_kharghar', 'Kharghar', 19.0222, 73.0644, 3.0),
('zone_panvel', 'Panvel', 18.9894, 73.1175, 4.0);

-- Seed Zone Fallbacks
INSERT OR REPLACE INTO zone_fallbacks (id, zone_name, name, category, lat, lng, estimated_cost_per_head, mandatory_cost, optional_cost_min, optional_cost_max, address, rating) VALUES
('fb_andheri_bowling', 'Andheri', 'The Game Palacio Andheri', 'BOWLING', 19.1352, 72.8311, 1000, 1000, 0, 200, 'Fun Republic Lane, Andheri West', 4.5),
('fb_andheri_cafe', 'Andheri', 'Leaping Windows', 'CAFE', 19.1329, 72.8147, 400, 150, 250, 600, 'Yari Road, Versova, Andheri West', 4.6),
('fb_andheri_park', 'Andheri', 'Versova Beach', 'PARK', 19.1351, 72.8119, 0, 0, 0, 0, 'Versova, Andheri West', 4.5),
('fb_bandra_bowling', 'Bandra', 'The Game Palacio Bandra', 'BOWLING', 19.0596, 72.8295, 1100, 1100, 0, 200, 'Bandra West, Mumbai', 4.6),
('fb_bandra_pottery', 'Bandra', 'Bandra Pottery Lab', 'POTTERY', 19.0500, 72.8300, 1200, 1200, 0, 0, 'Bandra West, Mumbai', 4.7),
('fb_bandra_park', 'Bandra', 'Carter Road Promenade', 'PARK', 19.0690, 72.8360, 0, 0, 0, 0, 'Bandra West, Mumbai', 4.6),
('fb_dadar_cafe', 'Dadar', 'Grandmama''s Cafe', 'CAFE', 19.0178, 72.8478, 600, 250, 350, 900, 'Dadar East, Mumbai', 4.3),
('fb_dadar_park', 'Dadar', 'Shivaji Park', 'PARK', 19.0268, 72.8415, 0, 0, 0, 0, 'Dadar West, Mumbai', 4.5),
('fb_vashi_mall', 'Vashi', 'Inorbit Mall Vashi', 'MALL', 19.0655, 72.9970, 300, 100, 200, 1000, 'Vashi, Navi Mumbai', 4.4),
('fb_vashi_boardgame', 'Vashi', 'Pair A Dice Cafe Vashi', 'BOARD_GAMES', 19.0760, 72.9990, 400, 200, 200, 500, 'Sector 17, Vashi, Navi Mumbai', 4.7),
('fb_belapur_park', 'Belapur', 'Wonders Park Belapur', 'PARK', 19.0220, 73.0290, 50, 50, 0, 100, 'Sector 19, Nerul / Belapur', 4.3),
('fb_belapur_cafe', 'Belapur', 'Urban Cafe Belapur', 'CAFE', 19.0180, 73.0392, 500, 200, 300, 800, 'CBD Belapur, Navi Mumbai', 4.2),
('fb_kurla_sports', 'Kurla', 'Snow World Mumbai', 'SPORTS', 19.0607, 72.8826, 600, 600, 0, 0, 'Phoenix Marketcity, Kurla', 4.2),
('fb_kurla_mall', 'Kurla', 'Phoenix Marketcity Kurla', 'MALL', 19.0610, 72.8830, 500, 100, 400, 2000, 'LBS Marg, Kurla', 4.5);
