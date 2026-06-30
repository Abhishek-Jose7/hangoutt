-- Migration 0015: self-healing venue discovery + feedback loop
--> statement-breakpoint
ALTER TABLE `places` ADD `business_status` text DEFAULT 'OPERATIONAL' NOT NULL;
--> statement-breakpoint
ALTER TABLE `places` ADD `opening_hours_json` text;
--> statement-breakpoint
ALTER TABLE `places` ADD `phone` text;
--> statement-breakpoint
CREATE TABLE `zone_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_name` text NOT NULL,
	`category` text NOT NULL,
	`count_viable` integer DEFAULT 0 NOT NULL,
	`count_total` integer DEFAULT 0 NOT NULL,
	`deficit_score` real DEFAULT 0 NOT NULL,
	`last_recomputed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zone_coverage_zone_cat_idx` ON `zone_coverage` (`zone_name`, `category`);
--> statement-breakpoint
CREATE INDEX `zone_coverage_deficit_idx` ON `zone_coverage` (`deficit_score`);
--> statement-breakpoint
CREATE TABLE `discovery_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_name` text NOT NULL,
	`zone_lat` real NOT NULL,
	`zone_lng` real NOT NULL,
	`zone_radius` integer DEFAULT 3000 NOT NULL,
	`category` text NOT NULL,
	`priority_score` real DEFAULT 0 NOT NULL,
	`reason` text DEFAULT 'scheduled_refresh' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempted_at` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `discovery_queue_status_priority_idx` ON `discovery_queue` (`status`, `priority_score`);
--> statement-breakpoint
CREATE INDEX `discovery_queue_zone_cat_idx` ON `discovery_queue` (`zone_name`, `category`);
--> statement-breakpoint
CREATE TABLE `api_budget` (
	`id` text PRIMARY KEY NOT NULL,
	`day_utc` text NOT NULL,
	`source` text NOT NULL,
	`calls_used` integer DEFAULT 0 NOT NULL,
	`calls_limit` integer DEFAULT 1000 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_budget_day_source_idx` ON `api_budget` (`day_utc`, `source`);
--> statement-breakpoint
CREATE TABLE `venue_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`user_id` text NOT NULL,
	`place_id` text,
	`rating` integer NOT NULL,
	`would_visit_again` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `venue_feedback_place_idx` ON `venue_feedback` (`place_id`);
--> statement-breakpoint
CREATE INDEX `venue_feedback_history_idx` ON `venue_feedback` (`history_id`);
--> statement-breakpoint
CREATE TABLE `itinerary_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`history_id` text NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`overall_rating` integer NOT NULL,
	`travel_rating` integer DEFAULT 3 NOT NULL,
	`favorite_slot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `itinerary_feedback_history_idx` ON `itinerary_feedback` (`history_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `itinerary_feedback_user_history_idx` ON `itinerary_feedback` (`user_id`, `history_id`);
