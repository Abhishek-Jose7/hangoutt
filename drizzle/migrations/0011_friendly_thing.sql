CREATE TABLE `itinerary_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slot1_categories` text NOT NULL,
	`slot2_categories` text NOT NULL,
	`slot3_categories` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `place_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`category` text NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `place_costs` (
	`place_id` text PRIMARY KEY NOT NULL,
	`mandatory_cost` integer DEFAULT 0 NOT NULL,
	`optional_cost_min` integer DEFAULT 0 NOT NULL,
	`optional_cost_max` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `place_scores` (
	`place_id` text PRIMARY KEY NOT NULL,
	`popularity` real DEFAULT 0 NOT NULL,
	`budget_friendliness` real DEFAULT 0 NOT NULL,
	`conversation` real DEFAULT 0 NOT NULL,
	`group_suitability` real DEFAULT 0 NOT NULL,
	`date_suitability` real DEFAULT 0 NOT NULL,
	`friends_suitability` real DEFAULT 0 NOT NULL,
	`family_suitability` real DEFAULT 0 NOT NULL,
	`weather_suitability` real DEFAULT 0 NOT NULL,
	`uniqueness` real DEFAULT 0 NOT NULL,
	`experience_score` real DEFAULT 0 NOT NULL,
	`overall` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`rating` real,
	`review_count` integer DEFAULT 0 NOT NULL,
	`source_name` text NOT NULL,
	`source_place_id` text NOT NULL,
	`last_verified` text NOT NULL,
	`verified_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ranking_metrics` (
	`place_id` text PRIMARY KEY NOT NULL,
	`times_generated` integer DEFAULT 0 NOT NULL,
	`times_viewed` integer DEFAULT 0 NOT NULL,
	`times_voted` integer DEFAULT 0 NOT NULL,
	`times_won` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `zone_fallbacks` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_name` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`estimated_cost_per_head` integer NOT NULL,
	`mandatory_cost` integer NOT NULL,
	`optional_cost_min` integer NOT NULL,
	`optional_cost_max` integer NOT NULL,
	`address` text,
	`rating` real
);
--> statement-breakpoint
CREATE TABLE `zones` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`center_lat` real NOT NULL,
	`center_lng` real NOT NULL,
	`radius` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `zones_name_unique` ON `zones` (`name`);