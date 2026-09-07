-- Current, source-backed experiences for event-led venues.
-- Sources checked 2026-09-07: venue-owned pages and current ticket listings.
-- Generic venue rows are hidden; planner receives named events with dates/prices.

UPDATE places
SET source_url = CASE id
  WHEN 'curated_cat_cafe_studio' THEN 'https://catcafestudio.com/'
  WHEN 'curated_leaping_windows' THEN 'https://www.district.in/dining/mumbai/leaping-windows-versova'
  WHEN 'curated_habitat_khar' THEN 'https://habitat.kamayatechnologies.com/'
  WHEN 'curated_antisocial_lower_parel' THEN 'https://linktr.ee/antisocial_india'
  WHEN 'curated_bombay_drawing_room_bkc' THEN 'https://bombaydrawingroom.com/'
  WHEN 'curated_nmacc' THEN 'https://www.nmacc.com/'
  ELSE source_url
END,
image_url = CASE id
  WHEN 'curated_cat_cafe_studio' THEN 'https://catcafestudio.com/wp-content/uploads/2024/08/css-logo.webp'
  WHEN 'curated_leaping_windows' THEN 'https://b.zmtcdn.com/data/pictures/chains/8/41308/55faaa66a22a07f68fdb526f2aa645e3.png'
  WHEN 'curated_habitat_khar' THEN 'https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/ff9069ed-86f1-4b2a-b335-679edccdb421/id-preview-c0927bc1--d0113e27-9fe3-4f9a-a86f-b0178dd4d80a.lovable.app-1778747640808.png'
  WHEN 'curated_antisocial_lower_parel' THEN 'https://linktr.ee/og/image/antiSOCIAL_India.jpg'
  WHEN 'curated_bombay_drawing_room_bkc' THEN 'https://bombaydrawingroom.com/cdn/shop/files/Drawing_Room_Logo_Horizontal_1_Social.png?v=1745859557'
  WHEN 'curated_nmacc' THEN 'https://www.nmacc.com/assets/nmacc/icon/nmacc.svg'
  ELSE image_url
END,
opening_hours_json = CASE id
  WHEN 'curated_cat_cafe_studio' THEN '{"source":"Cat Café Studio","hours":"Tuesday-Sunday 10:00-22:00","entryFeePerHead":250,"sourceUrl":"https://catcafestudio.com/"}'
  WHEN 'curated_leaping_windows' THEN '{"source":"District","priceRange":"₹1400 for two","hours":"12:00-00:30","sourceUrl":"https://www.district.in/dining/mumbai/leaping-windows-versova"}'
  WHEN 'curated_habitat_khar' THEN '{"source":"The Habitat","programme":"Current comedy, music, poetry and open-mic listings","sourceUrl":"https://habitat.kamayatechnologies.com/"}'
  WHEN 'curated_antisocial_lower_parel' THEN '{"source":"antiSOCIAL","programme":"Current music and culture listings","sourceUrl":"https://linktr.ee/antisocial_india"}'
  WHEN 'curated_bombay_drawing_room_bkc' THEN '{"source":"Bombay Drawing Room","programme":"Current weekend guided paint-party listings","sourceUrl":"https://bombaydrawingroom.com/"}'
  WHEN 'curated_nmacc' THEN '{"source":"NMACC","programme":"Current exhibition, tour and performance listings","sourceUrl":"https://www.nmacc.com/"}'
  ELSE opening_hours_json
END
WHERE id IN (
  'curated_cat_cafe_studio', 'curated_leaping_windows', 'curated_habitat_khar',
  'curated_antisocial_lower_parel', 'curated_bombay_drawing_room_bkc', 'curated_nmacc'
);
--> statement-breakpoint

UPDATE places
SET is_hidden = 1
WHERE id IN (
  'curated_habitat_khar', 'curated_antisocial_lower_parel',
  'curated_bombay_drawing_room_bkc', 'curated_nmacc'
);
--> statement-breakpoint

UPDATE experiences
SET is_active = 0
WHERE source_url LIKE 'https://example.com/%'
   OR end_date < CURRENT_DATE;
--> statement-breakpoint

INSERT OR IGNORE INTO experience_sources (id, name, reliability_weight)
VALUES ('BOMBAY_DRAWING_ROOM', 'Bombay Drawing Room', 1.0);
--> statement-breakpoint

INSERT OR IGNORE INTO experiences
  (id, title, description, category, city, latitude, longitude, start_date, end_date,
   ticket_price, source, source_url, image_url, rating, popularity_score,
   is_recurring, is_active, trending_score)
VALUES
('event_habitat_all_star_20260907', 'All Star Standup — The Habitat', 'The Habitat, Khar West. Fresh-material stand-up with rotating surprise acts.', 'STANDUP_COMEDY', 'Mumbai', 19.0713, 72.8393, '2026-09-07', '2026-10-01', 350, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/all-star-standup-comedy-february-onwards/ET00429759', NULL, NULL, 0.92, 0, 1, 0.95),
('event_habitat_almost_all_stars_20260910', 'Almost All Stars — The Habitat', 'The Habitat, Khar West. Curated stand-up line-up on Thursday and Friday nights.', 'STANDUP_COMEDY', 'Mumbai', 19.0713, 72.8393, '2026-09-10', '2026-10-15', 300, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/almost-all-stars-standup-comedy/ET00429762', NULL, NULL, 0.90, 0, 1, 0.90),
('event_habitat_not_crowdwork_20260910', 'Not a Crowdwork Comedy Show — The Habitat', 'The Habitat, Khar West. A late-night stand-up show at 11 PM.', 'STANDUP_COMEDY', 'Mumbai', 19.0713, 72.8393, '2026-09-10', '2027-01-01', 350, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/not-a-crowdwork-comedy-show-february-onwards/ET00429805', NULL, NULL, 0.88, 0, 1, 0.88),
('event_habitat_general_fun_game_show_20260917', 'The General Fun Game Show by Kaneez Surka — The Habitat', 'The Habitat, Khar West. Audience games, improv energy and comedy on 17 September 2026.', 'STANDUP_COMEDY', 'Mumbai', 19.0713, 72.8393, '2026-09-17', '2026-09-17', 999, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/the-general-fun-game-show-by-kaneez-surka/ET00487171', NULL, NULL, 0.86, 0, 1, 0.86),
('event_habitat_weeknd_night_20260919', 'The Weeknd Night — The Habitat', 'The Habitat, Khar West. A themed live music night on 19 September 2026.', 'CONCERT', 'Mumbai', 19.0713, 72.8393, '2026-09-19', '2026-09-19', 999, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/the-weeknd-night-mumbai/ET00492153', NULL, NULL, 0.82, 0, 1, 0.82),
('event_nmacc_bollywood_jamming_20260917', 'Bollywood Jamming — NMACC Arts Cafe', 'NMACC Arts Cafe, BKC. Thursday acoustic sets with Bollywood, Hindi, English and Punjabi songs.', 'CONCERT', 'Mumbai', 19.0686, 72.8680, '2026-09-17', '2026-09-24', 1000, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/bollywood-jamming-feel-it-live-by-soul-jams/ET00501888', NULL, NULL, 0.84, 0, 1, 0.84),
('event_nmacc_nightingales_20260917', 'Nightingales of India — NMACC', 'The Studio Theatre, NMACC. Lata and Asha tribute concert on 17 September 2026.', 'CONCERT', 'Mumbai', 19.0686, 72.8680, '2026-09-17', '2026-09-17', 750, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/nightingales-of-india-two-voices-one-legacy/ET00512504', NULL, NULL, 0.86, 0, 1, 0.86),
('event_nmacc_carvaan_rafi_20260918', 'Carvaan Live: Magic of Rafi — NMACC', 'The Studio Theatre, NMACC. Interactive Mohammed Rafi tribute concert on 18 September 2026.', 'CONCERT', 'Mumbai', 19.0686, 72.8680, '2026-09-18', '2026-09-18', 1999, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/carvaan-live-magic-of-rafi-at-nmacc/ET00512977', NULL, NULL, 0.84, 0, 1, 0.84),
('event_nmacc_carvaan_kishore_20260918', 'Carvaan Live: Sing with Kishore — NMACC', 'The Studio Theatre, NMACC. Kishore Kumar tribute with live vocals and storytelling on 18 September 2026.', 'CONCERT', 'Mumbai', 19.0686, 72.8680, '2026-09-18', '2026-09-18', 1399, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/carvaan-live-sing-with-kishore-at-nmacc/ET00512983', NULL, NULL, 0.84, 0, 1, 0.84),
('event_nmacc_second_nature_20260815', 'Second Nature by Superblue — NMACC Art House', 'Art House, NMACC. Immersive technology-and-nature exhibition running through 10 January 2027.', 'ART_EXHIBITION', 'Mumbai', 19.0686, 72.8680, '2026-08-15', '2027-01-10', 100, 'BOOKMYSHOW', 'https://in.bookmyshow.com/events/second-nature/ET00503284', NULL, NULL, 0.88, 0, 1, 0.88),
('event_nmacc_tours_20260912', 'NMACC Signature and Visitor Tours', 'NMACC, BKC. Guided 40- or 60-minute behind-the-scenes cultural-centre tour.', 'ART_EXHIBITION', 'Mumbai', 19.0686, 72.8680, '2026-09-12', '2026-11-01', 599, 'BOOKMYSHOW', 'https://in.bookmyshow.com/activities/nmacc-tours/ET00503526', NULL, NULL, 0.82, 0, 1, 0.82),
('event_bombay_drawing_room_weekend_20260912', 'Bombay Drawing Room Weekend Paint Party', 'Mumbai restaurant-hosted 2-hour guided acrylic paint party; materials included. Current weekend programme.', 'PAINTING', 'Mumbai', 19.0667, 72.8670, '2026-09-12', '2027-12-31', 2099, 'BOMBAY_DRAWING_ROOM', 'https://bombaydrawingroom.com/', NULL, NULL, 0.86, 1, 1, 0.86);
