CREATE TABLE `experience_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experience_cache_cache_key_unique` ON `experience_cache` (`cache_key`);--> statement-breakpoint
CREATE TABLE `experience_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `experience_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`reliability_weight` real DEFAULT 1 NOT NULL,
	`last_fetched_at` text,
	`total_records` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`city` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`ticket_price` integer DEFAULT 0 NOT NULL,
	`capacity` integer,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`image_url` text,
	`rating` real,
	`popularity_score` real DEFAULT 0 NOT NULL,
	`is_recurring` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`category`) REFERENCES `experience_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source`) REFERENCES `experience_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`slot_order` integer NOT NULL,
	`venue_id` text,
	`experience_id` text,
	`venue_name` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`arrival_time` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`travel_to_next_minutes` integer,
	`estimated_cost_per_head` integer NOT NULL,
	`note` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`experience_id`) REFERENCES `experiences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_plan_slots`("id", "plan_id", "slot_order", "venue_id", "experience_id", "venue_name", "name", "category", "arrival_time", "duration_minutes", "travel_to_next_minutes", "estimated_cost_per_head", "note") SELECT "id", "plan_id", "slot_order", "venue_id", NULL, "venue_name", "venue_name", "category", "arrival_time", "duration_minutes", "travel_to_next_minutes", "estimated_cost_per_head", "note" FROM `plan_slots`;--> statement-breakpoint
DROP TABLE `plan_slots`;--> statement-breakpoint
ALTER TABLE `__new_plan_slots` RENAME TO `plan_slots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `plan_slots_plan_slot_idx` ON `plan_slots` (`plan_id`,`slot_order`);--> statement-breakpoint
ALTER TABLE `groups` ADD `vibes` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `budget_tier` text DEFAULT 'BALANCED' NOT NULL;