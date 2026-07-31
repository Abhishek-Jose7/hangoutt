-- Quick Plan: tag history rows by source and store the original request.
ALTER TABLE `history` ADD COLUMN `source` text DEFAULT 'GROUP' NOT NULL;
ALTER TABLE `history` ADD COLUMN `metadata` text;
