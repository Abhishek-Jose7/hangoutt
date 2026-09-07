-- Retire old seed event rows that used placeholder BookMyShow URLs.
-- Only current event pages with real listing URLs should reach itineraries.
UPDATE experiences
SET is_active = 0
WHERE source_url LIKE 'https://bookmyshow.com/mumbai/events/%';
