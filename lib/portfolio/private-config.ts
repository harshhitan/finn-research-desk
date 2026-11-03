import {env} from "cloudflare:workers";
import {database} from "../repository";
export function privateCodexConfig(){
  const e=env as unknown as Record<string,string>;
  return e.FINN_PRIVATE_CODEX_OWNER&&e.FINN_PRIVATE_CODEX_MODEL&&e.FINN_MONITOR_JOB_TOKEN?{owner:e.FINN_PRIVATE_CODEX_OWNER,model:e.FINN_PRIVATE_CODEX_MODEL}:null;
}
export async function privateCodexStatus(owner:string){
  const config=privateCodexConfig();if(!config||config.owner!==owner)return null;
  const state=await database().prepare("SELECT last_seen FROM portfolio_private_worker WHERE owner=?").bind(owner).first<{last_seen:string}>();
  const worker=await database().prepare('SELECT data,fetched_at FROM provider_cache WHERE key=?').bind('finn-model-availability:'+owner).first<{data:string;fetched_at:string}>(),shared=worker&&Date.now()-Date.parse(worker.fetched_at)<300000?JSON.parse(worker.data):null;
  const online=!!shared||!!state&&Date.now()-Date.parse(state.last_seen)<300000;
  return {configured:true,connected:online,mode:"private_codex",model:config.model,modelReady:shared?.modelReady,retryAt:shared?.modelRetryAt||null,connectedAt:shared?worker!.fetched_at:state?.last_seen||null,reason:online?shared?.modelReason||"Your VM worker is online. Portfolio interpretations and requested answers run one at a time using your ChatGPT subscription.":"Your VM worker has not checked in recently. Requested analyses wait until model access and memory are available."};
}
export async function enqueuePrivateAnalysis(owner:string,filingId:string,hash:string,requested=false){
  const config=privateCodexConfig();if(!config||config.owner!==owner)throw new Error("ChatGPT personal worker is not configured for this account");
  if(!requested)return {skipped:true,reason:"Filing analysis runs only when requested"};
  const db=database(),now=new Date().toISOString();
  const existing=await db.prepare("SELECT id,status FROM portfolio_private_jobs WHERE owner=? AND filing_id=? AND content_hash=? AND model=?").bind(owner,filingId,hash,config.model).first<{id:string;status:string}>();
  const active=await db.prepare("SELECT COUNT(*) AS count FROM portfolio_private_jobs j WHERE owner=? AND status IN ('queued','running','retry') AND EXISTS(SELECT 1 FROM provider_cache p WHERE p.key='portfolio-request:'||j.id AND COALESCE(json_extract(p.data,'$.mode'),'manual')!='automatic')").bind(owner).first<{count:number}>();
  if((active?.count||0)>=10&&!existing)throw new Error("ChatGPT personal analysis queue is full. Wait for current jobs to finish.");
  const daily=await db.prepare("SELECT COALESCE(SUM(attempts),0) AS count FROM portfolio_private_jobs WHERE owner=? AND created_at>=?").bind(owner,new Date(Date.now()-86400000).toISOString()).first<{count:number}>();
  if((daily?.count||0)>=100)throw new Error("ChatGPT personal analysis daily limit reached");
  await db.prepare("INSERT INTO portfolio_private_jobs(id,owner,filing_id,content_hash,model,status,created_at,available_at) VALUES(?,?,?,?,?,'queued',?,?) ON CONFLICT(owner,filing_id,content_hash,model) DO UPDATE SET status=CASE WHEN portfolio_private_jobs.status IN ('failed','done') THEN 'queued' ELSE portfolio_private_jobs.status END,available_at=CASE WHEN portfolio_private_jobs.status IN ('failed','done') THEN excluded.available_at ELSE portfolio_private_jobs.available_at END,error=CASE WHEN portfolio_private_jobs.status IN ('failed','done') THEN NULL ELSE portfolio_private_jobs.error END").bind(crypto.randomUUID(),owner,filingId,hash,config.model,now,now).run();
  const job=await db.prepare("SELECT id FROM portfolio_private_jobs WHERE owner=? AND filing_id=? AND content_hash=? AND model=?").bind(owner,filingId,hash,config.model).first<{id:string}>();
  if(!job)throw new Error("Analysis request could not be saved");
  await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind('portfolio-request:'+job.id,JSON.stringify({mode:"manual",version:"portfolio-3",stage:"Queued for requested interpretation",requestedAt:now}),now).run();
  return {queued:true,mode:"private_codex",filingId};
}
