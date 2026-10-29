import rawCorpus from "../../../data/reliance.json";
import { answerQuestion, buildFeed } from "../../../lib/finance";
import { database, getRules, saved, session } from "../../../lib/repository";
import { getMarket } from "../../../lib/market";
import { getAnnouncements, issuerDocuments, issuerFeed } from "../../../lib/announcements";
import { readFiling, type FilingContent } from "../../../lib/filing-content";
import type { Corpus, Rules } from "../../../lib/types";

export const dynamic = "force-dynamic";
const corpus = rawCorpus as unknown as Corpus;

async function evaluateAlerts(owner:string) {
  const rules=await getRules(owner);const market=await getMarket();const now=new Date().toISOString();const db=database();
  const preference=await db.prepare("SELECT updated_at FROM preferences WHERE owner=?").bind(owner).first<{updated_at:string}>();
  if(rules.enabled && market.status==="available" && !market.stale && market.fetchedAt && Date.parse(market.fetchedAt)>=Date.parse(preference?.updated_at||"1970-01-01")){
    const triggers=[];
    if(market.movePct!=null && Math.abs(market.movePct)>=rules.priceThreshold) triggers.push({type:"price",title:`Reliance moved ${market.movePct.toFixed(2)}%`,reason:`Completed session ${market.sessionDate}; threshold ±${rules.priceThreshold}%.`});
    if(market.volumeMultiple!=null && market.volumeMultiple>=rules.volumeThreshold)triggers.push({type:"volume",title:`Volume reached ${market.volumeMultiple.toFixed(2)}×`,reason:`${market.sessionDate}; compared with the previous 20 valid sessions, excluding the observed session.`});
    for(const t of triggers){const key=`${market.sessionDate}:${t.type}:${rules.version}`;await db.prepare("INSERT OR IGNORE INTO alerts(owner,trigger_key,data,created_at) VALUES(?,?,?,?)").bind(owner,key,JSON.stringify({...t,session:market.sessionDate,thresholds:rules,baseline:market.history?.slice(-21,-1).map(h=>h.date)}),now).run();}
  }
  return market;
}

async function handle(request:Request) {
  const who=session(request);const url=new URL(request.url);const path=url.pathname.replace(/^\/api\/?/,"");
  const headers:Record<string,string>={"Cache-Control":"no-store","Content-Type":"application/json"};if(who.cookie)headers["Set-Cookie"]=who.cookie;
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method!=="GET") {const origin=request.headers.get("origin");if(origin && origin!==url.origin)return json({error:"Cross-origin write rejected"},403);}
  try{
    if(path==="health")return json({status:"ok",company:"RELIANCE",database:(await database().prepare("SELECT 1 AS ok").first())?"ready":"unavailable",researchMode:"extractive",corpusVersion:rawCorpus.researchedAt});
    const contentRoute=path.match(/^documents\/(issuer-[a-f0-9]{20})\/content$/);
    if(contentRoute&&request.method==="GET"){
      const id=contentRoute[1];
      const filingsCache=await database().prepare("SELECT data FROM provider_cache WHERE key='issuer-announcements'").first<{data:string}>();
      const filing=filingsCache?JSON.parse(filingsCache.data).records.find((r:any)=>r.id===id):null;
      if(!filing)return json({error:"This filing is no longer available in the issuer index. Refresh sources and try again."},404);
      const key=`filing-content-v1:${id}`;
      const cached=await database().prepare("SELECT data,fetched_at FROM provider_cache WHERE key=?").bind(key).first<{data:string;fetched_at:string}>();
      if(cached){
        const content=JSON.parse(cached.data) as FilingContent;
        const ttl=content.status==="ready"?86400000:url.searchParams.get("retry")==="1"?5000:60000;
        if(Date.now()-Date.parse(cached.fetched_at)<ttl)return json(content);
      }
      const content=await readFiling(id,filing.url);
      await database().prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(key,JSON.stringify(content),content.extractedAt).run();
      return json(content);
    }
    if(path==="bootstrap"){
      const [rules,items,cache,alerts]=await Promise.all([getRules(who.owner),saved(who.owner),database().prepare("SELECT data,fetched_at FROM provider_cache WHERE key='source-check'").first<{data:string;fetched_at:string}>(),database().prepare("SELECT data,created_at,trigger_key FROM alerts WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(who.owner).all<{data:string;created_at:string;trigger_key:string}>()]);
      const filingsCache=await database().prepare("SELECT data,fetched_at FROM provider_cache WHERE key='issuer-announcements'").first<{data:string;fetched_at:string}>();
      const records=filingsCache?JSON.parse(filingsCache.data).records:[];
      return json({corpus:{...corpus,documents:[...corpus.documents,...issuerDocuments(records)]},feed:[...issuerFeed(records),...buildFeed(corpus)],saved:items,rules,market:{status:"loading",provider:"Yahoo Finance · EOD"},sourceCheckedAt:filingsCache?.fetched_at||cache?.fetched_at||null,refreshError:cache?JSON.parse(cache.data).error:undefined,alerts:alerts.results.map(a=>({...JSON.parse(a.data),id:a.trigger_key,createdAt:a.created_at})),serverTime:new Date().toISOString()});
    }
    if(path==="market"){
      const [market,filings]=await Promise.all([evaluateAlerts(who.owner),getAnnouncements()]);
      const rules=await getRules(who.owner);const preference=await database().prepare("SELECT updated_at FROM preferences WHERE owner=?").bind(who.owner).first<{updated_at:string}>();
      if(rules.enabled&&!filings.stale)for(const f of filings.records){
        if(f.priority==="routine"||!rules.categories.includes(f.category)||!f.firstSeenAt||Date.parse(f.firstSeenAt)<Date.parse(preference?.updated_at||"1970-01-01")||Date.parse(f.publishedAt)<Date.now()-86400000)continue;
        const key=`${f.id}:announcement:${rules.version}`;await database().prepare("INSERT OR IGNORE INTO alerts(owner,trigger_key,data,created_at) VALUES(?,?,?,?)").bind(who.owner,key,JSON.stringify({title:f.title,type:"announcement",reason:`New issuer disclosure in ${f.category}; publication day only. Open the original for the full scope.`,sourceUrl:f.url}),new Date().toISOString()).run();
      }
      const alerts=await database().prepare("SELECT data,created_at,trigger_key FROM alerts WHERE owner=? ORDER BY created_at DESC LIMIT 50").bind(who.owner).all<{data:string;created_at:string;trigger_key:string}>();
      return json({...market,feed:[...issuerFeed(filings.records),...buildFeed(corpus)],documents:[...corpus.documents,...issuerDocuments(filings.records)],filingsCheckedAt:filings.checkedAt,filingsError:filings.error,alerts:alerts.results.map(a=>({...JSON.parse(a.data),id:a.trigger_key,createdAt:a.created_at}))});
    }
    if(path==="briefing"){
      const from=url.searchParams.get("from");const to=url.searchParams.get("to");
      if((from&&!Number.isFinite(Date.parse(from)))||(to&&!Number.isFinite(Date.parse(to))))return json({error:"Invalid time window"},400);
      const start=from?Date.parse(from):Date.now()-86400000;const end=to?Date.parse(to):Date.now();if(start>end)return json({error:"Start must precede end"},400);
      const filings=await getAnnouncements();const items=[...issuerFeed(filings.records),...buildFeed(corpus)].filter(e=>Date.parse(e.publishedAt)>=start&&Date.parse(e.publishedAt)<=end);return json({items,coverage:filings.coverage||"Indexed historical primary documents; not a complete live exchange feed",from:new Date(start).toISOString(),to:new Date(end).toISOString()});
    }
    if(path==="research" && request.method==="POST"){
      const input:any=await request.json();if(typeof input.question!=="string"||input.question.trim().length<3||input.question.length>600)return json({error:"Enter a question between 3 and 600 characters."},400);
      if(input.ticker&&input.ticker!=="RELIANCE")return json({error:"This workspace currently indexes RELIANCE only.",code:"company_not_indexed"},422);
      const recent=await database().prepare("SELECT COUNT(*) AS count FROM research_runs WHERE owner=? AND created_at>?").bind(who.owner,new Date(Date.now()-60000).toISOString()).first<{count:number}>();
      if((recent?.count||0)>20)return json({error:"Please wait a minute before starting more research."},429);
      const answer=answerQuestion(corpus,input.question.trim(),input.topic);
      await database().prepare("INSERT INTO research_runs(id,owner,question,result,created_at) VALUES(?,?,?,?,?)").bind(answer.id,who.owner,answer.question,JSON.stringify(answer),answer.createdAt).run();return json(answer);
    }
    if(path==="research/history"){
      const rows=await database().prepare("SELECT result FROM research_runs WHERE owner=? ORDER BY created_at DESC LIMIT 20").bind(who.owner).all<{result:string}>();return json(rows.results.map(r=>JSON.parse(r.result)));
    }
    if(path==="saved"&&request.method==="GET")return json(await saved(who.owner));
    if(path==="saved"&&request.method==="POST"){
      const input:any=await request.json();const cached=await database().prepare("SELECT data FROM provider_cache WHERE key='issuer-announcements'").first<{data:string}>();const records=cached?JSON.parse(cached.data).records:[];const ids=new Set([...corpus.evidence.map(e=>e.id),...corpus.documents.map(d=>d.id),...buildFeed(corpus).map(f=>f.id),...records.flatMap((r:any)=>[r.id,`filing-${r.id}`])]);
      if(!ids.has(input.id))return json({error:"Unknown source or filing"},400);
      if(input.saved)await database().prepare("INSERT OR IGNORE INTO saved_items(owner,item_id,created_at) VALUES(?,?,?)").bind(who.owner,input.id,new Date().toISOString()).run();
      else await database().prepare("DELETE FROM saved_items WHERE owner=? AND item_id=?").bind(who.owner,input.id).run();return json(await saved(who.owner));
    }
    if(path==="alert-rules"&&request.method==="GET")return json(await getRules(who.owner));
    if(path==="alert-rules"&&request.method==="PUT"){
      const r:any=await request.json();const allowed=["results","M&A","management_change","capex","earnings_call","litigation","dividend","fund_raise","credit_rating"];
      if(typeof r.enabled!=="boolean"||!Number.isFinite(r.priceThreshold)||r.priceThreshold<0.1||r.priceThreshold>50||!Number.isFinite(r.volumeThreshold)||r.volumeThreshold<1||r.volumeThreshold>20||!Array.isArray(r.categories)||r.categories.some((c:unknown)=>typeof c!=="string"||!allowed.includes(c)))return json({error:"Use a price threshold of 0.1–50%, volume of 1–20×, and supported categories."},400);
      const rules:Rules={priceThreshold:r.priceThreshold,volumeThreshold:r.volumeThreshold,categories:[...new Set(r.categories)] as string[],enabled:r.enabled,version:crypto.randomUUID()};
      await database().prepare("INSERT INTO preferences(owner,rules,updated_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET rules=excluded.rules,updated_at=excluded.updated_at").bind(who.owner,JSON.stringify(rules),new Date().toISOString()).run();return json(rules);
    }
    if(path.startsWith("evidence/")){const e=corpus.evidence.find(e=>e.id===path.slice(9));return e?json({...e,document:corpus.documents.find(d=>d.id===e.documentId)}):json({error:"Evidence not found"},404);}
    if(path==="refresh"&&request.method==="POST"){
      const old=await database().prepare("SELECT fetched_at FROM provider_cache WHERE key='source-check'").first<{fetched_at:string}>();if(old&&Date.now()-Date.parse(old.fetched_at)<60000)return json({error:"Source check was just run. Try again in one minute."},429);
      let error:string|undefined;let checked=false;
      try{const r=await fetch("https://www.ril.com/investors/financial-reporting",{signal:AbortSignal.timeout(9000)});if(!r.ok)throw new Error();const html=await r.text();checked=html.toLowerCase().includes("reliance");if(!checked)throw new Error();}catch{error="Issuer page could not be reached. Indexed documents remain available.";}
      const now=new Date().toISOString();await database().prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('source-check',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(JSON.stringify({checked,error}),now).run();
      const [market,filings]=await Promise.all([getMarket(true),getAnnouncements(true)]);
      return json({checked,checkedAt:filings.checkedAt||now,error:error||filings.error,market,feed:[...issuerFeed(filings.records),...buildFeed(corpus)],documents:[...corpus.documents,...issuerDocuments(filings.records)],message:filings.records.length?`Checked issuer announcements: ${filings.records.length} records available. Research remains the verified report/transcript corpus.`:error||filings.error});
    }
    return json({error:"Endpoint not found"},404);
  }catch(e){console.error("FINN API",e);return json({error:"The request could not be completed. Your existing research is safe; please retry."},503);}
}
export const GET=handle;export const POST=handle;export const PUT=handle;
