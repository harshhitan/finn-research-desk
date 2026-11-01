CREATE TABLE `research_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`document_id` text NOT NULL,
	`ticker` text NOT NULL,
	`ordinal` integer NOT NULL,
	`page` integer NOT NULL,
	`heading` text NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_chunks_version` ON `research_chunks` (`version_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `research_companies` (
	`ticker` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`isin` text NOT NULL,
	`sources` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`updated_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`period` text NOT NULL,
	`source_url` text NOT NULL,
	`active_version` text,
	`status` text NOT NULL,
	`error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_documents_company` ON `research_documents` (`ticker`,`type`);--> statement-breakpoint
CREATE TABLE `research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`lease_until` text,
	`progress` text NOT NULL,
	`error` text,
	`available_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_jobs_claim` ON `research_jobs` (`kind`,`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `research_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`ticker` text NOT NULL,
	`question` text NOT NULL,
	`filters` text NOT NULL,
	`context` text NOT NULL,
	`source_version` text NOT NULL,
	`cache_key` text NOT NULL,
	`status` text NOT NULL,
	`answer` text,
	`error` text,
	`lease` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_questions_owner` ON `research_questions` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `research_questions_cache` ON `research_questions` (`owner`,`cache_key`);--> statement-breakpoint
CREATE TABLE `research_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`parser` text NOT NULL,
	`artifact_key` text NOT NULL,
	`page_count` integer NOT NULL,
	`readable_pages` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_worker` (
	`id` text PRIMARY KEY NOT NULL,
	`last_seen` text NOT NULL,
	`model_ready` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE research_chunk_fts USING fts5(chunk_id UNINDEXED, text, heading, tokenize='unicode61');
--> statement-breakpoint
CREATE UNIQUE INDEX research_one_active_preparation ON research_jobs(ticker) WHERE kind='prepare' AND status IN ('queued','running','retry');
