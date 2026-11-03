import { env } from "cloudflare:workers";
import { defaultRules } from "./finance";
import type { Rules } from "./types";
export function database() { if(!env.DB) throw new Error("Persistent storage is unavailable. Please try again later."); return env.DB; }
export function requestOrigin(request:Request){
  const runtime=env as unknown as Record<string,string|undefined>;
  const configured=runtime.FINN_RUNTIME==='render'&&(runtime.FINN_PUBLIC_ORIGIN||runtime.RENDER_EXTERNAL_URL);
  return configured?new URL(configured).origin:new URL(request.url).origin;
}
export function session(request: Request) {
  const user = request.headers.get("oai-authenticated-user-id");
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)finn_session=([a-z0-9-]{36})/i)?.[1]; const id = user || cookie || crypto.randomUUID();
  return {owner:id,cookie:user || cookie ? null : `finn_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`};
}
export async function getRules(owner: string): Promise<Rules> {
  const db=database();const r = await db.prepare("SELECT rules FROM preferences WHERE owner = ?").bind(owner).first<{rules:string}>();
  if(r)return JSON.parse(r.rules);
  await db.prepare("INSERT OR IGNORE INTO preferences(owner,rules,updated_at) VALUES(?,?,?)").bind(owner,JSON.stringify(defaultRules),new Date().toISOString()).run();return defaultRules;
}
export async function saved(owner: string) { const rows = await database().prepare("SELECT item_id FROM saved_items WHERE owner = ? ORDER BY created_at DESC").bind(owner).all<{item_id:string}>(); return rows.results.map(r=>r.item_id); }
