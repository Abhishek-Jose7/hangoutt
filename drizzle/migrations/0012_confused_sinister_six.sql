ALTER TABLE `places` ADD `is_featured` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `places` ADD `is_hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `places` ADD `boost_factor` real DEFAULT 1 NOT NULL;