import {database} from "../repository";
import {downloadFiling,extractFiling,type FilingContent} from "../filing-content";
import {subscriptionAccess,authConfig} from "./chatgpt-auth";
import {privateCodexConfig,enqueuePrivateAnalysis} from "./private-config";
import {categories,type Filing,type FilingAnalysis,type Passage} from "./types";
import {monitoringRules,triggers} from "./monitor";
import {analysisSchemaVersion,buildResultsComparison,validateMetricContext,validateReportPeriod,type ResultsReport} from "./results";
import {interpretationVersion} from './automatic';
import {supportedClaimNumbers,portfolioInstructions} from './interpretation';
const hosts=new Set(["nsearchives.nseindia.com","archives.nseindia.com","www.bseindia.com"]);
export async function portfolioDocument(id:string,cacheOnly=false):Promise<FilingContent>{
  const db=database(),row=await db.prepare("SELECT data FROM portfolio_filings WHERE id=?").bind(id).first<{data:string}>();if(!row)throw new Error("Unknown portfolio filing");const filing=JSON.parse(row.data) as Filing;
  const cache=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key=?").bind(`portfolio-pdf:${id}`).first<{data:string;fetched_at:string}>();if(cache&&(cacheOnly||Date.now()-Date.parse(cache.fetched_at)<86400000))return JSON.parse(cache.data);
  if(cacheOnly)return {documentId:id,status:'unavailable',sourceUrl:filing.attachmentUrl||filing.sourceUrl,pages:[{page:0,text:filing.title+'\n'+filing.description}],extractedAt:new Date().toISOString(),reason:filing.attachmentUrl?'PDF text appears after the background worker reads the original. The exchange notice is available below.':'The exchange supplied no eligible PDF attachment. The original notice is available below.'};
  if(!filing.attachmentUrl)throw new Error("The exchange did not provide an eligible PDF attachment");
  const result=await extractFiling(id,filing.attachmentUrl,await downloadFiling(filing.attachmentUrl,fetch,hosts));
  await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(`portfolio-pdf:${id}`,JSON.stringify(result),new Date().toISOString()).run();return result;
}
export function passagesFor(content:FilingContent):Passage[]{
  const result:Passage[]=[];
  for(const page of content.pages)for(let offset=0;offset<page.text.length;offset+=5500){result.push({id:page.page===0?'notice-0':`p${page.page}-${offset}`,page:page.page,text:page.text.slice(offset,offset+6000)});}
  return result;
}
const normal=(text:string)=>text.replace(/\s+/g," ").trim();
export function validateAnalysis(value:any,passages:Passage[],model:string,hash:string):FilingAnalysis{
  if(!value||typeof value.summary!=="string"||value.summary.length>800||typeof value.whyItMatters!=="string"||value.whyItMatters.length>1000||!categories.includes(value.category)||!["high","medium","routine"].includes(value.priority)||!Array.isArray(value.claims)||value.claims.length<1||value.claims.length>10||!Array.isArray(value.metrics)||value.metrics.length>40)throw new Error("Model response did not match the analysis contract");
  const validate=(claim:any)=>{
    const p=passages.find(p=>p.id===claim.passageId);if(!p||typeof claim.quote!=="string"||normal(claim.quote).length<12||normal(claim.quote).length>1800||!normal(p.text).includes(normal(claim.quote))||typeof claim.text!=="string"||claim.text.length>1200)throw new Error("Model citation could not be located in the filing");
    return claim;
  };
  for(const claim of value.claims)validate(claim);
  // Summary and significance must each be present as a cited claim, not free
  // text outside the evidence contract. Interpretation is labelled in the UI.
  if(!value.claims.some((c:any)=>c.text===value.summary)||!value.claims.some((c:any)=>c.text===value.whyItMatters))throw new Error("Summary and significance need supporting passages");
  for(const m of value.metrics){
    // Preserve entity names, restatement notes and accounting adjustments. A
    // compact label limit must not reject a correctly cited financial figure.
    if(!["Revenue","EBITDA","PBT","PAT"].includes(m.name)||!Number.isFinite(m.value)||!["INR crore","INR lakh","INR million","INR billion"].includes(m.unit)||typeof m.period!=="string"||m.period.length>80||typeof m.basis!=="string"||m.basis.length>512)throw new Error("Invalid reported financial metric");
    validate({...m,text:m.name});
    const numbers=normal(m.quote).replace(/,/g,"").replace(/\((\d+(?:\.\d+)?)\)/g,"-$1").replace(/[−–]/g,"-").match(/-?\d+(?:\.\d+)?/g)||[];
    if(!numbers.some(n=>Number(n)===m.value))throw new Error("Extracted financial number is absent from its source quote");
    const context=validateMetricContext(m.context,m,passages),p=passages.find(p=>p.id===m.passageId)!;
    const contextPassage=context?[context.passageId,...(context.evidenceRefs||[]).map(r=>r.passageId)].map(id=>passages.find(p=>p.id===id)?.text||'').join('\n'):'';
    const unit=m.unit.split(" ")[1],unitPattern=unit==="lakh"?"(?:lakh|lac)":unit==="million"?"(?:million|mn)":unit,currency="(?:₹|\\bINR\\b|\\bRs\\.?|\\brupees?\\b)";
    if(!new RegExp(`${currency}[\\s\\S]{0,60}\\b${unitPattern}s?\\b|\\b${unitPattern}s?\\b[\\s\\S]{0,60}${currency}`,"i").test(p.text+"\n"+contextPassage))throw new Error("Reported financial unit and currency are not supported by the filing");
    m.context=context;
  }
  if(value.executiveBackground!==null)validate(value.executiveBackground);
  const gaps=value.evidenceGaps||[];if(!Array.isArray(gaps)||gaps.length>6||gaps.some((g:any)=>typeof g!=='string'||g.length>400))throw new Error('Model evidence gaps are invalid');
  return {schemaVersion:analysisSchemaVersion,promptVersion:interpretationVersion,resultPeriod:validateReportPeriod(value.resultPeriod,passages),summary:value.summary,whyItMatters:value.whyItMatters,category:value.category,priority:value.priority,claims:value.claims,metrics:value.metrics,executiveBackground:value.executiveBackground,evidenceGaps:gaps,model,contentHash:hash,createdAt:new Date().toISOString(),status:"generated"};
}
export async function readResponseStream(response:Response){
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===429?"ChatGPT usage limit reached. Analysis will retry later.":response.status===401?"ChatGPT authorization expired. Reconnect your account.":response.status===403?"This ChatGPT connection is not authorized for hosted model inference.":"The model provider could not complete this analysis.");}
  const reader=response.body?.getReader();if(!reader)throw new Error("Empty model response");let pending="",size=0,completed:any;const decoder=new TextDecoder();
  const consume=(block:string)=>{const data=block.split("\n").filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n");if(!data||data==="[DONE]")return;const event=JSON.parse(data);if(event.type==="response.completed")completed=event.response;if(event.type==="response.failed"||event.type==="error"||event.type==="response.incomplete")throw new Error("Model analysis was not completed");};
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>400000)throw new Error("Model response exceeded its size limit");pending=(pending+decoder.decode(r.value,{stream:true})).replace(/\r\n/g,"\n");let split;while((split=pending.indexOf("\n\n"))>=0){consume(pending.slice(0,split));pending=pending.slice(split+2);}}if(pending.trim())consume(pending);}
  catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
  if(completed?.status!=="completed")throw new Error("The model stream ended before analysis completed");
  const text=(completed.output||[]).flatMap((i:any)=>i.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("");if(!text)throw new Error("Model returned no analysis");return JSON.parse(text);
}
export const instructions=portfolioInstructions;
export async function analyseFiling(owner:string,id:string,requested=false){
  const db=database(),token=crypto.randomUUID(),now=new Date().toISOString();
  const lease=await db.prepare("INSERT INTO portfolio_model_leases(owner,token,expires_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE portfolio_model_leases.expires_at<? RETURNING token").bind(owner,token,new Date(Date.now()+120000).toISOString(),now).first<{token:string}>();if(lease?.token!==token)throw new Error("An analysis is already running for this account");
  try{
    const content=await portfolioDocument(id);if(!content.contentHash)throw new Error("Document content hash is missing");
    const cached=await db.prepare("SELECT data FROM portfolio_analysis WHERE owner=? AND filing_id=? AND content_hash=?").bind(owner,id,content.contentHash).first<{data:string}>();
    const personal=privateCodexConfig(),model=personal?.owner===owner?personal.model:authConfig()?.model;
    if(cached){const result=JSON.parse(cached.data) as FilingAnalysis;if(result.schemaVersion===analysisSchemaVersion&&result.promptVersion===interpretationVersion&&result.model===model)return result;}
    if(personal?.owner===owner)return enqueuePrivateAnalysis(owner,id,content.contentHash,requested);
    const access=await subscriptionAccess(owner),passages=passagesFor(content);if(!passages.length)throw new Error("No readable filing passages");
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${access.token}`,"Content-Type":"application/json"},body:JSON.stringify({model:access.model,store:false,stream:true,instructions,input:[{role:"user",content:JSON.stringify({documentId:id,sourceUrl:content.sourceUrl,passages})}]}),signal:AbortSignal.timeout(60000),redirect:"error"});
    const analysis=validateAnalysis(await readResponseStream(response),passages,access.model,content.contentHash);
    // A disconnect during a model call must not resurrect the connection or
    // write a new result after the user withdrew its authorization.
    if(!await db.prepare("SELECT owner FROM portfolio_accounts WHERE owner=?").bind(owner).first())throw new Error("ChatGPT was disconnected during analysis");
    return persistVerifiedAnalysis(owner,id,analysis);
  }finally{await db.prepare("DELETE FROM portfolio_model_leases WHERE owner=? AND token=?").bind(owner,token).run();}
}
export async function persistVerifiedAnalysis(owner:string,id:string,analysis:FilingAnalysis){
    const db=database();
    await db.prepare("INSERT INTO portfolio_analysis(owner,filing_id,content_hash,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,filing_id) DO UPDATE SET content_hash=excluded.content_hash,data=excluded.data,updated_at=excluded.updated_at").bind(owner,id,analysis.contentHash,JSON.stringify(analysis),analysis.createdAt).run();
    const filingRow=await db.prepare("SELECT data FROM portfolio_filings WHERE id=?").bind(id).first<{data:string}>(),preference=await db.prepare("SELECT updated_at FROM portfolio_rules WHERE owner=?").bind(owner).first<{updated_at:string}>();
    if(filingRow&&preference){const filing={...JSON.parse(filingRow.data),category:analysis.category,priority:analysis.priority} as Filing;for(const t of triggers(await monitoringRules(owner),null,[filing],preference.updated_at))await db.prepare("INSERT INTO portfolio_alerts(owner,trigger_key,ticker,data,created_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,trigger_key) DO UPDATE SET data=excluded.data").bind(owner,t.key,filing.ticker,JSON.stringify({...t,reason:analysis.whyItMatters,analysis:true}),analysis.createdAt).run();}
    return analysis;
}
export function reportedComparison(current:{value:number;unit:string;basis:string},previous:{value:number;unit:string;basis:string}){
  if(current.unit!==previous.unit||current.basis!==previous.basis||previous.value<=0)return null;
  return {pct:100*(current.value/previous.value-1),formula:"100 × (current / previous − 1)",inputs:{current:current.value,previous:previous.value,unit:current.unit,basis:current.basis}};
}

export async function resultsForFiling(owner:string,id:string){
  const db=database(),anchor=await db.prepare("SELECT data FROM portfolio_filings WHERE id=?").bind(id).first<{data:string}>();if(!anchor)throw new Error("Unknown portfolio filing");
  const filing=JSON.parse(anchor.data) as Filing;
  const rows=await db.prepare("SELECT a.data AS analysis_data,f.data AS filing_data,json_extract(p.data,'$.contentHash') AS document_hash FROM portfolio_analysis a JOIN portfolio_filings f ON f.id=a.filing_id LEFT JOIN provider_cache p ON p.key='portfolio-pdf:'||f.id WHERE a.owner=? AND f.ticker=? AND f.published_at<=? ORDER BY CASE WHEN f.id=? THEN 0 ELSE 1 END,f.published_at DESC LIMIT 51").bind(owner,filing.ticker,filing.publishedAt,id).all<{analysis_data:string;filing_data:string;document_hash:string|null}>();
  const reports:ResultsReport[]=rows.results.slice(0,50).flatMap(row=>{const analysis=JSON.parse(row.analysis_data) as FilingAnalysis;if(row.document_hash&&row.document_hash!==analysis.contentHash)return [];return [{filing:JSON.parse(row.filing_data),analysis}];});
  return {...buildResultsComparison(filing,reports),coverage:{reportsConsidered:reports.length,limit:50,truncated:rows.results.length>50}};
}
