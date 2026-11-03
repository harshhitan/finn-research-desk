-- FINN PostgreSQL schema. Applied transactionally by scripts/neon/migrate.mjs.
CREATE TABLE "alerts" (
	"owner" text NOT NULL,
	"trigger_key" text NOT NULL,
	"data" text NOT NULL,
	"created_at" text NOT NULL,
	PRIMARY KEY("owner", "trigger_key")
);

CREATE TABLE "preferences" (
	"owner" text PRIMARY KEY NOT NULL,
	"rules" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "provider_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"fetched_at" text NOT NULL
);

CREATE TABLE "research_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"question" text NOT NULL,
	"result" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "saved_items" (
	"owner" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" text NOT NULL,
	PRIMARY KEY("owner", "item_id")
);

CREATE TABLE "research_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"document_id" text NOT NULL,
	"ticker" text NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer NOT NULL,
	"heading" text NOT NULL,
	"text" text NOT NULL
);

CREATE INDEX "research_chunks_version" ON "research_chunks" ("version_id","ordinal");
CREATE TABLE "research_companies" (
	"ticker" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"isin" text NOT NULL,
	"sources" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"updated_at" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "research_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"period" text NOT NULL,
	"source_url" text NOT NULL,
	"active_version" text,
	"status" text NOT NULL,
	"error" text,
	"updated_at" text NOT NULL
);

CREATE INDEX "research_documents_company" ON "research_documents" ("ticker","type");
CREATE TABLE "research_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease" text,
	"lease_until" text,
	"progress" text NOT NULL,
	"error" text,
	"available_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "research_jobs_claim" ON "research_jobs" ("kind","status","available_at");
CREATE TABLE "research_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"ticker" text NOT NULL,
	"question" text NOT NULL,
	"filters" text NOT NULL,
	"context" text NOT NULL,
	"source_version" text NOT NULL,
	"cache_key" text NOT NULL,
	"status" text NOT NULL,
	"answer" text,
	"error" text,
	"lease" text,
	"lease_until" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "research_questions_owner" ON "research_questions" ("owner","created_at");
CREATE INDEX "research_questions_cache" ON "research_questions" ("owner","cache_key");
CREATE TABLE "research_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"parser" text NOT NULL,
	"artifact_key" text NOT NULL,
	"page_count" integer NOT NULL,
	"readable_pages" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "research_worker" (
	"id" text PRIMARY KEY NOT NULL,
	"last_seen" text NOT NULL,
	"model_ready" integer NOT NULL,
	"data" text NOT NULL
);

CREATE TABLE research_chunk_fts (chunk_id TEXT PRIMARY KEY, text TEXT NOT NULL, heading TEXT NOT NULL);

CREATE UNIQUE INDEX research_one_active_preparation ON research_jobs(ticker) WHERE kind='prepare' AND status IN ('queued','running','retry');

ALTER TABLE "research_document_versions" ADD "source_metadata" text DEFAULT '{}' NOT NULL;
ALTER TABLE "research_jobs" ADD "priority" integer DEFAULT 0 NOT NULL;

UPDATE research_jobs SET priority=10 WHERE kind='prepare' AND status IN ('queued','retry') AND ticker IN (SELECT ticker FROM research_questions WHERE status='waiting_documents');

CREATE TABLE "research_financial_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"metric" text NOT NULL,
	"period" text NOT NULL,
	"scope" text NOT NULL,
	"validation" text NOT NULL,
	"data" text NOT NULL,
	"extractor" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX "research_facts_company" ON "research_financial_facts" ("ticker","metric","period");
CREATE TABLE IF NOT EXISTS portfolio_companies(ticker TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_filings(id TEXT PRIMARY KEY,ticker TEXT NOT NULL,published_at TEXT NOT NULL,attachment_url TEXT,data TEXT NOT NULL,first_seen TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS portfolio_filings_window ON portfolio_filings(published_at,ticker);
CREATE INDEX IF NOT EXISTS portfolio_filings_attachment ON portfolio_filings(ticker,attachment_url);
CREATE TABLE IF NOT EXISTS portfolio_prices(ticker TEXT NOT NULL,session_date TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(ticker,session_date));
CREATE TABLE IF NOT EXISTS portfolio_sources(ticker TEXT NOT NULL,source TEXT NOT NULL,last_attempt TEXT NOT NULL,last_success TEXT,error TEXT,coverage TEXT NOT NULL,PRIMARY KEY(ticker,source));
CREATE TABLE IF NOT EXISTS portfolio_jobs(id TEXT PRIMARY KEY,ticker TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,available_at TEXT NOT NULL,lease_until TEXT,error TEXT,finished_at TEXT,payload TEXT);
CREATE INDEX IF NOT EXISTS portfolio_jobs_claim ON portfolio_jobs(status,available_at);
CREATE TABLE IF NOT EXISTS portfolio_locks(name TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_rules(owner TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_alerts(owner TEXT NOT NULL,trigger_key TEXT NOT NULL,ticker TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,PRIMARY KEY(owner,trigger_key));
CREATE TABLE IF NOT EXISTS portfolio_analysis(owner TEXT NOT NULL,filing_id TEXT NOT NULL,content_hash TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,filing_id));
CREATE TABLE IF NOT EXISTS portfolio_oauth(state_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,transaction_data TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_accounts(owner TEXT PRIMARY KEY,subject TEXT NOT NULL,credentials TEXT NOT NULL,expires_at TEXT NOT NULL,scopes TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_model_leases(owner TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_private_worker(owner TEXT PRIMARY KEY,last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS portfolio_private_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,filing_id TEXT NOT NULL,content_hash TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,available_at TEXT NOT NULL,lease TEXT,lease_until TEXT,error TEXT,finished_at TEXT,UNIQUE(owner,filing_id,content_hash,model));
CREATE INDEX IF NOT EXISTS portfolio_private_jobs_claim ON portfolio_private_jobs(status,available_at);
CREATE INDEX research_chunk_search ON research_chunk_fts USING GIN (to_tsvector('simple', heading || ' ' || text));