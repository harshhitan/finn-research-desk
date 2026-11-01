CREATE TABLE `research_financial_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`document_id` text NOT NULL,
	`version_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`scope` text NOT NULL,
	`validation` text NOT NULL,
	`data` text NOT NULL,
	`extractor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_facts_company` ON `research_financial_facts` (`ticker`,`metric`,`period`);