import {database} from '../repository';
import {privateCodexConfig} from './private-config';
import {filingFingerprint,interpretationVersion,writeInterpretationRequest} from './automatic';
import {digest} from './sources';
import {resultsForFiling,passagesFor} from './analysis';
import type {Filing,Passage} from './types';
import type {ResearchPassage,ResearchCalculation} from '../research/types';
export const questionKey=(owner:string,id:string)=>'portfolio-question:'+owner+':'+id;
export async function queueFilingQuestion(owner:string,filingId:string,question:string){
  if(privateCodexConfig()?.owner!==owner)throw new Error('This account has no configured filing model');
  if(typeof question!=='string'||question.trim().length<5||question.length>600)throw new Error('Enter a filing question between 5 and 600 characters');
  const db=database(),row=await db.prepare('SELECT data FROM portfolio_filings WHERE id=?').bind(filingId).first<{data:string}>();if(!row)throw new Error('Unknown portfolio filing');
  const f=JSON.parse(row.data) as Filing,fingerprint=await filingFingerprint(f),key=await digest(JSON.stringify([owner,privateCodexConfig()!.model,filingId,fingerprint,question.trim().toLowerCase()])),id='q-'+key,prior=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(questionKey(owner,id)).first<{data:string}>();
  if(prior){const value=JSON.parse(prior.data);if(value.status==='done')return value;const job=await db.prepare('SELECT status FROM portfolio_private_jobs WHERE id=? AND owner=?').bind(id,owner).first<{status:string}>();if(job&&['queued','retry','running'].includes(job.status))return {...value,status:job.status};}
  const prefix='portfolio-question:'+owner+':',recent=await db.prepare('SELECT COUNT(*) AS n FROM provider_cache WHERE key>=? AND key<? AND fetched_at>=?').bind(prefix,prefix+'\uffff',new Date(Date.now()-3600000).toISOString()).first<{n:number}>();if((recent?.n||0)>=20)throw new Error('Filing question limit reached; saved answers remain available');
  const stamp=new Date().toISOString(),value={id,filingId,question:question.trim(),status:'queued',answer:null,context:[],created_at:stamp};
  await db.prepare("INSERT INTO portfolio_private_jobs(id,owner,filing_id,content_hash,model,status,created_at,available_at) VALUES(?,?,?,?,?,'queued',?,?) ON CONFLICT(id) DO UPDATE SET status='queued',attempts=0,available_at=excluded.available_at,error=NULL").bind(id,owner,filingId,'question:'+fingerprint+':'+key,privateCodexConfig()!.model,stamp,stamp).run();
  await writeInterpretationRequest(id,{mode:'manual',kind:'question',version:interpretationVersion,fingerprint,question:question.trim(),questionId:id,requestedAt:stamp,stage:'Queued for filing research'});
  await db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(questionKey(owner,id),JSON.stringify(value),stamp).run();return value;
}
export async function readFilingQuestion(owner:string,id:string){const db=database(),row=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(questionKey(owner,id)).first<{data:string}>();if(!row)return null;const value=JSON.parse(row.data),job=await db.prepare('SELECT status,error FROM portfolio_private_jobs WHERE id=? AND owner=?').bind(id,owner).first<{status:string;error:string}>();return {...value,status:job?.status||value.status,error:job?.error||null};}
export function questionPassages(f:Filing,passages:Passage[],hash:string,period=''):ResearchPassage[]{return passages.map(p=>({id:f.id+'#'+p.id,document_id:f.id,ticker:f.ticker,page:p.page,heading:f.title,text:p.text,title:f.title,period,type:'exchange_filing',source_url:f.attachmentUrl||f.sourceUrl,version_id:hash}));}
export async function questionComparisons(owner:string,f:Filing,context:ResearchPassage[]){
  const result=await resultsForFiling(owner,f.id),calculations:ResearchCalculation[]=[];
  for(const group of result.groups.slice(0,3))for(const row of group.rows)for(const [label,comparison] of [['QoQ',row.qoq],['YoY',row.yoy]] as const){
    if(!row.current||comparison.status!=='calculated'||!comparison.previous||comparison.pct===null)continue;
    const points=[comparison.previous,row.current],inputs:ResearchCalculation['inputs']=[];
    for(const p of points){let passage=context.find(c=>c.document_id===p.source.filingId&&c.text.replace(/\s+/g,' ').includes(p.source.quote.replace(/\s+/g,' ')));
      if(!passage){const record=await database().prepare('SELECT f.data AS filing_data,c.data AS content_data FROM portfolio_filings f JOIN provider_cache c ON c.key=\'portfolio-pdf:\'||f.id WHERE f.id=?').bind(p.source.filingId).first<{filing_data:string;content_data:string}>();if(record){const content=JSON.parse(record.content_data);const all=questionPassages(JSON.parse(record.filing_data),passagesFor(content),content.contentHash,p.periodEnd);passage=all.find(c=>c.text.replace(/\s+/g,' ').includes(p.source.quote.replace(/\s+/g,' ')));if(passage&&context.length<40)context.push(passage);else passage=undefined;}}
      if(!passage)break;
      inputs.push({factId:await digest(JSON.stringify([p.source.contentHash,p.name,p.periodEnd,p.value,p.scope])),metric:p.name,value:String(p.value),unit:p.unit,period:p.periodEnd,scope:p.scope,sourceIds:[passage.id]});
    }
    if(inputs.length!==2)continue;
    calculations.push({id:'calc-'+await digest(JSON.stringify([row.name,label,inputs.map(i=>i.factId)])),label:group.entity+' · '+row.name+' '+label,formula:comparison.formula!,inputs,sourceIds:[...new Set(inputs.flatMap(i=>i.sourceIds))],values:[{label:'Change',value:String(row.current.inrCrore-comparison.previous.inrCrore),unit:'INR crore'},{label:label+' growth',value:comparison.pct.toFixed(4),unit:'%'}]});
  }
  return {context,calculations};
}
