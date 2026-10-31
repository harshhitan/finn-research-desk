import {env} from "cloudflare:workers";
import {database} from "../repository";
export function privateCodexConfig(){
  const e=env as unknown as Record<string,string>;
  return e.FINN_PRIVATE_CODEX_OWNER&&e.FINN_PRIVATE_CODEX_MODEL&&e.FINN_MONITOR_JOB_TOKEN?{owner:e.FINN_PRIVATE_CODEX_OWNER,model:e.FINN_PRIVATE_CODEX_MODEL}:null;
}
export async function privateCodexStatus(owner:string){
  const config=privateCodexConfig();if(!config||config.owner!==owner)return null;
  const state=await database().prepare("SELECT last_seen FROM portfolio_private_worker WHERE owner=?").bind(owner).first<{last_seen:string}>();
  const online=!!state&&Date.now()-Date.parse(state.last_seen)<300000;
  return {configured:true,connected:online,mode:"private_codex",model:config.model,connectedAt:state?.last_seen||null,reason:online?"Your personal Codex worker is online. Analysis runs on your Azure VM using your ChatGPT subscription.":"Your personal Codex worker has not checked in recently. Queued work resumes when the VM worker is available."};
}
export async function enqueuePrivateAnalysis(owner:string,filingId:string,hash:string){
  const config=privateCodexConfig();if(!config||config.owner!==owner)throw new Error("ChatGPT personal worker is not configured for this account");
  const db=database(),now=new Date().toISOString();
  const active=await db.prepare("SELECT COUNT(*) AS count FROM portfolio_private_jobs WHERE owner=? AND status IN ('queued','running','retry')").bind(owner).first<{count:number}>();
  if((active?.count||0)>=10)throw new Error("ChatGPT personal analysis queue is full. Wait for current jobs to finish.");
  const daily=await db.prepare("SELECT COALESCE(SUM(attempts),0) AS count FROM portfolio_private_jobs WHERE owner=? AND created_at>=?").bind(owner,new Date(Date.now()-86400000).toISOString()).first<{count:number}>();
  if((daily?.count||0)>=100)throw new Error("ChatGPT personal analysis daily limit reached");
  await db.prepare("INSERT INTO portfolio_private_jobs(id,owner,filing_id,content_hash,model,status,created_at,available_at) VALUES(?,?,?,?,?,'queued',?,?) ON CONFLICT(owner,filing_id,content_hash,model) DO UPDATE SET status=CASE WHEN portfolio_private_jobs.status='failed' THEN 'queued' ELSE portfolio_private_jobs.status END").bind(crypto.randomUUID(),owner,filingId,hash,config.model,now,now).run();
  return {queued:true,mode:"private_codex",filingId};
}
