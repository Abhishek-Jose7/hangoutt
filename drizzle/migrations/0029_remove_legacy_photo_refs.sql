-- Remove dead Maps photo-reference URLs. Sourced web image URLs remain intact.
UPDATE places
SET image_url = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE image_url LIKE '/api/places/photo?ref=%';
