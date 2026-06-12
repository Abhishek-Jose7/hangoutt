ALTER TABLE `member_travel_metrics` ADD `auto_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_travel_metrics` ADD `auto_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_travel_metrics` ADD `total_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `member_travel_metrics` ADD `total_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `mandatory_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `optional_cost_min` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `optional_cost_max` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `why_recommended` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_auto_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_auto_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_total_time` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_total_cost` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `avg_walk_time` integer DEFAULT 0 NOT NULL;