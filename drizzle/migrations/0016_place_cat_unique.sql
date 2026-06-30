-- Migration 0016: add unique constraint on place_categories(place_id, category)
-- prevents reactive fetch from inserting duplicate (place, category) pairs
CREATE UNIQUE INDEX IF NOT EXISTS `place_categories_place_cat_idx` ON `place_categories` (`place_id`, `category`);
