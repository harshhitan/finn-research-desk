import {database} from "../repository";
import {privateCodexConfig} from "./private-config";
import {passagesFor,instructions,validateAnalysis,persistVerifiedAnalysis,resultsForFiling} from "./analysis";
import {interpretationSchema,filingPlanner,noticeContent,selectFilingPassages,supportedClaimNumbers} from './interpretation';
import {interpretationSettings,releaseAllowanceWait,saveInterpretationSettings,primeAutomaticInterpretations,readInterpretationRequest,writeInterpretationRequest,filingFingerprint,interpretationVersion,interpretationDay,type InterpretationRequest} from './automatic';
import {digest} from './sources';
import type {Filing,Passage,Quote} from './types';
import type {FilingContent} from '../filing-content';
import {questionKey,questionPassages,questionComparisons} from './questions';
import {researchInstructions,researchAnswerSchema,validateResearchAnswer,recoverVerifiedAnswer} from '../research/store';
import type {ResearchPassage,ResearchCalculation} from '../research/types';
import {validateReportPeriod} from './results';
import type {FilingAnalysis} from './types';

type Job={id:string;owner:string;filing_id:string;content_hash:string;model:string;attempts:number;lease:string;lease_until:string};
type Evidence={content:FilingContent;sourceKind:'pdf'|'notice'|'market';fingerprint?:string;gaps:string[];passages:Passage[];questionContext?:ResearchPassage[];calculations?:ResearchCalculation[]};
const evidenceKey=(id:string)=>'portfolio-job-evidence:'+id;
const now=()=>new Date().toISOString();
async function filing(id:string):Promise<Filing>{const row=await database().prepare('SELECT data FROM portfolio_filings WHERE id=?').bind(id).first<{data:string}>();if(!row)throw new Error('Unknown portfolio filing');return JSON.parse(row.data);}
async function evidence(job:Job):Promise<Evidence|null>{const row=await database().prepare('SELECT data FROM provider_cache WHERE key=?').bind(evidenceKey(job.id)).first<{data:string}>();if(!row)return null;const value=JSON.parse(row.data) as Evidence;if(value.sourceKind==='pdf'){const cache=await database().prepare('SELECT data FROM provider_cache WHERE key=?').bind('portfolio-pdf:'+job.filing_id).first<{data:string}>();if(!cache)return null;const content=JSON.parse(cache.data) as FilingContent;if(content.contentHash!==value.content.contentHash)return null;value.content=content;}return value;}
async function saveEvidence(job:Job,value:Evidence){const stored={...value,content:{...value.content,pages:value.sourceKind==='pdf'?[]:value.content.pages}};await database().prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(evidenceKey(job.id),JSON.stringify(stored),now()).run();}
async function request(job:Job):Promise<InterpretationRequest>{return await readInterpretationRequest(job.id)||{mode:'manual',kind:'filing',version:interpretationVersion,requestedAt:now()};}
async function stage(job:Job,text:string,error:string|null=null){const value=await request(job);await writeInterpretationRequest(job.id,{...value,stage:text,error});await database().prepare("UPDATE portfolio_private_jobs SET lease_until=? WHERE id=? AND lease=? AND status='running'").bind(new Date(Date.now()+900000).toISOString(),job.id,job.lease).run();}
async function payload(job:Job,value:Evidence,meta:InterpretationRequest){
  const f=meta.kind==='market'?null:await filing(job.filing_id);
  if(meta.kind==='question'){
    value.questionContext=questionPassages(f!,value.passages,value.content.contentHash!);await saveEvidence(job,value);
    return {id:job.id,lease:job.lease,filingId:job.filing_id,model:job.model,kind:'filing_question',instructions:researchInstructions.replace('annual-report and earnings-call passages','primary exchange-filing passages')+' Answer the supplied user question about this filing. Notice-based evidence is explicitly limited; keep any missing original-PDF evidence visible.',outputSchema:researchAnswerSchema,planner:{...filingPlanner,instructions:filingPlanner.instructions+' Structure retrieval around the user question, not a generic summary.'},input:{filing:f,question:meta.question,sourceKind:value.sourceKind,evidenceGaps:value.gaps,passages:value.questionContext}};
  }
  return {id:job.id,lease:job.lease,filingId:job.filing_id,model:job.model,contentHash:value.content.contentHash,kind:'filing',instructions,outputSchema:interpretationSchema,...value.sourceKind==='pdf'?{planner:filingPlanner}:{},input:{documentId:job.filing_id,filing:f,sourceKind:value.sourceKind,sourceUrl:value.content.sourceUrl,evidenceGaps:value.gaps,passages:value.passages}};
}
function validateDraft(value:any,e:Evidence,model:string){
  const result=validateAnalysis(value,e.passages,model,e.content.contentHash!);
  for(const claim of result.claims){const supported=new Set(supportedClaimNumbers(claim.quote));if(supportedClaimNumbers(claim.text).some(n=>!supported.has(n)))throw new Error('Model numerical claim is not supported by its own cited quote; remove unsupported arithmetic or extend the exact quote');}
  if(e.sourceKind!=='pdf'&&(result.metrics.length||result.resultPeriod))throw new Error('Model financial tables require verified PDF evidence');
  return result;
}
function verifiedClaim(claim:any,e:Evidence){const p=e.passages.find(p=>p.id===claim?.passageId);if(!p||typeof claim.text!=='string'||claim.text.length>1200||typeof claim.quote!=='string'||claim.quote.length<12||claim.quote.length>1800||!p.text.replace(/\s+/g,' ').includes(claim.quote.replace(/\s+/g,' ')))return false;const numbers=new Set(supportedClaimNumbers(claim.quote));return supportedClaimNumbers(claim.text).every(n=>numbers.has(n));}
export async function privateWorkerAction(action:string,body:any){
  const config=privateCodexConfig();if(!config)throw new Error("ChatGPT personal worker is not configured");
  const db=database(),stamp=now();
  await db.prepare("INSERT INTO portfolio_private_worker(owner,last_seen) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET last_seen=excluded.last_seen").bind(config.owner,stamp).run();
  if(action==='settings')return saveInterpretationSettings(config.owner,body);
  if(action==='inspect'){
    if(typeof body.filingId!=='string'||body.filingId.length>100)throw new Error('Choose a filing to inspect');
    const f=await filing(body.filingId),row=await db.prepare('SELECT data FROM portfolio_analysis WHERE owner=? AND filing_id=?').bind(config.owner,f.id).first<{data:string}>(),pdf=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind('portfolio-pdf:'+f.id).first<{data:string}>(),content=pdf?JSON.parse(pdf.data) as FilingContent:null;
    return {filing:f,analysis:row?JSON.parse(row.data):null,source:content?{contentHash:content.contentHash,pageCount:content.pageCount,passages:selectFilingPassages(passagesFor(content),typeof body.query==='string'?body.query.slice(0,300):'quarter consolidated revenue profit before tax net profit',12)}:null};
  }
  if(action==='recover-capacity'){
    // Operator recovery requires an audited incident, exact affected IDs and
    // rejected-attempt total. A durable receipt prevents repeating the refund.
    if(typeof body.incident!=='string'||!/^[a-z0-9:-]{12,80}$/.test(body.incident)||!/^20\d{2}-\d{2}-\d{2}$/.test(body.day)||!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>50||new Set(body.ids).size!==body.ids.length||body.ids.some((id:any)=>typeof id!=='string'||!/^auto-[a-f0-9]{64}$/.test(id))||!Number.isInteger(body.rejectedAttempts)||body.rejectedAttempts<1)throw new Error('Invalid audited capacity recovery');
    const key='portfolio-capacity-recovery:'+config.owner+':'+body.incident,prior=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(key).first<{data:string}>();if(prior){await releaseAllowanceWait(config.owner);return {...JSON.parse(prior.data),replayed:true};}
    if(await db.prepare("SELECT id FROM portfolio_private_jobs WHERE owner=? AND status='running' LIMIT 1").bind(config.owner).first())throw new Error('Stop the model worker before capacity recovery');
    const rows=await db.prepare(`SELECT j.id,j.attempts FROM portfolio_private_jobs j JOIN provider_cache p ON p.key='portfolio-request:'||j.id WHERE j.owner=? AND j.model=? AND j.id IN (${body.ids.map(()=>'?').join(',')}) AND j.status IN ('failed','queued','retry') AND j.attempts>0 AND json_extract(p.data,'$.mode')='automatic'`).bind(config.owner,config.model,...body.ids).all<{id:string;attempts:number}>();
    if(rows.results.length!==body.ids.length||rows.results.reduce((n,j)=>n+j.attempts,0)!==body.rejectedAttempts)throw new Error('Capacity recovery does not match the observed job attempts');
    const usageKey='portfolio-auto-usage:'+config.owner+':'+body.day,usage=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(usageKey).first<{data:string}>();if(!usage||JSON.parse(usage.data).count<body.rejectedAttempts)throw new Error('Capacity recovery exceeds the recorded allowance');
    const receipt={accepted:true,incident:body.incident,day:body.day,recovered:rows.results.length,refunded:body.rejectedAttempts,at:stamp};
    await db.batch([
      db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?)').bind(key,JSON.stringify(receipt),stamp),
      db.prepare("UPDATE provider_cache SET data=json_set(data,'$.count',json_extract(data,'$.count')-?) WHERE key=?").bind(body.rejectedAttempts,usageKey),
      db.prepare(`UPDATE portfolio_private_jobs SET status='queued',attempts=0,available_at=?,finished_at=NULL,lease=NULL,lease_until=NULL,error=NULL WHERE owner=? AND id IN (${body.ids.map(()=>'?').join(',')})`).bind(stamp,config.owner,...body.ids),
      db.prepare(`UPDATE provider_cache SET data=json_set(data,'$.stage','Queued after verified capacity recovery','$.error',NULL) WHERE key IN (${body.ids.map(()=>'?').join(',')})`).bind(...body.ids.map((id:string)=>'portfolio-request:'+id))
    ]);await releaseAllowanceWait(config.owner);return receipt;
  }
  if(action==='claim'){
    await primeAutomaticInterpretations(config.owner);
    await db.prepare("UPDATE portfolio_private_jobs SET status=CASE WHEN attempts<3 AND EXISTS(SELECT 1 FROM provider_cache p WHERE p.key='portfolio-request:'||portfolio_private_jobs.id AND json_extract(p.data,'$.mode')='automatic') THEN 'retry' ELSE 'failed' END,available_at=?,lease=NULL,lease_until=NULL,error='Analysis interrupted; retry is available' WHERE owner=? AND status='running' AND lease_until<?").bind(stamp,config.owner,stamp).run();
    const settings=await interpretationSettings(config.owner),lease=crypto.randomUUID();
    const job=await db.prepare("UPDATE portfolio_private_jobs SET status='running',attempts=attempts+1,lease=?,lease_until=?,error=NULL WHERE id=(SELECT j.id FROM portfolio_private_jobs j JOIN provider_cache p ON p.key='portfolio-request:'||j.id LEFT JOIN portfolio_filings f ON f.id=j.filing_id WHERE j.owner=? AND j.model=? AND j.status IN ('queued','retry') AND j.available_at<=? AND (json_extract(p.data,'$.mode') IS NOT 'automatic' OR ?=1) AND (json_extract(p.data,'$.mode') IS NOT 'automatic' OR ?=1 OR COALESCE(json_extract(p.data,'$.priority'),json_extract(f.data,'$.priority'))!='routine') AND NOT EXISTS(SELECT 1 FROM portfolio_private_jobs WHERE owner=? AND status='running') ORDER BY CASE WHEN json_extract(p.data,'$.kind')='question' THEN 0 WHEN json_extract(p.data,'$.mode')='automatic' THEN 2 ELSE 1 END,CASE COALESCE(json_extract(p.data,'$.priority'),json_extract(f.data,'$.priority')) WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,COALESCE(f.published_at,j.created_at) DESC LIMIT 1) RETURNING *").bind(lease,new Date(Date.now()+900000).toISOString(),config.owner,config.model,stamp,settings.enabled?1:0,settings.includeRoutine?1:0,config.owner).first<Job>();
    if(!job)return {job:null};
    const meta=await request(job);
    if(meta.mode==='automatic'){
      const usage=await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,'{\"count\":1}',?) ON CONFLICT(key) DO UPDATE SET data=json_set(provider_cache.data,'$.count',COALESCE(json_extract(provider_cache.data,'$.count'),0)+1),fetched_at=excluded.fetched_at WHERE COALESCE(json_extract(provider_cache.data,'$.count'),0)<? RETURNING data").bind('portfolio-auto-usage:'+config.owner+':'+interpretationDay(),stamp,settings.dailyLimit).first();
      if(!usage){await db.prepare("UPDATE portfolio_private_jobs SET status='queued',attempts=MAX(0,attempts-1),lease=NULL,lease_until=NULL,available_at=? WHERE id=?").bind(interpretationDay()+'T18:30:00.000Z',job.id).run();await writeInterpretationRequest(job.id,{...meta,stage:'Daily automatic budget reached; waiting for the next allowance'});return {job:null};}
      meta.attemptDay=interpretationDay();await writeInterpretationRequest(job.id,meta);
    }
    try{
      let e=await evidence(job);
      if(meta.kind==='market'){
        const row=await db.prepare('SELECT data FROM portfolio_prices WHERE ticker=? AND session_date=?').bind(meta.market!.ticker,meta.market!.sessionDate).first<{data:string}>();if(!row)throw new Error('Market source observation is unavailable');
        const ruleRow=await db.prepare('SELECT data FROM portfolio_rules WHERE owner=?').bind(job.owner).first<{data:string}>(),rules=ruleRow?JSON.parse(ruleRow.data):{priceThreshold:5,volumeThreshold:2};
        const q=JSON.parse(row.data) as Quote,text=`Completed-session market observation\nCompany: ${q.ticker}\nSession: ${q.sessionDate}\nClose: INR ${q.close}\nDaily move: ${q.movePct}%\nVolume: ${q.volume}\nVolume / previous 20 valid sessions: ${q.volumeMultiple} times\nPrice alert threshold: ${rules.priceThreshold}%\nVolume alert threshold: ${rules.volumeThreshold} times\nBaseline sessions: ${q.baselineSessions.join(', ')}\nCorporate-action guard: ${q.split?'comparisons paused':'clear'}\nSource: ${q.sourceUrl}\nNo causal relationship with a disclosure has been established.`;
        const content:FilingContent={documentId:job.filing_id,sourceUrl:q.sourceUrl,status:'ready',contentHash:await digest(text),pages:[{page:0,text}],pageCount:0,extractedAt:stamp};e={content,sourceKind:'market',fingerprint:meta.fingerprint,passages:passagesFor(content),gaps:['Price and volume describe completed sessions. They do not establish why a stock moved.']};
      }else{
        const f=await filing(job.filing_id),fingerprint=await filingFingerprint(f);if(meta.fingerprint&&fingerprint!==meta.fingerprint)throw new Error('This source notice changed; a fresh interpretation will be queued');
        const cached=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind('portfolio-pdf:'+job.filing_id).first<{data:string}>();
        if(cached){const content=JSON.parse(cached.data) as FilingContent;if(e?.sourceKind==='pdf'&&e.content.contentHash!==content.contentHash)e=null;if(!e&&content.contentHash&&content.pages?.length){if(!job.content_hash.startsWith('auto:')&&!job.content_hash.startsWith('question:')&&job.content_hash!==content.contentHash)throw new Error('This document changed; request a fresh analysis');e={content,sourceKind:'pdf',fingerprint,passages:selectFilingPassages(passagesFor(content),f.title+' '+f.description),gaps:[]};}}
        if(!e&&((meta.priority||f.priority)!=='routine'||meta.mode==='manual')&&f.attachmentUrl){await db.prepare('DELETE FROM provider_cache WHERE key>=? AND key<?').bind('portfolio-pages:'+job.id+':','portfolio-pages:'+job.id+':\uffff').run();await stage(job,'Downloading and reading the original filing');return {job:{id:job.id,lease:job.lease,filingId:f.id,model:job.model,prepare:true,sourceUrl:f.attachmentUrl,filing:f}};}
        if(!e){const content=noticeContent(f);content.contentHash=await digest(content.pages[0].text);e={content,sourceKind:'notice',fingerprint,passages:passagesFor(content),gaps:[f.attachmentUrl?'This routine disclosure is interpreted from the exchange notice; the full attachment has not been analysed.':'The exchange supplied no eligible PDF attachment. This interpretation uses the exchange notice.']};}
      }
      await saveEvidence(job,e!);await stage(job,e!.sourceKind==='pdf'?'Retrieving relevant filing evidence':'Interpreting the source notice');return {job:await payload(job,e!,meta)};
    }catch(error){await failJob(job,error instanceof Error?error.message:undefined);throw error;}
  }
  if(typeof body?.id!=='string'||typeof body?.lease!=='string')throw new Error('Model worker result is missing its lease');
  const job=await db.prepare("SELECT * FROM portfolio_private_jobs WHERE id=? AND owner=? AND model=? AND lease=? AND status='running' AND lease_until>?").bind(body.id,config.owner,config.model,body.lease,stamp).first<Job>();if(!job)throw new Error('Model worker lease is invalid or expired');
  if(action==='failed'){
    if(body.reason==='usage_limit'&&typeof body.deferUntil==='string'&&Date.parse(body.deferUntil)>Date.now()&&Date.parse(body.deferUntil)<Date.now()+15*86400000){
      const pending=await request(job);await db.prepare("UPDATE portfolio_private_jobs SET status='queued',attempts=MAX(0,attempts-1),available_at=?,lease=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease=?").bind(body.deferUntil,job.id,job.lease).run();
      if(pending.mode==='automatic')await db.prepare("UPDATE provider_cache SET data=json_set(data,'$.count',MAX(0,COALESCE(json_extract(data,'$.count'),0)-1)) WHERE key=?").bind('portfolio-auto-usage:'+job.owner+':'+(pending.attemptDay||interpretationDay())).run();
      await writeInterpretationRequest(job.id,{...pending,stage:'Waiting for ChatGPT capacity',error:null});return {accepted:true,deferred:true};
    }
    await failJob(job);return {accepted:true};
  }
  const meta=await request(job);
  if(action==='progress'){await stage(job,String(body.stage||'Preparing source evidence').slice(0,100));return {accepted:true};}
  if(action==='evidence'){
    if(!Array.isArray(body.pages)||!body.pages.length||body.pages.length>8||body.pages.some((p:any)=>!Number.isInteger(p.page)||p.page<1||p.page>2500||typeof p.text!=='string'||p.text.length>80000)||JSON.stringify(body.pages).length>180000)throw new Error('Invalid bounded filing page batch');
    await db.batch(body.pages.map((p:any)=>db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind('portfolio-pages:'+job.id+':'+String(p.page).padStart(4,'0'),JSON.stringify(p),stamp)));await stage(job,'Reading the original PDF - page '+Math.max(...body.pages.map((p:any)=>p.page)));return {accepted:true};
  }
  if(action==='prepared'){
    const f=await filing(job.filing_id),gaps:string[]=[];let content:FilingContent,kind:'pdf'|'notice'='pdf';
    if(body.unavailable){content=noticeContent(f);content.contentHash=await digest(content.pages[0].text);kind='notice';gaps.push('The original PDF could not be read. This interpretation uses only the exchange notice.');}
    else{
      if(typeof body.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(body.contentHash)||!Number.isInteger(body.pageCount)||body.pageCount<1||body.pageCount>2500)throw new Error('Filing PDF identity is invalid');
      const rows=await db.prepare('SELECT data FROM provider_cache WHERE key>=? AND key<? ORDER BY key LIMIT 201').bind('portfolio-pages:'+job.id+':','portfolio-pages:'+job.id+':\uffff').all<{data:string}>(),pages=rows.results.map(r=>JSON.parse(r.data));
      if(!pages.length||pages.length>200||pages.length>body.pageCount||new TextEncoder().encode(JSON.stringify(pages)).length>1200000||pages.some((p:any,i:number)=>p.page!==i+1))throw new Error('Filing extraction is incomplete or exceeds its bounded size');
      if(!pages.some((p:any)=>p.text.trim().length>=40))throw new Error('No readable filing pages');
      if(pages.length<body.pageCount)gaps.push('PDF extraction covers the first '+pages.length+' of '+body.pageCount+' pages. Later pages were outside this analysis budget.');
      if(body.clipped)gaps.push('Some PDF text was outside the extraction size budget; inspect the original for complete coverage.');
      if(Number.isInteger(body.unreadablePages)&&body.unreadablePages>0&&body.unreadablePages<=body.pageCount)gaps.push(body.unreadablePages+' PDF pages lacked usable text after bounded extraction/OCR.');
      content={documentId:f.id,sourceUrl:f.attachmentUrl!,status:'ready',contentHash:body.contentHash,pages,pageCount:body.pageCount,extractedAt:stamp};
      await db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind('portfolio-pdf:'+f.id,JSON.stringify(content),stamp).run();
    }
    const e:Evidence={content,sourceKind:kind,fingerprint:await filingFingerprint(f),gaps,passages:selectFilingPassages(passagesFor(content),f.title+' '+f.description)};await saveEvidence(job,e);await db.prepare('DELETE FROM provider_cache WHERE key>=? AND key<?').bind('portfolio-pages:'+job.id+':','portfolio-pages:'+job.id+':\uffff').run();await stage(job,'Retrieving relevant filing evidence');return {job:await payload(job,e,meta)};
  }
  const e=await evidence(job);if(!e)throw new Error('Model filing evidence is unavailable');
  if(meta.fingerprint&&meta.kind!=='market'&&await filingFingerprint(await filing(job.filing_id))!==meta.fingerprint)throw new Error('This source notice changed during analysis');
  if(action==='tools'){
    if(!Array.isArray(body.plan?.queries)||body.plan.queries.length<1||body.plan.queries.length>3||body.plan.queries.some((q:any)=>typeof q!=='string'||q.length>300))throw new Error('Invalid bounded filing evidence plan');
    const all=passagesFor(e.content),selected=new Map(e.passages.map(p=>[p.id,p]));for(const query of body.plan.queries)for(const p of selectFilingPassages(all,query,8))if(selected.size<32)selected.set(p.id,p);
    e.passages=[...selected.values()];
    if(meta.kind==='question'){const data=await questionComparisons(job.owner,await filing(job.filing_id),questionPassages(await filing(job.filing_id),e.passages,e.content.contentHash!));e.questionContext=data.context;e.calculations=data.calculations;}
    await saveEvidence(job,e);await stage(job,'Writing the AI interpretation');
    const comparison=e.sourceKind==='pdf'?await resultsForFiling(job.owner,job.filing_id):null;
    return {passages:meta.kind==='question'?e.questionContext:e.passages,calculations:e.calculations||[],comparison,sourceKind:e.sourceKind,evidenceGaps:e.gaps};
  }
  if(action==='review'){
    await stage(job,'Verifying citations and financial figures');
    try{if(meta.kind==='question')validateResearchAnswer(body.analysis,e.questionContext||[],job.model,e.calculations||[]);else validateDraft(body.analysis,e,job.model);return {valid:true};}catch(error){return {valid:false,issue:(error as Error).message.slice(0,1000)};}
  }
  if(action!=='complete')throw new Error('Model worker operation is unknown');
  try{
    if(meta.kind==='question'){
      const answer=recoverVerifiedAnswer(body.analysis,e.questionContext||[],job.model,e.calculations||[]),key=questionKey(job.owner,meta.questionId!),row=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(key).first<{data:string}>();if(!row)throw new Error('Filing question was not found');
      await db.prepare('UPDATE provider_cache SET data=?,fetched_at=? WHERE key=?').bind(JSON.stringify({...JSON.parse(row.data),answer,context:e.questionContext,status:'done'}),now(),key).run();await stage(job,'Answer and citations verified');await db.prepare("UPDATE portfolio_private_jobs SET status='done',finished_at=?,lease=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease=?").bind(now(),job.id,job.lease).run();return {accepted:true};
    }
    let analysis;
    try{analysis=validateDraft(body.analysis,e,job.model);}catch{
      const claims=(Array.isArray(body.analysis?.claims)?body.analysis.claims:[]).filter((c:any)=>verifiedClaim(c,e));
      const summary=claims.find((c:any)=>c.text===body.analysis.summary&&c.text.length<=800)||claims.find((c:any)=>c.text.length<=800),why=claims.find((c:any)=>c.text===body.analysis.whyItMatters&&c.text.length<=1000)||claims.find((c:any)=>c!==summary&&c.text.length<=1000)||summary;
      if(!summary||!why)throw new Error('Model summary and interpretation could not be verified');
      const candidate={...body.analysis,summary:summary.text,whyItMatters:why.text,claims,metrics:[] as any[],executiveBackground:null as FilingAnalysis['executiveBackground'],resultPeriod:null as FilingAnalysis['resultPeriod'],evidenceGaps:[...(Array.isArray(body.analysis?.evidenceGaps)?body.analysis.evidenceGaps:[]).slice(0,5),'Some drafted details could not be verified against their sources and were omitted.']};
      validateDraft(candidate,e,job.model);
      if(e.sourceKind==='pdf'){
        try{candidate.resultPeriod=validateReportPeriod(body.analysis.resultPeriod,e.passages);}catch{/* Preserve only an independently evidenced primary period. */}
        for(const metric of Array.isArray(body.analysis?.metrics)?body.analysis.metrics:[]){try{validateAnalysis({...candidate,metrics:[metric]},e.passages,job.model,e.content.contentHash!);candidate.metrics.push(metric);}catch{/* Only independently verified figures survive. */}}
        if(verifiedClaim(body.analysis.executiveBackground,e))candidate.executiveBackground=body.analysis.executiveBackground;
      }
      analysis=validateDraft(candidate,e,job.model);
    }
    analysis={...analysis,inputFingerprint:e.fingerprint,sourceKind:e.sourceKind,evidenceGaps:[...new Set([...e.gaps,...(analysis.evidenceGaps||[])])].slice(0,6)};
    await persistVerifiedAnalysis(job.owner,job.filing_id,analysis);await stage(job,'Interpretation and citations verified');
    await db.prepare("UPDATE portfolio_private_jobs SET status='done',finished_at=?,lease=NULL,lease_until=NULL,error=NULL WHERE id=? AND lease=?").bind(now(),job.id,job.lease).run();return {accepted:true,filingId:job.filing_id,claims:analysis.claims.length,metrics:analysis.metrics.length};
  }catch(error){await failJob(job,error instanceof Error?error.message:undefined);throw error;}
}
async function failJob(job:Job,reason='Analysis failed or its evidence did not validate'){
  const meta=await request(job),retry=meta.mode==='automatic'&&job.attempts<3;
  await database().prepare("UPDATE portfolio_private_jobs SET status=?,available_at=?,lease=NULL,lease_until=NULL,error=? WHERE id=? AND lease=? AND status='running'").bind(retry?'retry':'failed',new Date(Date.now()+job.attempts*300000).toISOString(),reason.slice(0,240),job.id,job.lease).run();await writeInterpretationRequest(job.id,{...meta,stage:retry?'Waiting to retry automatically':'Interpretation needs attention',error:reason.slice(0,240)});
}
