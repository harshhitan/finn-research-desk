import {database} from "../repository";
import {privateCodexConfig} from "./private-config";
import {portfolioDocument,passagesFor,instructions,validateAnalysis,persistVerifiedAnalysis} from "./analysis";
type Job={id:string;owner:string;filing_id:string;content_hash:string;model:string;attempts:number;lease:string;lease_until:string};
export async function privateWorkerAction(action:string,body:any){
  const config=privateCodexConfig();if(!config)throw new Error("ChatGPT personal worker is not configured");
  const db=database(),now=new Date().toISOString();
  await db.prepare("INSERT INTO portfolio_private_worker(owner,last_seen) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET last_seen=excluded.last_seen").bind(config.owner,now).run();
  if(action==="claim"){
    await db.prepare("UPDATE portfolio_private_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'retry' END,available_at=?,lease=NULL,lease_until=NULL,error='Personal worker lease expired' WHERE owner=? AND status='running' AND lease_until<?").bind(now,config.owner,now).run();
    const lease=crypto.randomUUID(),until=new Date(Date.now()+600000).toISOString();
    const job=await db.prepare("UPDATE portfolio_private_jobs SET status='running',attempts=attempts+1,lease=?,lease_until=?,error=NULL WHERE id=(SELECT id FROM portfolio_private_jobs WHERE owner=? AND model=? AND status IN ('queued','retry') AND available_at<=? AND NOT EXISTS(SELECT 1 FROM portfolio_private_jobs WHERE owner=? AND status='running') ORDER BY created_at LIMIT 1) RETURNING *").bind(lease,until,config.owner,config.model,now,config.owner).first<Job>();
    if(!job)return {job:null};
    try{
      const content=await portfolioDocument(job.filing_id);if(content.contentHash!==job.content_hash)throw new Error("This document changed; request a fresh analysis");
      const passages=passagesFor(content);if(!passages.length)throw new Error("No readable filing passages");
      return {job:{id:job.id,lease,filingId:job.filing_id,model:job.model,contentHash:job.content_hash,instructions,input:{documentId:job.filing_id,sourceUrl:content.sourceUrl,passages}}};
    }catch(error){await failJob(job);throw error;}
  }
  if(!body||typeof body.id!=="string"||typeof body.lease!=="string")throw new Error("Model worker result is missing its lease");
  const job=await db.prepare("SELECT * FROM portfolio_private_jobs WHERE id=? AND owner=? AND model=? AND lease=? AND status='running' AND lease_until>?").bind(body.id,config.owner,config.model,body.lease,now).first<Job>();
  if(!job)throw new Error("Model worker lease is invalid or expired");
  if(action==="failed"){await failJob(job);return {accepted:true};}
  if(action!=="complete")throw new Error("Model worker operation is unknown");
  try{
    const content=await portfolioDocument(job.filing_id);if(content.contentHash!==job.content_hash)throw new Error("This document changed; request a fresh analysis");
    const analysis=validateAnalysis(body.analysis,passagesFor(content),job.model,job.content_hash);
    await persistVerifiedAnalysis(job.owner,job.filing_id,analysis);
    await db.prepare("UPDATE portfolio_private_jobs SET status='done',finished_at=?,lease=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease=?").bind(new Date().toISOString(),job.id,job.lease).run();
    return {accepted:true,filingId:job.filing_id,claims:analysis.claims.length,metrics:analysis.metrics.length};
  }catch(error){await failJob(job);throw error;}
}
async function failJob(job:Job){await database().prepare("UPDATE portfolio_private_jobs SET status=?,available_at=?,lease=NULL,lease_until=NULL,error='Personal analysis failed or its evidence did not validate' WHERE id=? AND lease=? AND status='running'").bind(job.attempts>=3?"failed":"retry",new Date(Date.now()+job.attempts*60000).toISOString(),job.id,job.lease).run();}
