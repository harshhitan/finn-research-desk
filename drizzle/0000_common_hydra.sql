CREATE TABLE `alerts` (
	`owner` text NOT NULL,
	`trigger_key` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `trigger_key`)
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`owner` text PRIMARY KEY NOT NULL,
	`rules` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`question` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_items` (
	`owner` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `item_id`)
);
