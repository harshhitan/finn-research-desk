import type { Corpus, DocumentRecord, FeedItem } from "./types";
import { database } from "./repository";

const origin="https://www.ril.com/investor/resource-center/corporate-announcements";
function decode(s:string){return s.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#039;|&#39;/g,"'").replace(/&nbsp;/g," ").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));}
export function classifyTitle(title:string){
  if(/resign|appoint|management|director|chief|\bcfo\b|\bceo\b/i.test(title))return {category:"management_change",priority:"high" as const};
  if(/merger|acquis|joint venture|demerger/i.test(title))return {category:"M&A",priority:"high" as const};
  if(/financial result|financial performance|results for/i.test(title))return {category:"results",priority:"high" as const};
  if(/customs|order from|penalt|litigation|tax demand/i.test(title))return {category:"litigation",priority:"high" as const};
  if(/initial public|prospectus|listing of|debenture|allotment/i.test(title))return {category:"fund_raise",priority:"high" as const};
  if(/credit rating/i.test(title))return {category:"credit_rating",priority:"medium" as const};
  if(/investor.*meet|conference|forum/i.test(title))return {category:"investor_meetings",priority:"routine" as const};
  if(/dividend/i.test(title))return {category:"dividend",priority:"medium" as const};
  if(/capex|capacity|plant|facility/i.test(title))return {category:"capex",priority:"high" as const};
  return {category:"press_release",priority:"medium" as const};
}
export async function getAnnouncements(force=false){
  const db=database();const cached=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key='issuer-announcements'").first<{data:string;fetched_at:string}>();
  if(cached&&!force&&Date.now()-Date.parse(cached.fetched_at)<10*60*1000)return {...JSON.parse(cached.data),checkedAt:cached.fetched_at};
  try{
    const response=await fetch(origin,{signal:AbortSignal.timeout(9000)});if(!response.ok)throw new Error("issuer_response");const html=await response.text();
    const rows=[...html.matchAll(/class="table-row"\s+aria-label="Date: ([^"]+?)\. Title: ([^"]+?)"[^>]*>\s*<a\s+href="([^"]+)"/g)];
    if(!rows.length)throw new Error("issuer_markup_changed");
    const records=[];
    for(const row of rows){const day=new Date(`${row[1]} 00:00:00 GMT+0530`);if(!Number.isFinite(day.getTime()))continue;const url=new URL(decode(row[3]),origin);if(!["www.ril.com","rilstaticasset.akamaized.net"].includes(url.hostname)||url.protocol!=="https:")continue;
      const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(url.href));const id="issuer-"+Array.from(new Uint8Array(hash)).slice(0,10).map(x=>x.toString(16).padStart(2,"0")).join("");
      const title=decode(row[2]).replace(/\.$/,"");const old=cached?JSON.parse(cached.data).records.find((r:any)=>r.id===id):null;
      records.push({id,title,url:url.href,publishedAt:day.toISOString(),firstSeenAt:old?.firstSeenAt||new Date().toISOString(),datePrecision:"day",...classifyTitle(title)});
    }
    if(!records.length)throw new Error("issuer_records_unavailable");
    const previous=cached?JSON.parse(cached.data).records:[];const merged=Array.from(new Map([...previous,...records].map((r:any)=>[r.id,r])).values()).sort((a:any,b:any)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,100);
    const result={records:merged,source:origin,coverage:"Latest issuer-page announcements; day precision. Not an exhaustive exchange feed."};const checkedAt=new Date().toISOString();
    await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('issuer-announcements',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(JSON.stringify(result),checkedAt).run();return {...result,checkedAt};
  }catch{return cached?{...JSON.parse(cached.data),checkedAt:cached.fetched_at,stale:true,error:"Issuer refresh failed. Retaining the last successful filing records."}:{records:[],checkedAt:null,error:"Issuer announcements could not be reached. Indexed historical sources remain available."};}
}
export function issuerDocuments(records:any[]):DocumentRecord[]{return records.map(r=>({id:r.id,title:r.title,type:"issuer_announcement",period:"Issuer filing",publishedAt:r.publishedAt,url:r.url,allowedForResearch:false}));}
export function issuerFeed(records:any[]):FeedItem[]{return records.map(r=>({id:`filing-${r.id}`,title:r.title,category:r.category,publishedAt:r.publishedAt,priority:r.priority,summary:"Company announcement. The filing title and publication day are verified; the attachment has not been analysed.",implication:r.priority==="routine"?"Routine investor-meeting disclosure. Retained for completeness; expand or open the filing if relevant.":"Prioritised by announcement-title rules. Read the original filing to assess its scope and impact; priority is not a price prediction.",evidenceIds:[],documentId:r.id}));}
