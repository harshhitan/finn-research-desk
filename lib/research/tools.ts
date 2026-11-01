import {database} from "../repository";
import {companies,company,coverage,parse,searchCorpus,readPassages,stamp} from "./store";
import {seedResearchCompanies,type ResearchFilters} from "./types";

type Identity={ticker:string;name:string;isin:string;sources:string[]};
const tickerPattern=/^[A-Z0-9][A-Z0-9&-]{0,24}$/;
export const canonicalTicker=(s:string)=>s.trim().toUpperCase().replace(/\.(NS|BO)$/," ").trim();
function csvLine(line:string){return (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g)||[]).map(s=>s.replace(/,$/,"").replace(/^"|"$/g,"").replaceAll('""','"'));}
async function directory():Promise<Identity[]>{
  const db=database(),cached=await db.prepare("SELECT data,fetched_at FROM provider_cache WHERE key='research-nse-directory-v1'").first<{data:string;fetched_at:string}>();
  if(cached&&Date.now()-Date.parse(cached.fetched_at)<86400000)return parse(cached.data,[]);
  try{
    const response=await fetch("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",{signal:AbortSignal.timeout(12000),redirect:"error"});
    if(!response.ok)throw new Error();const text=await response.text();if(text.length>1500000)throw new Error();
    const lines=text.trim().split(/\r?\n/),header=csvLine(lines.shift()||"").map(s=>s.trim()),si=header.indexOf("SYMBOL"),ni=header.indexOf("NAME OF COMPANY"),ii=header.indexOf("ISIN NUMBER");
    if(Math.min(si,ni,ii)<0)throw new Error();
    const rows=lines.map(csvLine).filter(r=>tickerPattern.test(r[si])&&/^IN[A-Z0-9]{10}$/.test(r[ii])).map(r=>({ticker:r[si],name:r[ni],isin:r[ii],sources:seedResearchCompanies.find(c=>c.ticker===r[si])?.sources||[]}));
    if(rows.length<100)throw new Error();
    await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('research-nse-directory-v1',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(JSON.stringify(rows),stamp()).run();return rows;
  }catch{if(cached)return parse(cached.data,[]);throw new Error("The NSE company directory is temporarily unavailable. Existing indexed companies remain available.");}
}
export async function resolveCompany(input:string){
  const symbol=canonicalTicker(input);if(!tickerPattern.test(symbol))throw new Error("Choose a valid NSE ticker from company search");
  const existing=await company(symbol);if(existing)return existing;
  const match=(await directory()).find(c=>c.ticker===symbol);if(!match)throw new Error("Ticker was not found in the NSE company directory");
  const now=stamp();
  await database().prepare("INSERT INTO research_companies(ticker,name,isin,sources,status,created_at,updated_at) VALUES(?,?,?,?,'registered',?,?) ON CONFLICT(ticker) DO NOTHING").bind(match.ticker,match.name,match.isin,JSON.stringify(match.sources),now,now).run();
  return (await company(symbol))!;
}
export async function searchCompanies(query:string){
  const q=query.trim().toUpperCase(),existing=await companies();if(!q)return existing;
  const matches=(c:{ticker:string;name:string})=>c.ticker.includes(q)||c.name.toUpperCase().includes(q);
  const local=existing.filter(matches);if(q.length<2)return local;
  try{const rows=(await directory()).filter(matches).slice(0,12);return [...local,...rows.filter(r=>!local.some(c=>c.ticker===r.ticker)).map(c=>({...c,status:"not_indexed"}))].slice(0,12);}catch{if(local.length)return local;throw new Error("Company lookup is temporarily unavailable. Try a registered company or retry later.");}
}
// Only repeated research operations are registered. These are ordinary internal
// functions; there is no MCP server or personal-computer dependency.
export const researchTools={
  get_company_coverage:{readOnly:true,run:(ticker:string)=>coverage(ticker)},
  search_corpus:{readOnly:true,run:(ticker:string,question:string,filters?:ResearchFilters)=>searchCorpus(ticker,question,filters)},
  read_passages:{readOnly:true,run:(ticker:string,ids:string[])=>readPassages(ticker,ids)},
};
