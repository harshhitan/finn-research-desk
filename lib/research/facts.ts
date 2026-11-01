import {database} from '../repository';
import {hash,sourceVersion,stamp,parse} from './store';
import type {ResearchPassage} from './types';

export const factExtractor='cash-tables-1';
export const financialMetrics={operating_cash_flow:'Net cash from operating activities',investing_cash_flow:'Net cash from investing activities',financing_cash_flow:'Net cash from financing activities'};
export type FinancialMetric=keyof typeof financialMetrics;
export type FinancialScope='consolidated'|'standalone';
export type FinancialFact={id:string;ticker:string;metric:FinancialMetric;period:string;periodEnd:string;durationMonths:12;scope:FinancialScope;definition:'reported net cash flow';value:string;originalValue:string;currency:'INR';unit:'crore'|'lakh'|'million';validation:'validated';documentId:string;versionId:string;page:number;row:string;header:string;passages:ResearchPassage[];extractor:string};
export type FinancialFacts={facts:FinancialFact[];gaps:string[];sourceVersion:string;extractor:string};
const units={crore:BigInt('10000000'),lakh:BigInt('100000'),million:BigInt('1000000')};
const metricPattern=(metric:FinancialMetric)=>new RegExp('net\\s+cash\\s+(?:flows?\\s+)?(?:(?:generated|provided|used)\\s*)?(?:from|by|in|from\\/\\(used in\\)|from\\s*\\/\\s*\\(used\\s+in\\))\\s+'+metric.split('_')[0]+'\\s+activities','i');
const numberToken='(?:[−-]?\\d[\\d,]*(?:\\.\\d+)?|\\(\\d[\\d,]*(?:\\.\\d+)?\\))';
function decimal(value:string){const negative=/^(?:−|-|\()/.test(value),clean=value.replace(/[(),−-]/g,'');if(!/^\d+(?:\.\d{1,4})?$/.test(clean))throw new Error('Unsupported financial number');return (negative?'-':'')+clean;}
function exact(value:string){const [whole,fraction='']=value.replace('-','').split('.');return BigInt((value.startsWith('-')?'-':'')+(whole+fraction.padEnd(4,'0')));}
function formatted(value:bigint,places=4){const negative=value<BigInt('0'),absolute=negative?-value:value,scale=BigInt('10')**BigInt(places),fraction=(absolute%scale).toString().padStart(places,'0').replace(/0+$/,'');return (negative?'-':'')+(absolute/scale).toString()+(fraction?'.'+fraction:'');}

// Deliberately narrow: unambiguous annual cash-flow statement rows with an
// explicit year pair, March year-end, currency/unit and accounting scope. Other
// layouts remain searchable evidence; they never become guessed numeric facts.
export function extractCashFacts(passages:ResearchPassage[],metric:FinancialMetric,scope:FinancialScope):Omit<FinancialFact,'id'>[]{
  if(!passages.length||passages.some(p=>p.type!=='annual_report'||p.document_id!==passages[0].document_id||p.version_id!==passages[0].version_id||p.page!==passages[0].page))return [];
  const text=passages.map(p=>p.text).join('\n'),heading=passages.map(p=>p.heading).join('\n'),normal=text.replace(/\s+/g,' ');
  if(!/statement\s+of\s+cash\s*flows?|cash\s*flow\s*statement/i.test(heading+' '+normal)||!/year\s+ended/i.test(normal)||!/(?:31\s*(?:st)?\s*(?:March|Mar\b)|March\s*31)/i.test(normal))return [];
  const declared=new Set((heading+' '+text.slice(0,700)).match(/\b(?:consolidated|standalone)\b/gi)?.map(s=>s.toLowerCase()));
  if(declared.size!==1||!declared.has(scope))return [];
  const unitMatches=[...normal.matchAll(/(?:INR|Rs\.?|₹|`|\bH)\s*(?:in\s*)?(crores?|lakhs?|millions?)\b|\bin\s+(crores?|lakhs?|millions?)\s*(?:of\s*)?(?:INR|rupees|₹|`)/gi)].map(m=>(m[1]||m[2]).toLowerCase().replace(/s$/,''));
  const unitSet=new Set(unitMatches);if(unitSet.size!==1||/\b(?:US\s*\$|USD|dollars?)\b/i.test(text))return [];
  const unit=[...unitSet][0] as FinancialFact['unit'];
  const yearPairs=[...text.matchAll(/\b(20\d{2})[^\S\r\n]{2,}(20\d{2})\b/g),...text.matchAll(/March\s+31,?\s+(20\d{2})[^\S\r\n]{2,}March\s+31,?\s+(20\d{2})/gi),...text.matchAll(/31\s+March\s+(20\d{2})[^\S\r\n]{2,}31\s+March\s+(20\d{2})/gi)].filter(m=>Math.abs(Number(m[1])-Number(m[2]))===1);
  const uniquePairs=[...new Map(yearPairs.map(m=>[m[1]+':'+m[2],m])).values()];if(uniquePairs.length!==1)return [];
  const pair=uniquePairs[0],years=[Number(pair[1]),Number(pair[2])],reportYear=Number(passages[0].period.match(/^FY(20\d{2})$/)?.[1]);
  const today=new Date(),latestCompletedAnnual=today.getUTCFullYear()-(today.getUTCMonth()<3?1:0);
  if(Math.max(...years)!==reportYear||reportYear>latestCompletedAnnual)return [];
  const pattern=metricPattern(metric),rows: {row:string;values:string[]}[]=[];
  for(const line of text.split(/\r?\n/)){
    const match=pattern.exec(line);if(!match)continue;
    const rest=line.slice(match.index+match[0].length).replace(/^\s*(?:[-–]\s*[ABC]|\*|\([ABC]\))?\s*/,'');
    const values=rest.match(new RegExp(numberToken,'g'))||[];
    if(values.length!==2||!new RegExp('^\\s*'+numberToken+'\\s{2,}'+numberToken+'\\s*$').test(rest))continue;
    rows.push({row:line.trim(),values});
  }
  const uniqueRows=[...new Map(rows.map(r=>[r.values.join('|'),r])).values()];if(uniqueRows.length!==1)return [];
  const row=uniqueRows[0];if(row.values.some(v=>!/^(?:−|-|\()?\d[\d,]*(?:\.\d{1,4})?\)?$/.test(v)))return [];
  const p=passages[0],header=[heading,...text.split(/\r?\n/).filter(l=>/year\s+ended|20\d{2}.*20\d{2}|crore|lakh|million|March|currency/i.test(l))].join('\n').slice(0,8000);
  return years.map((year,i)=>({ticker:p.ticker,metric,period:'FY'+year,periodEnd:year+'-03-31',durationMonths:12,scope,definition:'reported net cash flow',value:decimal(row.values[i]),originalValue:row.values[i],currency:'INR',unit,validation:'validated',documentId:p.document_id,versionId:p.version_id,page:p.page,row:row.row,header,passages,extractor:factExtractor}));
}
export async function getFinancialFacts(ticker:string,metric:FinancialMetric,scope:FinancialScope):Promise<FinancialFacts>{
  if(!Object.hasOwn(financialMetrics,metric)||!['consolidated','standalone'].includes(scope))throw new Error('Choose a supported metric and accounting scope');
  const version=await sourceVersion(ticker),db=database();
  const cacheKey='research-facts:'+await hash(JSON.stringify([ticker,metric,scope,version,factExtractor])),cached=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(cacheKey).first<{data:string}>();
  if(cached){const result=parse<FinancialFacts|null>(cached.data,null);if(result?.sourceVersion===version)return result;}
  const candidates=await db.prepare("SELECT c.*,d.title,d.period,d.type,d.source_url FROM research_chunks c JOIN research_documents d ON d.id=c.document_id AND d.active_version=c.version_id WHERE c.ticker=? AND d.type='annual_report' AND c.text LIKE ? ORDER BY d.period DESC,c.ordinal LIMIT 40").bind(ticker,'%net%cash%'+metric.split('_')[0]+'%activities%').all<ResearchPassage>();
  const pages=[...new Map(candidates.results.map(p=>[p.document_id+':'+p.page,p])).values()].slice(0,12),found:FinancialFact[]=[];
  for(const page of pages){
    const rows=await db.prepare('SELECT c.*,d.title,d.period,d.type,d.source_url FROM research_chunks c JOIN research_documents d ON d.id=c.document_id AND d.active_version=c.version_id WHERE c.ticker=? AND c.version_id=? AND c.page=? ORDER BY c.ordinal LIMIT 41').bind(ticker,page.version_id,page.page).all<ResearchPassage>();
    if(rows.results.length>40)continue;
    for(const fact of extractCashFacts(rows.results,metric,scope)){const id=await hash(JSON.stringify([fact.extractor,fact.ticker,fact.versionId,fact.page,fact.metric,fact.scope,fact.period,fact.value,fact.unit]));found.push({...fact,id});}
  }
  if(await sourceVersion(ticker)!==version)throw new Error('Documents changed while reading financial tables. Please retry.');
  // Prefer the newest statement's comparative columns. Do not silently mix an
  // original prior-year number with a revised comparative in a newer statement.
  const facts:FinancialFact[]=[],gaps:string[]=[];
  for(const period of [...new Set(found.map(f=>f.period))].sort().reverse()){
    const options=found.filter(f=>f.period===period),latest=Math.max(...options.map(f=>Number(f.passages[0].period.slice(2)))),current=options.filter(f=>Number(f.passages[0].period.slice(2))===latest);
    if(new Set(current.map(f=>exact(f.value)*units[f.unit])).size!==1){gaps.push(period+': conflicting totals in the same reporting year; comparison withheld.');continue;}
    facts.push(current[0]);
  }
  if(!facts.length)gaps.push('No unambiguous '+scope+' annual table was verified with two year columns, INR units and the total row. Inspect the original statements; text search remains available.');
  if(facts.length)await db.batch(facts.map(f=>db.prepare('INSERT OR IGNORE INTO research_financial_facts(id,ticker,document_id,version_id,metric,period,scope,validation,data,extractor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(f.id,ticker,f.documentId,f.versionId,metric,f.period,scope,f.validation,JSON.stringify(f),factExtractor,stamp())));
  const result={facts,gaps,sourceVersion:version,extractor:factExtractor};
  await db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(cacheKey,JSON.stringify(result),stamp()).run();
  return result;
}
export function compareFinancialFacts(base:FinancialFact,current:FinancialFact){
  if(base.validation!=='validated'||current.validation!=='validated'||base.ticker!==current.ticker||base.metric!==current.metric||base.scope!==current.scope||base.definition!==current.definition||base.currency!==current.currency||base.durationMonths!==12||current.durationMonths!==12||Number(current.period.slice(2))!==Number(base.period.slice(2))+1)throw new Error('Comparison requires the same company, metric, scope, currency and consecutive annual periods');
  const a=exact(base.value)*units[base.unit],b=exact(current.value)*units[current.unit],difference=b-a;
  return {base,current,change:formatted(difference/units[current.unit]),unit:current.unit,currency:current.currency,percent:a>BigInt('0')?formatted(difference*BigInt('1000000')/a,4):null,percentReason:a<=BigInt('0')?'Percentage growth is withheld for a zero or negative base.':null,formula:'change = current − base; percentage = (current − base) / base × 100',dependencies:[base.id,current.id],rounding:'Amounts retain four decimal places; percentage truncated to four decimal places.',modelInvoked:false};
}
export async function compareAnnualFacts(ticker:string,metric:FinancialMetric,scope:FinancialScope,basePeriod:string,currentPeriod:string){
  if(!/^FY20\d{2}$/.test(basePeriod)||!/^FY20\d{2}$/.test(currentPeriod))throw new Error('Choose two annual periods');
  const result=await getFinancialFacts(ticker,metric,scope),base=result.facts.find(f=>f.period===basePeriod),current=result.facts.find(f=>f.period===currentPeriod);
  if(!base||!current)return {...result,comparison:null,gaps:[...result.gaps,'A verified total is missing for one or both selected periods; comparison withheld.']};
  const comparison=compareFinancialFacts(base,current),key='research-calculation:'+await hash(JSON.stringify([base.id,current.id,'annual-change-1']));
  await database().prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(key,JSON.stringify(comparison),stamp()).run();
  return {...result,comparison};
}
