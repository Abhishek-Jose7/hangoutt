CREATE TABLE `member_travel_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`user_id` text NOT NULL,
	`train_time` integer NOT NULL,
	`train_cost` integer NOT NULL,
	`cab_time` integer NOT NULL,
	`cab_cost` integer NOT NULL,
	`walk_time` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `locations` ADD `location_name` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `meetup_zone` text NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `experience_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `travel_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `budget_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `fairness_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `popularity_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `group_type_match_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `vibe_match_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `composite_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_train_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_cab_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_train_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_cab_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `longest_travel_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `shortest_travel_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `travel_fairness_score` real DEFAULT 1 NOT NULL;