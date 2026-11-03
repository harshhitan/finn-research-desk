import {database} from '../repository';
import {privateCodexConfig} from './private-config';
import {classify,digest} from './sources';
import type {Filing,FilingAnalysis,Quote} from './types';
import {interpretationVersion} from './types';

export {interpretationVersion} from './types';
export const interpretationDay=(time=Date.now())=>new Date(time+330*60000).toISOString().slice(0,10);
export type InterpretationSettings={enabled:boolean;dailyLimit:number;includeRoutine:boolean;updatedAt:string|null;usedToday?:number;resetsAt?:string};
export type InterpretationRequest={mode:'automatic'|'manual';kind?:'filing'|'market'|'question';version:string;priority?:'high'|'medium'|'routine';fingerprint?:string;stage?:string;question?:string;questionId?:string;market?:{ticker:string;sessionDate:string};requestedAt:string;error?:string|null;attemptDay?:string};
export async function interpretationAllowance(owner:string){const day=interpretationDay(),row=await database().prepare('SELECT data FROM provider_cache WHERE key=?').bind('portfolio-auto-usage:'+owner+':'+day).first<{data:string}>();return {usedToday:row?Number(JSON.parse(row.data).count)||0:0,resetsAt:day+'T18:30:00.000Z'};}
export async function releaseAllowanceWait(owner:string){
  const settings=await interpretationSettings(owner),allowance=await interpretationAllowance(owner);if(!settings.enabled||allowance.usedToday>=settings.dailyLimit)return;
  const db=database(),stage='Daily automatic budget reached; waiting for the next allowance';await db.batch([
    db.prepare("UPDATE portfolio_private_jobs SET available_at=? WHERE owner=? AND status='queued' AND EXISTS(SELECT 1 FROM provider_cache p WHERE p.key='portfolio-request:'||portfolio_private_jobs.id AND json_extract(p.data,'$.mode')='automatic' AND json_extract(p.data,'$.stage')=?)").bind(new Date().toISOString(),owner,stage),
    db.prepare("UPDATE provider_cache SET data=json_set(data,'$.stage','Queued for interpretation') WHERE json_extract(data,'$.stage')=? AND key IN (SELECT 'portfolio-request:'||id FROM portfolio_private_jobs WHERE owner=? AND status='queued')").bind(stage,owner)
  ]);
}
export const requestKey=(id:string)=>'portfolio-request:'+id;
export async function interpretationSettings(owner:string):Promise<InterpretationSettings>{
  const row=await database().prepare('SELECT data FROM provider_cache WHERE key=?').bind('portfolio-auto:'+owner).first<{data:string}>();
  return row?JSON.parse(row.data):{enabled:false,dailyLimit:100,includeRoutine:true,updatedAt:null};
}
export async function saveInterpretationSettings(owner:string,body:any){
  if(privateCodexConfig()?.owner!==owner)throw new Error('Automatic interpretation is not configured for this account');
  if(typeof body.enabled!=='boolean'||typeof body.includeRoutine!=='boolean'||!Number.isInteger(body.dailyLimit)||body.dailyLimit<10||body.dailyLimit>150)throw new Error('Choose an automatic analysis limit between 10 and 150');
  const value={enabled:body.enabled,includeRoutine:body.includeRoutine,dailyLimit:body.dailyLimit,updatedAt:new Date().toISOString()};
  await database().prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind('portfolio-auto:'+owner,JSON.stringify(value),value.updatedAt).run();await releaseAllowanceWait(owner);return value;
}
export async function readInterpretationRequest(id:string):Promise<InterpretationRequest|null>{const row=await database().prepare('SELECT data FROM provider_cache WHERE key=?').bind(requestKey(id)).first<{data:string}>();return row?JSON.parse(row.data):null;}
export async function writeInterpretationRequest(id:string,value:InterpretationRequest){await database().prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(requestKey(id),JSON.stringify(value),new Date().toISOString()).run();}
export const filingFingerprint=(f:Filing)=>digest(JSON.stringify([interpretationVersion,f.id,f.title,f.description,f.attachmentUrl]));
export const marketInterpretationId=(q:Pick<Quote,'ticker'|'sessionDate'>)=>'market:'+q.ticker+':'+q.sessionDate;
export async function queueAutomaticInterpretations(owner:string,filings:Filing[],quotes:Quote[]=[]){
  const settings=await interpretationSettings(owner);if(!settings.enabled||privateCodexConfig()?.owner!==owner)return {queued:0};
  const db=database(),now=new Date().toISOString(),model=privateCodexConfig()!.model;
  const [active,existing]=await Promise.all([
    db.prepare("SELECT j.id,j.status,json_extract(p.data,'$.priority') AS priority FROM portfolio_private_jobs j JOIN provider_cache p ON p.key='portfolio-request:'||j.id WHERE j.owner=? AND j.status IN ('queued','retry','running','failed') AND json_extract(p.data,'$.mode')='automatic'").bind(owner).all<{id:string;status:string;priority:string}>(),
    db.prepare('SELECT filing_id,data FROM portfolio_analysis WHERE owner=? ORDER BY updated_at DESC LIMIT 800').bind(owner).all<{filing_id:string;data:string}>(),
  ]);
  const done=new Map(existing.results.map(r=>[r.filing_id,JSON.parse(r.data) as FilingAnalysis])),statements:D1PreparedStatement[]=[];
  const knownJobs=new Map(active.results.map(j=>[j.id,j]));
  let room=Math.max(0,80-active.results.filter(j=>j.status!=='failed').length),queued=0;
  const rank={high:0,medium:1,routine:2};
  for(const f of [...filings].sort((a,b)=>rank[a.priority]-rank[b.priority]||b.publishedAt.localeCompare(a.publishedAt))){
    if(f.priority==='routine'&&!settings.includeRoutine)continue;
    const prior=done.get(f.id),fingerprint=await filingFingerprint(f);if(prior?.promptVersion===interpretationVersion&&prior.model===model&&prior.inputFingerprint===fingerprint)continue;
    const id='auto-'+await digest(owner+'|'+model+'|'+f.id+'|'+fingerprint),request:InterpretationRequest={mode:'automatic',kind:'filing',priority:f.priority,version:interpretationVersion,fingerprint,requestedAt:now,stage:'Queued for interpretation'};
    const pending=knownJobs.get(id);if(pending){if(pending.priority!==f.priority)statements.push(db.prepare("UPDATE provider_cache SET data=json_set(data,'$.priority',?) WHERE key=?").bind(f.priority,requestKey(id)));continue;}
    if(!room)continue;
    statements.push(db.prepare("INSERT OR IGNORE INTO portfolio_private_jobs(id,owner,filing_id,content_hash,model,status,created_at,available_at) VALUES(?,?,?,?,?,'queued',?,?)").bind(id,owner,f.id,'auto:'+fingerprint,model,now,now));
    statements.push(db.prepare('INSERT OR IGNORE INTO provider_cache(key,data,fetched_at) VALUES(?,?,?)').bind(requestKey(id),JSON.stringify(request),now));queued++;room--;
  }
  for(const q of quotes){
    if(!room||q.split||q.movePct===null&&q.volumeMultiple===null)continue;
    const rules=await db.prepare('SELECT data FROM portfolio_rules WHERE owner=?').bind(owner).first<{data:string}>(),rule=rules?JSON.parse(rules.data):{priceThreshold:5,volumeThreshold:2};
    if(!(q.movePct!==null&&Math.abs(q.movePct)>=rule.priceThreshold||q.volumeMultiple!==null&&q.volumeMultiple>=rule.volumeThreshold))continue;
    const filingId=marketInterpretationId(q),fingerprint=await digest(JSON.stringify([interpretationVersion,q.ticker,q.sessionDate,q.close,q.movePct,q.volumeMultiple,rule.priceThreshold,rule.volumeThreshold]));if(done.get(filingId)?.promptVersion===interpretationVersion&&done.get(filingId)?.model===model&&done.get(filingId)?.inputFingerprint===fingerprint)continue;
    const id='auto-'+await digest(owner+'|'+model+'|'+filingId+'|'+fingerprint),request:InterpretationRequest={mode:'automatic',kind:'market',priority:'high',version:interpretationVersion,fingerprint,market:{ticker:q.ticker,sessionDate:q.sessionDate},requestedAt:now,stage:'Queued for market interpretation'};
    if(knownJobs.has(id))continue;
    statements.push(db.prepare("INSERT OR IGNORE INTO portfolio_private_jobs(id,owner,filing_id,content_hash,model,status,created_at,available_at) VALUES(?,?,?,?,?,'queued',?,?)").bind(id,owner,filingId,'auto:'+fingerprint,model,now,now),db.prepare('INSERT OR IGNORE INTO provider_cache(key,data,fetched_at) VALUES(?,?,?)').bind(requestKey(id),JSON.stringify(request),now));room--;queued++;
  }
  for(let i=0;i<statements.length;i+=40)await db.batch(statements.slice(i,i+40));return {queued};
}
export async function primeAutomaticInterpretations(owner:string){
  const settings=await interpretationSettings(owner);if(!settings.enabled)return;
  const db=database(),window=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind('portfolio-auto-window:'+owner).first<{data:string}>(),selection=window?JSON.parse(window.data):null;
  const from=new Date(Math.min(selection?.from&&Number.isFinite(Date.parse(selection.from))?Date.parse(selection.from):Date.now(),Date.now()-7*86400000)).toISOString(),to=new Date().toISOString();
  const rows=await db.prepare('SELECT data FROM portfolio_filings WHERE published_at>=? AND published_at<=? ORDER BY published_at DESC LIMIT 500').bind(from,to).all<{data:string}>();
  const prices=await db.prepare('SELECT p.data FROM portfolio_prices p WHERE session_date=(SELECT MAX(session_date) FROM portfolio_prices WHERE ticker=p.ticker)').all<{data:string}>();
  await queueAutomaticInterpretations(owner,rows.results.map(r=>{const f=JSON.parse(r.data);return {...f,...classify(f.title+' '+f.description)};}),prices.results.map(r=>JSON.parse(r.data)));
}
