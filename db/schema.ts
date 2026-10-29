import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

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
