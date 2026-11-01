import {database} from "../repository";
import {companies,company,coverage,parse,searchCorpus,readPassages,stamp} from "./store";
import {seedResearchCompanies,type ResearchFilters} from "./types";

type Identity={ticker:string;name:string;isin:string;sources:string[]};
export const directoryRequestKey=(query:string)=>'research-directory-request:'+query.trim().toLowerCase();
export async function directoryPending(query:string){const row=await database().prepare("SELECT data FROM provider_cache WHERE key=?").bind(directoryRequestKey(query)).first<{data:string}>();return ['queued','running'].includes(parse<any>(row?.data,{}).status);}
async function queueDirectory(query:string){
  const db=database(),key=directoryRequestKey(query),prior=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key=?").bind(key).first<{data:string;fetched_at:string}>();
  if(prior&&Date.now()-Date.parse(prior.fetched_at)<180000&&['queued','running'].includes(parse<any>(prior.data,{}).status))return;
  if(prior&&Date.now()-Date.parse(prior.fetched_at)<60000&&parse<any>(prior.data,{}).status==='failed')throw new Error('Company sources are temporarily unavailable. Please retry in a minute.');
  const pending=await db.prepare("SELECT COUNT(*) AS n FROM provider_cache WHERE key LIKE 'research-directory-request:%' AND json_extract(data,'$.status') IN ('queued','running') AND fetched_at>?").bind(new Date(Date.now()-180000).toISOString()).first<{n:number}>();
  if((pending?.n||0)>=10)throw new Error('Company lookup queue is full. Please retry after current requests finish.');
  await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(key,JSON.stringify({query:query.trim().slice(0,100),status:'queued'}),stamp()).run();
}
const tickerPattern=/^[A-Z0-9][A-Z0-9&-]{0,24}$/;
export const canonicalTicker=(s:string)=>s.trim().toUpperCase().replace(/\.(NS|BO)$/," ").trim();
function csvLine(line:string){return (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g)||[]).map(s=>s.replace(/,$/,"").replace(/^"|"$/g,"").replaceAll('""','"'));}
async function directory():Promise<Identity[]>{
  const db=database(),cached=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key='research-nse-directory-v1'").first<{data:string;fetched_at:string}>();
  if(cached&&Date.now()-Date.parse(cached.fetched_at)<86400000)return parse(cached.data,[]);
  const failed=await db.prepare("SELECT fetched_at FROM provider_cache WHERE key='research-directory-unavailable'").first<{fetched_at:string}>();
  if(failed&&Date.now()-Date.parse(failed.fetched_at)<300000){if(cached)return parse(cached.data,[]);throw new Error("NSE directory temporarily unavailable");}
  try{
    const response=await fetch("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",{signal:AbortSignal.timeout(4000),redirect:"error"});
    if(!response.ok)throw new Error();const text=await response.text();if(text.length>1500000)throw new Error();
    const lines=text.trim().split(/\r?\n/),header=csvLine(lines.shift()||"").map(s=>s.trim()),si=header.indexOf("SYMBOL"),ni=header.indexOf("NAME OF COMPANY"),ii=header.indexOf("ISIN NUMBER");
    if(Math.min(si,ni,ii)<0)throw new Error();
    const rows=lines.map(csvLine).filter(r=>tickerPattern.test(r[si])&&/^IN[A-Z0-9]{10}$/.test(r[ii])).map(r=>({ticker:r[si],name:r[ni],isin:r[ii],sources:seedResearchCompanies.find(c=>c.ticker===r[si])?.sources||[]}));
    if(rows.length<100)throw new Error();
    await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('research-nse-directory-v1',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(JSON.stringify(rows),stamp()).run();return rows;
  }catch{await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('research-directory-unavailable','{}',?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at").bind(stamp()).run();if(cached)return parse(cached.data,[]);throw new Error("The NSE company directory is temporarily unavailable. Existing indexed companies remain available.");}
}
async function boundedResponse(response:Response,limit:number){const reader=response.body?.getReader();if(!reader)throw new Error("Empty company-directory response");const decoder=new TextDecoder();let text="",bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw new Error("Company-directory response exceeds size limit");text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
const plain=(s:string)=>s.replace(/<[^>]*>/g," ").replaceAll("&amp;","&").replaceAll("&#39;","'").replaceAll("&nbsp;"," ").replace(/\s+/g," ").trim();
async function searchDirectoryFallback(query:string):Promise<Identity[]>{
  const db=database(),key="research-company-search:"+query.toLowerCase(),cache=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key=?").bind(key).first<{data:string;fetched_at:string}>();
  if(cache&&Date.now()-Date.parse(cache.fetched_at)<3600000)return parse(cache.data,[]);
  const response=await fetch("https://www.screener.in/api/company/search/?q="+encodeURIComponent(query)+"&v=3&fts=1",{redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error("Company search is temporarily unavailable");const value=JSON.parse(await boundedResponse(response,100000));
  if(!Array.isArray(value))throw new Error("Company directory returned an invalid result");
  const found:Identity[]=[];
  for(const entry of value.slice(0,20)){const match=typeof entry.url==="string"?entry.url.match(/^\/company\/([^/]+)\/(?:consolidated\/)?$/):null;if(!match||typeof entry.name!=="string"||entry.name.length>200)continue;const ticker=decodeURIComponent(match[1]);if(!tickerPattern.test(ticker))continue;found.push({ticker,name:plain(entry.name),isin:"",sources:[]});}
  await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(key,JSON.stringify(found),stamp()).run();return found;
}
async function linkedCompanyIdentity(ticker:string):Promise<Identity>{
  let target="https://www.screener.in/company/"+encodeURIComponent(ticker)+"/consolidated/",html="";
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(10000)});
    if([301,302,307,308].includes(response.status)){const next=new URL(response.headers.get("location")||"",target);await response.body?.cancel();if(next.origin!=="https://www.screener.in"||!next.pathname.startsWith("/company/"+encodeURIComponent(ticker)+"/"))throw new Error("Company-directory redirect could not be verified");target=next.href;continue;}
    if(!response.ok)throw new Error("Company ticker was not found in the available directories");html=await boundedResponse(response,3000000);break;
  }
  const name=plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||"");
  const nseLinks=html.match(/https:\/\/www\.nseindia\.com\/[^\s"<>]+/g)||[];
  if(!name||name.length>200||!nseLinks.some(link=>{try{return new URL(link.replaceAll("&amp;","&")).searchParams.get("symbol")===ticker;}catch{return false;}}))throw new Error("The selected company does not have a matching linked NSE identity");
  const sources:string[]=[];
  for(const link of html.matchAll(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const url=new URL(link[1]);const host=url.hostname.replace(/^www\./,"");if(url.username||url.password||url.port||!["","/"].includes(url.pathname)||/screener|nseindia|bseindia|linkedin|twitter|facebook|youtube|instagram|x\.com/.test(host))continue;if(plain(link[2]).toLowerCase().includes(host)||/company website|^website$/i.test(plain(link[2])))sources.push(url.href);}catch{}
  }
  // ISIN is deliberately left unknown, rather than fabricated, when the NSE
  // download is unavailable. The linked symbol and downloaded issuer documents
  // are checked independently before any evidence becomes searchable.
  return {ticker,name,isin:"",sources:[...new Set(sources)].slice(0,3)};
}
export async function resolveCompany(input:string){
  const symbol=canonicalTicker(input);if(!tickerPattern.test(symbol))throw new Error("Choose a valid NSE ticker from company search");
  const existing=await company(symbol);if(existing)return existing;
  const verified=await database().prepare("SELECT data FROM provider_cache WHERE key=?").bind('research-company-identity:'+symbol).first<{data:string}>();
  let match:Identity|undefined=verified?parse(verified.data,undefined):undefined;try{if(!match)match=(await directory()).find(c=>c.ticker===symbol);}catch{}
  if(!match)match=await linkedCompanyIdentity(symbol);
  const now=stamp();
  await database().prepare("INSERT INTO research_companies(ticker,name,isin,sources,status,created_at,updated_at) VALUES(?,?,?,?,'registered',?,?) ON CONFLICT(ticker) DO NOTHING").bind(match.ticker,match.name,match.isin,JSON.stringify(match.sources),now,now).run();
  return (await company(symbol))!;
}
export async function searchCompanies(query:string){
  const q=query.trim().toUpperCase(),existing=await companies();if(!q)return existing;
  const matches=(c:{ticker:string;name:string})=>c.ticker.includes(q)||c.name.toUpperCase().includes(q);
  const local=existing.filter(matches);if(q.length<2||local.length)return local;
  const cached=await database().prepare("SELECT data,fetched_at FROM provider_cache WHERE key=?").bind('research-company-search:'+query.trim().toLowerCase()).first<{data:string;fetched_at:string}>();
  if(cached&&Date.now()-Date.parse(cached.fetched_at)<3600000)return parse<Identity[]>(cached.data,[]).map(c=>({...c,status:'not_indexed'}));
  if(await directoryPending(query))return [];
  let rows:Identity[]=[];try{rows=(await directory()).filter(matches).slice(0,12);}catch{}
  if(!rows.length)try{rows=await searchDirectoryFallback(query);}catch{await queueDirectory(query);return [];}
  return rows.map(c=>({...c,status:"not_indexed"}));
}
// Only repeated research operations are registered. These are ordinary internal
// functions; there is no MCP server or personal-computer dependency.
export const researchTools={
  get_company_coverage:{version:'1',readOnly:true,location:'site',timeoutMs:10000,maxResults:40,modelUse:false,cache:'current document versions',inputSchema:{type:'object',required:['ticker'],properties:{ticker:{type:'string',maxLength:25}}},run:(ticker:string)=>coverage(ticker)},
  search_corpus:{version:'2',readOnly:true,location:'site',timeoutMs:10000,maxResults:12,modelUse:false,cache:'FTS index of current document versions',inputSchema:{type:'object',required:['ticker','question'],properties:{ticker:{type:'string',maxLength:25},question:{type:'string',maxLength:600},filters:{type:'object'}}},run:(ticker:string,question:string,filters?:ResearchFilters)=>searchCorpus(ticker,question,filters)},
  read_passages:{version:'1',readOnly:true,location:'site',timeoutMs:10000,maxResults:12,modelUse:false,cache:'immutable passage/version IDs',inputSchema:{type:'object',required:['ticker','ids'],properties:{ticker:{type:'string',maxLength:25},ids:{type:'array',maxItems:12,items:{type:'string'}}}},run:(ticker:string,ids:string[])=>readPassages(ticker,ids)},
};
