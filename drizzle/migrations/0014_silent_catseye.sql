CREATE TABLE `featured_experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`experience_id` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`experience_id`) REFERENCES `experiences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `experiences` ADD `is_active` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `experiences` ADD `trending_score` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `experiences` ADD `first_seen` text DEFAULT '2026-06-16T00:00:00Z' NOT NULL;--> statement-breakpoint
ALTER TABLE `places` ADD `first_seen` text DEFAULT '2026-06-16T00:00:00Z' NOT NULL;