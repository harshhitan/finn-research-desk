ALTER TABLE `research_jobs` ADD `priority` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE research_jobs SET priority=10 WHERE kind='prepare' AND status IN ('queued','retry') AND ticker IN (SELECT ticker FROM research_questions WHERE status='waiting_documents');
