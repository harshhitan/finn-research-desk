import {completedSessionStats} from "../market-calculations";
import type {Company} from "./companies";
import {categories,type Category,type Filing,type Quote} from "./types";
export const nseAnnouncements="https://www.nseindia.com/companies-listing/corporate-filings-announcements";
export const rssUrl="https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml";
const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function exchangeDate(value:string){
  // NSE dates have no timezone suffix. They are explicitly Indian local time.
  let match=value?.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if(match){const month=months.findIndex(m=>m.toLowerCase()===match![2].toLowerCase())+1;if(!month)throw new Error("Unknown exchange month");return new Date(`${match[3]}-${String(month).padStart(2,"0")}-${match[1]}T${match[4]}:${match[5]}:${match[6]}+05:30`).toISOString();}
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return new Date(value.replace(" ","T")+"+05:30").toISOString();
  if(!/(?:GMT|UTC|[+-]\d{4}|Z|[+-]\d{2}:\d{2})$/.test(value?.trim()))throw new Error("Exchange timestamp has no known timezone");
  const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error("Invalid exchange timestamp");return date.toISOString();
}
export function classify(text:string):{category:Category;priority:Filing["priority"]}{
  const rules:[Category,RegExp,Filing["priority"]][]=[
    ["results",/financial results|quarterly results|audited results|unaudited results/i,"high"],
    ["M&A",/acquisition|amalgamation|merger|demerger|restructuring/i,"high"],
    ["management_change",/chief .*officer|\bCFO\b|\bCEO\b|managing director|appointment.*director|resignation.*director|senior management/i,"high"],
    ["fund_raise",/fund rais|fundrais|preferential|\bQIP\b|rights issue|issuance.*securit/i,"high"],
    ["litigation",/litigation|penalty|penalties|fine imposed|arbitration|court order|regulatory action|insolvency|\bNCLT\b|\bNCLAT\b|tribunal/i,"high"],
    ["credit_rating",/credit rating|rating.*revis|rating.*reaffirm/i,"medium"],
    ["pledging",/pledge|encumbrance/i,"high"],
    ["insider_trading",/insider|trading window|prohibition.*trading/i,"routine"],
    ["earnings_call",/earnings call|concall|conference call|transcript|audio recording/i,"medium"],
    ["investor_meetings",/investor.*meet|analyst.*meet|investor.*presentation|investor.*conference/i,"routine"],
    ["bonus_split",/bonus issue|stock split|sub.?division|buyback|buy.back/i,"medium"],
    ["dividend",/dividend|record date/i,"medium"],
    ["capex",/capex|capacity expansion|commissioning|new plant|capital expenditure|commercial operation|declared commercial|commercial production/i,"high"],
    ["postal_ballot",/postal ballot/i,"routine"],
    ["agm_egm",/annual general meeting|extra.?ordinary general meeting|\bAGM\b|\bEGM\b/i,"routine"],
    ["press_release",/press release|media release/i,"medium"],
    ["unclassified",/newspaper publication|compliance certificate|loss of share certificate|duplicate share certificate|demateriali[sz]ation/i,"routine"],
  ];
  const rule=rules.find(([,pattern])=>pattern.test(text));return rule?{category:rule[0],priority:rule[2]}:{category:"unclassified",priority:"medium"};
}
export function safeAttachment(value:string|null){
  if(!value)return null;try{const u=new URL(value);if(u.protocol!=="https:"||u.port||u.username||u.password||!["nsearchives.nseindia.com","archives.nseindia.com","www.bseindia.com"].includes(u.hostname))return null;u.hash="";return u.href;}catch{return null;}
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,"0")).join("");}
export async function boundedText(response:Response,max=6_000_000){
  if(!response.ok){await response.body?.cancel();throw new Error(`Provider returned HTTP ${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error("Empty provider response");let size=0;const decoder=new TextDecoder();let text="";
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>max)throw new Error("Provider response exceeds size limit");text+=decoder.decode(item.value,{stream:true});}return text+decoder.decode();}catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
}
export async function nseFilings(company:Company,from:string,to:string,fetcher:typeof fetch=fetch):Promise<Filing[]>{
  const format=(date:string)=>{const [y,m,d]=new Date(Date.parse(date)+330*60000).toISOString().slice(0,10).split("-");return `${d}-${m}-${y}`;};
  const url=new URL("https://www.nseindia.com/api/corporate-announcements");url.search=new URLSearchParams({index:"equities",symbol:company.ticker,from_date:format(from),to_date:format(to)}).toString();
  const text=await boundedText(await fetcher(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json","Referer":nseAnnouncements},signal:AbortSignal.timeout(16000)}));
  const rows=JSON.parse(text);if(!Array.isArray(rows))throw new Error("NSE returned an unexpected response");if(rows.length>5000)throw new Error("NSE response too large; narrow backfill window");
  const now=new Date().toISOString();const filings:Filing[]=[];
  for(const row of rows){
    if(row.symbol!==company.ticker||row.sm_isin&&row.sm_isin!==company.isin)continue;
    const publishedAt=exchangeDate(row.an_dt||row.sort_date);if(publishedAt>now)continue;
    const attachmentUrl=safeAttachment(row.attchmntFile);const title=String(row.desc||"Exchange disclosure").slice(0,300),description=String(row.attchmntText||"").slice(0,8000);
    const exchangeId=String(row.seq_id||await digest([company.ticker,publishedAt,title,attachmentUrl].join("|")));
    filings.push({id:`nse-${exchangeId}`,ticker:company.ticker,exchangeId,title,description,...classify(title+" "+description),publishedAt,attachmentUrl,sourceUrl:nseAnnouncements,fetchedAt:now,firstSeenAt:now,datePrecision:"second"});
  }
  return filings;
}
const unescapeXml=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
export function parseNseRss(xml:string,company:Company):{title:string;description:string;url:string;publishedAt:string}[]{
  const tag=(item:string,name:string)=>unescapeXml(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,"i"))?.[1]||"").trim();
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>m[1]);const normal=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"").replace(/limited$/,"").replace(/^the/,"");
  return items.filter(item=>normal(tag(item,"title"))===normal(company.name)||tag(item,"description").includes(company.isin)).flatMap(item=>{try{return [{title:tag(item,"title"),description:tag(item,"description"),url:tag(item,"link"),publishedAt:exchangeDate(tag(item,"pubDate"))}];}catch{return [];}});
}
export async function quoteFor(company:Company,fetcher:typeof fetch=fetch):Promise<Quote>{
  const sourceUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(company.priceSymbol)}?range=3mo&interval=1d&events=splits`;
  const raw=JSON.parse(await boundedText(await fetcher(sourceUrl,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"},signal:AbortSignal.timeout(12000)}),1_000_000));const result=raw.chart?.result?.[0];
  if(!result||result.meta?.symbol!==company.priceSymbol||result.meta.currency!=="INR"||result.meta.instrumentType!=="EQUITY"||result.meta.exchangeTimezoneName!=="Asia/Kolkata")throw new Error("Market instrument identity or currency could not be verified");
  const series=result.indicators?.quote?.[0],adjusted=result.indicators?.adjclose?.[0]?.adjclose;
  const bars=(result.timestamp||[]).map((t:number,i:number)=>({date:new Date(t*1000).toISOString().slice(0,10),close:series?.close?.[i],volume:series?.volume?.[i],...(Number.isFinite(adjusted?.[i])?{comparableClose:adjusted[i]}:{})}));
  const splits=Object.values(result.events?.splits||{}).map((s:any)=>new Date(s.date*1000).toISOString().slice(0,10));
  const stats=completedSessionStats(bars,splits);if(!stats)throw new Error("No completed trading session is available");
  return {ticker:company.ticker,sessionDate:stats.last.date,close:stats.last.close,volume:stats.last.volume,movePct:stats.movePct,volumeMultiple:stats.volumeMultiple,baselineSessions:stats.baseline.map(b=>b.date),history:stats.history,split:stats.split,fetchedAt:new Date().toISOString(),sourceUrl,currency:"INR"};
}
