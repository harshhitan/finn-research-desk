import {database} from "../repository";
import {privateCodexConfig} from "./private-config";
import {companies,companyByTicker} from "./companies";
import {ensurePortfolio,sourceState} from "./storage";
import {nseFilings,quoteFor,digest,boundedText,rssUrl,parseNseRss,classify,safeAttachment} from "./sources";
import {categories,type Filing,type MonitoringRules,type Quote} from "./types";
import {queueAutomaticInterpretations} from './automatic';
import {analysisBriefSql} from './projections';

export const defaultMonitoringRules:Omit<MonitoringRules,"version">={enabled:true,priceThreshold:5,volumeThreshold:2,categories:["results","M&A","management_change","fund_raise","litigation","capex","credit_rating","pledging"],tickers:companies.map(c=>c.ticker),minimumPriority:"medium"};
const rank={high:0,medium:1,routine:2};
export async function monitoringRules(owner:string):Promise<MonitoringRules>{
  const db=database();let row=await db.prepare("SELECT data FROM portfolio_rules WHERE owner=?").bind(owner).first<{data:string}>();
  if(!row){const rules={...defaultMonitoringRules,version:crypto.randomUUID()};await db.prepare("INSERT OR IGNORE INTO portfolio_rules(owner,data,updated_at) VALUES(?,?,?)").bind(owner,JSON.stringify(rules),new Date().toISOString()).run();row=await db.prepare("SELECT data FROM portfolio_rules WHERE owner=?").bind(owner).first<{data:string}>();}
  return JSON.parse(row!.data);
}
export function validRules(r:any){return r&&typeof r.enabled==="boolean"&&Number.isFinite(r.priceThreshold)&&r.priceThreshold>=.1&&r.priceThreshold<=50&&Number.isFinite(r.volumeThreshold)&&r.volumeThreshold>=1&&r.volumeThreshold<=20&&Array.isArray(r.categories)&&r.categories.every((c:any)=>categories.includes(c))&&Array.isArray(r.tickers)&&r.tickers.length<=20&&r.tickers.every((t:any)=>!!companyByTicker(t))&&["high","medium","routine"].includes(r.minimumPriority);}
export async function saveMonitoringRules(owner:string,input:unknown){if(!validRules(input))throw new Error("Invalid monitoring preferences");const rules={...(input as MonitoringRules),version:crypto.randomUUID()};await database().prepare("INSERT INTO portfolio_rules(owner,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(owner,JSON.stringify(rules),new Date().toISOString()).run();return rules;}
export function triggers(rules:MonitoringRules,quote:Quote|null,filings:Filing[],updatedAt:string,now=new Date()){
  if(!rules.enabled)return [];
  const out:{key:string;ticker:string;type:string;title:string;reason:string;sourceUrl:string;filingId?:string;sessionDate?:string}[]=[];
  if(quote&&rules.tickers.includes(quote.ticker)&&Date.parse(quote.fetchedAt)>=Date.parse(updatedAt)&&now.getTime()-Date.parse(quote.sessionDate)<7*86400000&&!quote.split){
    if(quote.movePct!=null&&Math.abs(quote.movePct)>=rules.priceThreshold)out.push({key:`price:${quote.ticker}:${quote.sessionDate}:${rules.version}`,ticker:quote.ticker,type:"price",title:`${quote.ticker} closed ${quote.movePct>=0?"+":""}${quote.movePct.toFixed(2)}%`,reason:`Completed session ${quote.sessionDate}; threshold ±${rules.priceThreshold}%.`,sourceUrl:quote.sourceUrl,sessionDate:quote.sessionDate});
    if(quote.volumeMultiple!=null&&quote.volumeMultiple>=rules.volumeThreshold)out.push({key:`volume:${quote.ticker}:${quote.sessionDate}:${rules.version}`,ticker:quote.ticker,type:"volume",title:`${quote.ticker}: ${quote.volumeMultiple.toFixed(2)}× volume`,reason:`Versus the previous 20 valid completed sessions, excluding ${quote.sessionDate}; threshold ${rules.volumeThreshold}×.`,sourceUrl:quote.sourceUrl,sessionDate:quote.sessionDate});
  }
  for(const f of filings)if(rules.tickers.includes(f.ticker)&&rules.categories.includes(f.category)&&rank[f.priority]<=rank[rules.minimumPriority]&&Date.parse(f.firstSeenAt)>=Date.parse(updatedAt)&&Date.parse(f.publishedAt)>=now.getTime()-86400000&&Date.parse(f.publishedAt)<=now.getTime())out.push({key:`filing:${f.id}:${rules.version}`,ticker:f.ticker,type:"announcement",title:`${f.ticker}: ${f.title}`,reason:f.description.slice(0,350)||"New exchange disclosure. Inspect the original for its scope.",sourceUrl:f.attachmentUrl||f.sourceUrl,filingId:f.id});
  return out;
}
async function evaluate(ticker:string,quote:Quote|null,filings:Filing[]){
  const db=database();const users=await db.prepare("SELECT owner,data,updated_at FROM portfolio_rules").all<{owner:string;data:string;updated_at:string}>();
  for(const user of users.results){const rules=JSON.parse(user.data) as MonitoringRules;
    for(const t of triggers(rules,quote,filings,user.updated_at))await db.prepare("INSERT OR IGNORE INTO portfolio_alerts(owner,trigger_key,ticker,data,created_at) VALUES(?,?,?,?,?)").bind(user.owner,t.key,ticker,JSON.stringify(t),new Date().toISOString()).run();
  }
}
let seeded:Promise<void>|undefined;
export async function seedPortfolio(){if(!seeded)seeded=(async()=>{await ensurePortfolio();const db=database();await db.batch(companies.map(c=>db.prepare("INSERT INTO portfolio_companies(ticker,data) VALUES(?,?) ON CONFLICT(ticker) DO UPDATE SET data=excluded.data").bind(c.ticker,JSON.stringify(c))));})().catch(e=>{seeded=undefined;throw e;});return seeded;}
export async function enqueueCollection(force=false){
  const db=database(),now=new Date(),bucket=Math.floor(now.getTime()/(15*60000));
  for(const c of companies){const prior=await db.prepare("SELECT last_success FROM portfolio_sources WHERE ticker=? AND source='NSE announcements'").bind(c.ticker).first<{last_success:string}>();if(!force&&prior?.last_success&&now.getTime()-Date.parse(prior.last_success)<14*60000)continue;
    await db.prepare("INSERT OR IGNORE INTO portfolio_jobs(id,ticker,kind,status,created_at,available_at) SELECT ?,?,'collect','queued',?,? WHERE NOT EXISTS(SELECT 1 FROM portfolio_jobs WHERE ticker=? AND kind='collect' AND status IN ('queued','retry','running'))").bind(`collect:${c.ticker}:${bucket}${force?':manual:'+Math.floor(now.getTime()/60000):''}`,c.ticker,now.toISOString(),now.toISOString(),c.ticker).run();
  }
}
export async function storeFilings(filings:Filing[]){
  const db=database(),added:Filing[]=[];
  for(const incoming of filings){
    // Exchange IDs are stable. An identical attachment posted under a second
    // ID links to the first record; amendments with a new PDF stay separate.
    const prior=await db.prepare("SELECT data FROM portfolio_filings WHERE id=? OR (ticker=? AND attachment_url=? AND attachment_url IS NOT NULL) LIMIT 1").bind(incoming.id,incoming.ticker,incoming.attachmentUrl).first<{data:string}>();
    if(prior){const existing=JSON.parse(prior.data) as Filing;
      if(existing.id===incoming.id&&(existing.category!==incoming.category||existing.priority!==incoming.priority||existing.description!==incoming.description)){
        const updated={...incoming,firstSeenAt:existing.firstSeenAt};await db.prepare("UPDATE portfolio_filings SET data=? WHERE id=?").bind(JSON.stringify(updated),existing.id).run();
      }
      continue;
    }
    const result=await db.prepare("INSERT OR IGNORE INTO portfolio_filings(id,ticker,published_at,attachment_url,data,first_seen) VALUES(?,?,?,?,?,?)").bind(incoming.id,incoming.ticker,incoming.publishedAt,incoming.attachmentUrl,JSON.stringify(incoming),incoming.firstSeenAt).run();
    if(result.meta.changes)added.push(incoming);
  }
  return added;
}
async function collect(ticker:string){
  const company=companyByTicker(ticker);if(!company)throw new Error("Unknown portfolio ticker");const db=database();let quote:Quote|null=null,failures:string[]=[];
  try{quote=await quoteFor(company);await db.prepare("INSERT INTO portfolio_prices(ticker,session_date,data) VALUES(?,?,?) ON CONFLICT(ticker,session_date) DO UPDATE SET data=excluded.data").bind(ticker,quote.sessionDate,JSON.stringify(quote)).run();await sourceState(ticker,"Yahoo EOD",true,"Completed daily sessions; not a real-time feed");}catch(error){const reason=error instanceof Error?error.message.slice(0,160):"EOD provider unavailable";failures.push("EOD provider unavailable");await sourceState(ticker,"Yahoo EOD",false,"Last successful sessions are retained",`${reason}; retry scheduled`);}
  let fresh:Filing[]=[];
  try{
    const previous=await db.prepare("SELECT last_success FROM portfolio_sources WHERE ticker=? AND source='NSE announcements'").bind(ticker).first<{last_success:string}>();const now=new Date();const from=new Date(Math.max(now.getTime()-30*86400000,previous?.last_success?Date.parse(previous.last_success)-2*86400000:0)).toISOString();
    fresh=await storeFilings(await nseFilings(company,from,now.toISOString()));await sourceState(ticker,"NSE announcements",true,`NSE API; ${from.slice(0,10)} to ${now.toISOString().slice(0,10)}; two-day overlap after successful collection`);
  }catch{
    failures.push("NSE historical feed unavailable");
    try{
      const cache=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key='portfolio-nse-rss'").first<{data:string;fetched_at:string}>();let xml=cache&&Date.now()-Date.parse(cache.fetched_at)<300000?cache.data:"";
      if(!xml){xml=await boundedText(await fetch(rssUrl,{signal:AbortSignal.timeout(12000)}));await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('portfolio-nse-rss',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(xml,new Date().toISOString()).run();}
      const now=new Date().toISOString();const records:Filing[]=[];
      for(const row of parseNseRss(xml,company)){const attachmentUrl=safeAttachment(row.url);const id=`nse-rss-${await digest(ticker+"|"+row.url+"|"+row.publishedAt)}`;records.push({id,ticker,exchangeId:id,title:row.description.slice(0,180)||row.title,description:row.description,...classify(row.description),publishedAt:row.publishedAt,attachmentUrl,sourceUrl:rssUrl,fetchedAt:now,firstSeenAt:now,datePrecision:"second"});}
      fresh=await storeFilings(records);await sourceState(ticker,"NSE announcements",false,"Latest exchange RSS only; historical backfill incomplete","NSE API unavailable; RSS fallback collected. Backfill retry scheduled.");
    }catch{await sourceState(ticker,"NSE announcements",false,"Previous records retained; new disclosures may be missing","Both exchange API and RSS unavailable; retry scheduled");}
  }
  await evaluate(ticker,quote,fresh);
  const autoOwner=privateCodexConfig()?.owner;if(autoOwner)await queueAutomaticInterpretations(autoOwner,fresh,quote?[quote]:[]);
  if(failures.length)throw new Error(failures.join("; "));
}
export async function runJobs(limit=2,analyse?:(owner:string,filingId:string)=>Promise<unknown>,options:{kind?:"collect"}={}){
  await ensurePortfolio();const db=database(),token=crypto.randomUUID(),now=new Date().toISOString(),kind=options.kind||null;
  const lock=await db.prepare("INSERT INTO portfolio_locks(name,token,expires_at) VALUES('collector',?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE portfolio_locks.expires_at<? RETURNING token").bind(token,new Date(Date.now()+180000).toISOString(),now).first<{token:string}>();
  if(lock?.token!==token)return {busy:true,processed:0};let processed=0;const started=Date.now();
  try{
    await db.prepare("UPDATE portfolio_jobs SET status='retry',available_at=?,lease_until=NULL,error='Worker lease expired; recovered' WHERE status='running' AND lease_until<? AND (? IS NULL OR kind=?)").bind(now,now,kind,kind).run();
    for(let i=0;i<Math.min(4,Math.max(1,limit));i++){
      if(Date.now()-started>45000)break;
      const job=await db.prepare("UPDATE portfolio_jobs SET status='running',attempts=attempts+1,lease_until=? WHERE id=(SELECT id FROM portfolio_jobs WHERE status IN ('queued','retry') AND available_at<=? AND (? IS NULL OR kind=?) ORDER BY created_at LIMIT 1) RETURNING id,ticker,kind,attempts,payload").bind(new Date(Date.now()+120000).toISOString(),new Date().toISOString(),kind,kind).first<{id:string;ticker:string;kind:string;attempts:number;payload:string|null}>();if(!job)break;
      try{if(job.kind==="collect")await collect(job.ticker);else if(analyse){const p=JSON.parse(job.payload||"{}");await analyse(p.owner,p.filingId);}else throw new Error("Model processor unavailable");await db.prepare("UPDATE portfolio_jobs SET status='done',finished_at=?,lease_until=NULL,error=NULL WHERE id=?").bind(new Date().toISOString(),job.id).run();}
      catch(error){const reason=error instanceof Error?error.message:"Provider processing failed";await db.prepare("UPDATE portfolio_jobs SET status=?,available_at=?,lease_until=NULL,error=?,finished_at=? WHERE id=?").bind(job.attempts>=3?"failed":"retry",new Date(Date.now()+Math.min(30,2**job.attempts)*60000).toISOString(),reason.slice(0,240),job.attempts>=3?new Date().toISOString():null,job.id).run();}
      processed++;
      await db.prepare("UPDATE portfolio_locks SET expires_at=? WHERE name='collector' AND token=?").bind(new Date(Date.now()+180000).toISOString(),token).run();
    }
  }finally{await db.prepare("DELETE FROM portfolio_locks WHERE name='collector' AND token=?").bind(token).run();}
  return {busy:false,processed};
}
export async function portfolioSnapshot(owner:string,from:string,to:string,ticker?:string,analysisOwner=owner){
  const db=database();const [rules,prices,filings,sources,jobs,alerts,analyses]=await Promise.all([
    monitoringRules(owner),db.prepare("SELECT p.data FROM portfolio_prices p WHERE session_date=(SELECT MAX(session_date) FROM portfolio_prices WHERE ticker=p.ticker)").all<{data:string}>(),
    db.prepare("SELECT data FROM portfolio_filings WHERE published_at>=? AND published_at<=? AND (? IS NULL OR ticker=?) ORDER BY published_at DESC LIMIT 501").bind(from,to,ticker||null,ticker||null).all<{data:string}>(),
    db.prepare("SELECT * FROM portfolio_sources").all(),db.prepare("SELECT status,COUNT(*) AS count FROM portfolio_jobs WHERE kind='collect' GROUP BY status").all(),
    db.prepare("SELECT trigger_key,data,created_at,read_at FROM portfolio_alerts WHERE owner=? ORDER BY created_at DESC LIMIT 100").bind(owner).all<{trigger_key:string;data:string;created_at:string;read_at:string|null}>(),
    db.prepare(`SELECT a.filing_id,${analysisBriefSql} AS data FROM portfolio_analysis a LEFT JOIN portfolio_filings f ON f.id=a.filing_id WHERE a.owner=? AND ((f.published_at>=? AND f.published_at<=?) OR a.filing_id LIKE 'market:%') ORDER BY a.updated_at DESC LIMIT 500`).bind(analysisOwner,from,to).all<{filing_id:string;data:string}>(),
  ]);
  const feed=filings.results.slice(0,500).map(r=>{const f=JSON.parse(r.data) as Filing;return {...f,...classify(f.title+" "+f.description)};}).sort((a,b)=>rank[a.priority]-rank[b.priority]||b.publishedAt.localeCompare(a.publishedAt));
  return {companies,quotes:prices.results.map(r=>JSON.parse(r.data)),filings:feed,window:{from,to,truncated:filings.results.length>500},sources:sources.results,jobs:jobs.results,rules,alerts:alerts.results.map(a=>({...JSON.parse(a.data),id:a.trigger_key,createdAt:a.created_at,readAt:a.read_at})),analyses:Object.fromEntries(analyses.results.map(a=>[a.filing_id,JSON.parse(a.data)])),serverTime:new Date().toISOString()};
}
