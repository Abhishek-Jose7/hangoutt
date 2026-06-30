-- Hide all venues with unknown/no rating (the root of the junk)
UPDATE places SET is_hidden = 1
WHERE (rating IS NULL OR rating = 0 OR review_count < 20)
  AND source_name = 'OLA';

-- Hide venues with bad name patterns
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%corporate park%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%corporate tower%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%corporate hub%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%cable vision%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%cable tv%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%cable network%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%infotainment%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%puppeteer%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%ventriloquist%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%puppet-maker%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%metro station%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%bus stand%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%bus terminal%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%bus depot%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%railway station%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%gate no%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%gate 1%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%gate 2%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%garden gate%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%wall painting%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%statue structure%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%pvt ltd%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%pvt. ltd%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%housing society%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%apartment%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '% apts%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%co-op housing%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%chawl%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%maidan%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%airport lounge%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%airport terminal%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%intercity%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%kidzania%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%smaaash junior%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%kids play area%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%delivery only%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%cloud kitchen%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%takeaway only%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%singer sajan%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE '%ramdas padhye%';
UPDATE places SET is_hidden = 1 WHERE LOWER(name) LIKE 'singer %' AND rating IS NULL;

-- Remove exact duplicates (keep the one with higher overall score)
UPDATE places SET is_hidden = 1 WHERE id IN (
  SELECT p2.id FROM places p1
  JOIN places p2 ON LOWER(p1.name) = LOWER(p2.name)
    AND p1.id != p2.id
    AND p1.id < p2.id
    AND ABS(p1.lat - p2.lat) < 0.005
  WHERE p2.is_hidden = 0
);
