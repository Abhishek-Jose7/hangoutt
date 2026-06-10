ALTER TABLE `budgets` ADD `travel_included` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `outing_date` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `outing_time` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `is_fast_track` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `timer_expires_at` text;