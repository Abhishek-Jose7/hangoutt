PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`group_type` text NOT NULL,
	`vibes` text,
	`creator_id` text NOT NULL,
	`invite_code` text NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`voting_status` text DEFAULT 'CLOSED' NOT NULL,
	`max_members` integer DEFAULT 20 NOT NULL,
	`winning_plan_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_groups`("id", "name", "description", "group_type", "vibes", "creator_id", "invite_code", "status", "voting_status", "max_members", "winning_plan_id", "created_at", "updated_at") SELECT "id", "name", "description", "group_type", "vibes", "creator_id", "invite_code", "status", "voting_status", "max_members", NULL, "created_at", "updated_at" FROM `groups`;--> statement-breakpoint
DROP TABLE `groups`;--> statement-breakpoint
ALTER TABLE `__new_groups` RENAME TO `groups`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_invite_code_unique` ON `groups` (`invite_code`);--> statement-breakpoint
ALTER TABLE `plans` ADD `score` real DEFAULT 0 NOT NULL;