import {env} from "cloudflare:workers";
import {database} from "../repository";
import {company,coverage,documents,enqueuePreparation,hash,parse,refreshQuestion,researchInstructions,seedResearch,stamp,validateResearchAnswer,sourceVersion} from "./store";
import {seedResearchCompanies,type ResearchPassage} from "./types";

const environment=()=>env as unknown as Record<string,any>;
export const artifacts=()=>environment().BUCKET as R2Bucket|undefined;
export async function workerAuthorised(request:Request){
  const a=request.headers.get("X-Finn-Job-Token")||"",b=environment().FINN_MONITOR_JOB_TOKEN||"";
  if(!a||!b)return false;
  const [aa,bb]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa.charCodeAt(i)^bb.charCodeAt(i);return diff===0;
}
async function leased(body:any){
  const job=await database().prepare("SELECT * FROM research_jobs WHERE id=? AND lease=? AND lease_until>? AND status='running'").bind(String(body.jobId||""),String(body.lease||""),stamp()).first<any>();
  if(!job)throw new Error("Research job lease is missing or expired");return job;
}
const identifier=(value:any)=>typeof value==="string"&&/^[a-zA-Z0-9:_-]{1,200}$/.test(value);
const contentHash=(value:any)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const text=(v:any,max:number)=>typeof v==="string"&&v.length<=max;

export async function putArtifact(request:Request,jobId:string,digest:string,format:string){
  await leased({jobId,lease:request.headers.get("X-Finn-Job-Lease")});
  if(!contentHash(digest)||!["pdf","jsonl"].includes(format))throw new Error("Invalid document artifact");
  const size=Number(request.headers.get("content-length"));if(!Number.isFinite(size)||size<1||size>64*1024*1024)return new Response("Artifact exceeds upload limit",{status:413});
  const bucket=artifacts();if(!bucket)return new Response("Research file storage is not configured",{status:503});
  const key=`research/${digest.slice(0,2)}/${digest}.${format}`;
  await bucket.put(key,request.body,{httpMetadata:{contentType:format==="pdf"?"application/pdf":"application/x-ndjson"}});
  return Response.json({key});
}
export async function researchWorkerAction(action:string,body:any){
  const db=database(),now=stamp(),owner=environment().FINN_PRIVATE_CODEX_OWNER;
  if(!owner)throw new Error("Research worker owner is not configured");
  if(action==="heartbeat"){
    const data={memoryAvailableMb:Number(body.memoryAvailableMb)||0,workerVersion:String(body.workerVersion||"").slice(0,40),modelEnabled:body.modelEnabled===true,lastChildPeakMb:Number(body.lastChildPeakMb)||0};
    await db.prepare("INSERT INTO research_worker(id,last_seen,model_ready,data) VALUES('vm',?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,model_ready=excluded.model_ready,data=excluded.data").bind(now,body.modelReady===true?1:0,JSON.stringify(data)).run();return {ok:true};
  }
  if(action==="bootstrap"){
    await seedResearch();const jobs=[];
    for(const seed of seedResearchCompanies){const c=await company(seed.ticker);if(c?.status==="registered")jobs.push(await enqueuePreparation(seed.ticker,owner));}
    return {jobs,seedCount:seedResearchCompanies.length};
  }
  if(action==="claim"){
    // One preparation job at a time, with recovery after process/VM loss.
    await db.prepare("UPDATE research_jobs SET status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'retry' END,lease=NULL,lease_until=NULL,error='Document worker lease expired',available_at=?,updated_at=? WHERE status='running' AND lease_until<?").bind(now,now,now).run();
    if(await db.prepare("SELECT id FROM research_jobs WHERE status='running' AND lease_until>? LIMIT 1").bind(now).first())return {job:null};
    const lease=crypto.randomUUID();
    const job=await db.prepare("UPDATE research_jobs SET status='running',stage='Discovering primary documents',lease=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM research_jobs WHERE kind='prepare' AND status IN ('queued','retry') AND available_at<=? ORDER BY created_at LIMIT 1) AND status IN ('queued','retry') RETURNING *").bind(lease,new Date(Date.now()+600000).toISOString(),now,now).first<any>();
    return {job:job?{...job,company:await company(job.ticker)}:null};
  }
  if(action==="question/claim"){
    const state=await db.prepare("SELECT model_ready,last_seen FROM research_worker WHERE id='vm'").first<any>();
    if(!state||state.model_ready!==1||Date.now()-Date.parse(state.last_seen)>300000)return {question:null};
    // Model work is user-requested only. Expired inference is not automatically
    // repeated, since that could consume subscription usage twice.
    await db.prepare("UPDATE research_questions SET status='error',error='Model worker stopped before a verified answer. Retry explicitly.',lease=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND lease_until<?").bind(now,now).run();
    if(await db.prepare("SELECT id FROM research_questions WHERE status='running' LIMIT 1").first())return {question:null};
    const candidates=await db.prepare("SELECT id FROM research_questions WHERE owner=? AND status IN ('waiting_model','queued') ORDER BY created_at LIMIT 5").bind(owner).all<{id:string}>();
    for(const q of candidates.results)await refreshQuestion(q.id,owner);
    const lease=crypto.randomUUID();
    const q=await db.prepare("UPDATE research_questions SET status='running',lease=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM research_questions WHERE owner=? AND status='queued' AND attempts=0 ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *").bind(lease,new Date(Date.now()+240000).toISOString(),now,owner).first<any>();
    return {question:q?{id:q.id,lease:q.lease,model:environment().FINN_PRIVATE_CODEX_MODEL,instructions:researchInstructions,input:{company:await company(q.ticker),question:q.question,filters:parse(q.filters,{}),coverage:await coverage(q.ticker),passages:parse(q.context,[])}}:null};
  }
  if(action==="question/complete"||action==="question/failed"){
    const q=await db.prepare("SELECT * FROM research_questions WHERE id=? AND owner=? AND status='running' AND lease=? AND lease_until>?").bind(String(body.id||""),owner,String(body.lease||""),now).first<any>();
    if(!q)throw new Error("Research question lease is missing or expired");
    if(action.endsWith("failed")){
      await db.prepare("UPDATE research_questions SET status='error',error='Model request failed or its answer did not validate. Your evidence remains available; retry explicitly.',lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease=?").bind(now,q.id,q.lease).run();return {accepted:true};
    }
    if(await sourceVersion(q.ticker)!==q.source_version)throw new Error("Research evidence changed during analysis; retry against the new document versions");
    const answer=validateResearchAnswer(body.answer,parse<ResearchPassage[]>(q.context,[]),String(environment().FINN_PRIVATE_CODEX_MODEL||"Codex"));
    await db.prepare("UPDATE research_questions SET status='done',answer=?,error=NULL,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease=? AND status='running'").bind(JSON.stringify(answer),now,q.id,q.lease).run();return {accepted:true};
  }
  const job=await leased(body);
  if(action==="document/known"){
    if(!contentHash(body.hash)||!text(body.parser,100)||!["annual_report","earnings_call"].includes(body.type))throw new Error("Invalid document cache lookup");
    const known=await db.prepare("SELECT d.id,v.id AS version_id,v.artifact_key,v.page_count,v.readable_pages,v.chunk_count FROM research_documents d JOIN research_document_versions v ON v.id=d.active_version WHERE d.ticker=? AND d.type=? AND v.content_hash=? AND v.parser=? LIMIT 1").bind(job.ticker,body.type,body.hash,body.parser).first<any>();
    return {known:!!known&&!!await artifacts()?.head(known.artifact_key),document:known};
  }
  if(action==="progress"){
    const progress=body.progress&&typeof body.progress==="object"?body.progress:{};
    if(JSON.stringify(progress).length>12000||!text(body.stage,200))throw new Error("Invalid research progress");
    await db.prepare("UPDATE research_jobs SET stage=?,progress=?,lease_until=?,updated_at=? WHERE id=? AND lease=?").bind(body.stage,JSON.stringify(progress),new Date(Date.now()+600000).toISOString(),now,job.id,job.lease).run();return {ok:true};
  }
  if(action==="document/start"){
    const d=body.document;
    if(!d||!text(d.title,400)||!text(d.period,80)||!["annual_report","earnings_call"].includes(d.type)||!contentHash(d.hash)||!text(d.parser,100)||!Number.isInteger(d.pages)||d.pages<1||d.pages>2500||!Number.isInteger(d.readablePages)||d.readablePages<1||d.readablePages>d.pages)throw new Error("Invalid research document metadata");
    const url=new URL(d.url);if(url.protocol!=="https:"||url.username||url.password||url.port||url.href.length>3000)throw new Error("Invalid original-document URL");
    const key=`research/${d.hash.slice(0,2)}/${d.hash}.pdf`;
    if(!await artifacts()?.head(key))throw new Error("The original document must be stored before indexing");
    const duplicate=await db.prepare("SELECT d.id,v.id AS version_id FROM research_documents d JOIN research_document_versions v ON v.id=d.active_version WHERE d.ticker=? AND d.type=? AND v.content_hash=? AND v.parser=? LIMIT 1").bind(job.ticker,d.type,d.hash,d.parser).first<any>();
    if(duplicate)return {documentId:duplicate.id,versionId:duplicate.version_id,reused:true};
    const id=await hash(job.ticker+":"+url.href),version=await hash(id+":"+d.hash+":"+d.parser);
    await db.prepare("INSERT INTO research_documents(id,ticker,title,type,period,source_url,status,updated_at) VALUES(?,?,?,?,?,?,'indexing',?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,period=excluded.period,updated_at=excluded.updated_at").bind(id,job.ticker,d.title,d.type,d.period,url.href,now).run();
    const existing=await db.prepare("SELECT status FROM research_document_versions WHERE id=?").bind(version).first<{status:string}>();
    if(existing?.status==="ready"||existing?.status==="partial")return {documentId:id,versionId:version,reused:true};
    await db.prepare("INSERT INTO research_document_versions(id,document_id,content_hash,parser,artifact_key,page_count,readable_pages,chunk_count,status,created_at) VALUES(?,?,?,?,?,?,?,0,'indexing',?) ON CONFLICT(id) DO NOTHING").bind(version,id,d.hash,d.parser,key,d.pages,d.readablePages,now).run();
    return {documentId:id,versionId:version,reused:false};
  }
  if(action==="document/chunks"){
    const version=await db.prepare("SELECT v.* FROM research_document_versions v JOIN research_documents d ON d.id=v.document_id WHERE v.id=? AND d.ticker=? AND v.status='indexing'").bind(String(body.versionId||""),job.ticker).first<any>();
    if(!version||!Array.isArray(body.chunks)||body.chunks.length<1||body.chunks.length>25)throw new Error("Invalid research chunk batch");
    const statements=[];
    for(const chunk of body.chunks){
      if(!Number.isInteger(chunk.ordinal)||chunk.ordinal<0||chunk.ordinal>30000||!Number.isInteger(chunk.page)||chunk.page<1||chunk.page>version.page_count||!text(chunk.heading,300)||!text(chunk.text,5000)||chunk.text.trim().length<30)throw new Error("Invalid research passage");
      const id=version.id+":"+chunk.ordinal;
      statements.push(db.prepare("INSERT INTO research_chunks(id,version_id,document_id,ticker,ordinal,page,heading,text) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET page=excluded.page,heading=excluded.heading,text=excluded.text").bind(id,version.id,version.document_id,job.ticker,chunk.ordinal,chunk.page,chunk.heading,chunk.text));
      statements.push(db.prepare("DELETE FROM research_chunk_fts WHERE chunk_id=?").bind(id));
      statements.push(db.prepare("INSERT INTO research_chunk_fts(chunk_id,text,heading) VALUES(?,?,?)").bind(id,chunk.text,chunk.heading));
    }
    await db.batch(statements);return {accepted:body.chunks.length};
  }
  if(action==="document/finish"){
    const version=await db.prepare("SELECT v.* FROM research_document_versions v JOIN research_documents d ON d.id=v.document_id WHERE v.id=? AND d.ticker=?").bind(String(body.versionId||""),job.ticker).first<any>();
    if(!version)throw new Error("Unknown research document version");
    const actual=await db.prepare("SELECT COUNT(*) AS n FROM research_chunks WHERE version_id=?").bind(version.id).first<{n:number}>();
    if(!Number.isInteger(body.chunkCount)||body.chunkCount<1||actual?.n!==body.chunkCount)throw new Error("Research indexing is incomplete");
    const status=version.readable_pages===version.page_count?"ready":"partial";
    await db.batch([db.prepare("UPDATE research_document_versions SET chunk_count=?,status=? WHERE id=?").bind(body.chunkCount,status,version.id),db.prepare("UPDATE research_documents SET active_version=?,status=?,error=NULL,updated_at=? WHERE id=?").bind(version.id,status,now,version.document_id)]);
    return {accepted:true,status};
  }
  if(action==="finish"||action==="failed"){
    const docs=await documents(job.ticker),annual=docs.some(d=>d.active_version&&d.type==="annual_report"),calls=docs.some(d=>d.active_version&&d.type==="earnings_call"),indexed=docs.some(d=>d.active_version);
    const status=action==="failed"?job.attempts>=2?"failed":"retry":"done";
    const error=typeof body.error==="string"?body.error.slice(0,500):null;
    await db.prepare("UPDATE research_jobs SET status=?,stage=?,error=?,lease=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE id=? AND lease=?").bind(status,action==="failed"?"Document preparation needs attention":"Document preparation finished",error,new Date(Date.now()+300000).toISOString(),now,job.id,job.lease).run();
    await db.prepare("UPDATE research_companies SET status=?,error=?,updated_at=? WHERE ticker=?").bind(annual&&calls?"ready":indexed?"partial":status==="retry"?"preparing":"failed",error||(!annual||!calls?"Coverage is incomplete; inspect the available documents and source diagnostics.":null),now,job.ticker).run();
    const qs=await db.prepare("SELECT id,owner FROM research_questions WHERE ticker=? AND status='waiting_documents' LIMIT 20").bind(job.ticker).all<{id:string;owner:string}>();
    for(const q of qs.results)await refreshQuestion(q.id,q.owner);
    return {accepted:true,status,indexed:docs.filter(d=>d.active_version).length};
  }
  throw new Error("Unknown research worker operation");
}
