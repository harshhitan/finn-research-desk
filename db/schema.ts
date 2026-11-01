import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const preferences = sqliteTable("preferences", {
  owner: text("owner").primaryKey(), rules: text("rules").notNull(), updatedAt: text("updated_at").notNull(),
});
export const savedItems = sqliteTable("saved_items", {
  owner: text("owner").notNull(), itemId: text("item_id").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.owner, t.itemId] })]);
export const researchRuns = sqliteTable("research_runs", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), question: text("question").notNull(), result: text("result").notNull(), createdAt: text("created_at").notNull(),
});
export const providerCache = sqliteTable("provider_cache", {
  key: text("key").primaryKey(), data: text("data").notNull(), fetchedAt: text("fetched_at").notNull(),
});
export const alerts = sqliteTable("alerts", {
  owner: text("owner").notNull(), triggerKey: text("trigger_key").notNull(), data: text("data").notNull(), createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.owner, t.triggerKey] })]);

export const researchCompanies = sqliteTable("research_companies", {
  ticker:text("ticker").primaryKey(), name:text("name").notNull(), isin:text("isin").notNull(),
  sources:text("sources").notNull(), status:text("status").notNull(), error:text("error"),
  updatedAt:text("updated_at").notNull(), createdAt:text("created_at").notNull(),
});
export const researchDocuments = sqliteTable("research_documents", {
  id:text("id").primaryKey(), ticker:text("ticker").notNull(), title:text("title").notNull(),
  type:text("type").notNull(), period:text("period").notNull(), sourceUrl:text("source_url").notNull(),
  activeVersion:text("active_version"), status:text("status").notNull(), error:text("error"),
  updatedAt:text("updated_at").notNull(),
}, t=>[index("research_documents_company").on(t.ticker,t.type)]);
export const researchVersions = sqliteTable("research_document_versions", {
  id:text("id").primaryKey(), documentId:text("document_id").notNull(), contentHash:text("content_hash").notNull(),
  parser:text("parser").notNull(), artifactKey:text("artifact_key").notNull(), pageCount:integer("page_count").notNull(),
  readablePages:integer("readable_pages").notNull(), chunkCount:integer("chunk_count").notNull(),
  status:text("status").notNull(), createdAt:text("created_at").notNull(),
});
export const researchChunks = sqliteTable("research_chunks", {
  id:text("id").primaryKey(), versionId:text("version_id").notNull(), documentId:text("document_id").notNull(),
  ticker:text("ticker").notNull(), ordinal:integer("ordinal").notNull(), page:integer("page").notNull(),
  heading:text("heading").notNull(), text:text("text").notNull(),
}, t=>[index("research_chunks_version").on(t.versionId,t.ordinal)]);
export const researchJobs = sqliteTable("research_jobs", {
  id:text("id").primaryKey(), ticker:text("ticker").notNull(), owner:text("owner").notNull(), kind:text("kind").notNull(),
  status:text("status").notNull(), stage:text("stage").notNull(), attempts:integer("attempts").notNull().default(0),
  lease:text("lease"), leaseUntil:text("lease_until"), progress:text("progress").notNull(), error:text("error"),
  availableAt:text("available_at").notNull(), createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(),
}, t=>[index("research_jobs_claim").on(t.kind,t.status,t.availableAt)]);
export const researchQuestions = sqliteTable("research_questions", {
  id:text("id").primaryKey(), owner:text("owner").notNull(), ticker:text("ticker").notNull(), question:text("question").notNull(),
  filters:text("filters").notNull(), context:text("context").notNull(), sourceVersion:text("source_version").notNull(),
  cacheKey:text("cache_key").notNull(), status:text("status").notNull(), answer:text("answer"), error:text("error"),
  lease:text("lease"), leaseUntil:text("lease_until"), attempts:integer("attempts").notNull().default(0),
  createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(),
}, t=>[index("research_questions_owner").on(t.owner,t.createdAt),index("research_questions_cache").on(t.owner,t.cacheKey)]);
export const researchWorker = sqliteTable("research_worker", {
  id:text("id").primaryKey(), lastSeen:text("last_seen").notNull(), modelReady:integer("model_ready").notNull(),
  data:text("data").notNull(),
});
