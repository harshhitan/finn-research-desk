import {database} from '../repository';
import {hash,sourceVersion,stamp,parse} from './store';
import type {ResearchPassage} from './types';

export const factExtractor='financial-tables-5';
export const financialMetrics={operating_cash_flow:'Net cash from operating activities',investing_cash_flow:'Net cash from investing activities',financing_cash_flow:'Net cash from financing activities',revenue_from_operations:'Revenue from operations',profit_for_year:'Reported profit for the period',profit_before_tax:'Profit before tax'};
export type FinancialMetric=keyof typeof financialMetrics;
export type FinancialScope='consolidated'|'standalone';
export type FinancialFact={id:string;ticker:string;metric:FinancialMetric;period:string;periodEnd:string;durationMonths:3|12;scope:FinancialScope;definition:string;basis:'cash-flow total'|'continuing operations'|'reported total'|'uncertain';value:string;originalValue:string;currency:'INR';unit:'crore'|'lakh'|'million';validation:'validated'|'candidate';documentId:string;versionId:string;page:number;row:string;header:string;passages:ResearchPassage[];extractor:string};
export type FinancialFacts={facts:FinancialFact[];candidates:FinancialFact[];gaps:string[];sourceVersion:string;extractor:string};
const units={crore:BigInt('10000000'),lakh:BigInt('100000'),million:BigInt('1000000')};
const cashMetric=(metric:FinancialMetric)=>metric.endsWith('_cash_flow');
const metricPattern=(metric:FinancialMetric)=>cashMetric(metric)?new RegExp('net\\s+cash\\s+(?:flows?\\s+)?(?:(?:generated|provided|used)\\s*)?(?:from|by|in|from\\/\\(used in\\)|from\\s*\\/\\s*\\(used\\s+in\\))\\s+'+metric.split('_')[0]+'\\s+activities','i'):metric==='revenue_from_operations'?/^\s*(?:total\s+)?revenue\s+from\s+operations(?:\s*\(net\s+of\s+GST\))?/i:metric==='profit_before_tax'?/^\s*(?:total\s+)?profit\s+before\s+(?:income\s+)?tax(?:ation)?\b/i:/^\s*(?:total\s+)?profit(?:\s*\/\s*\(loss\))?\s+for\s+the\s+(?:year|period|quarter)(?:\s+from\s+continuing\s+operations)?\b/i;
const numberToken='(?:[−-]?\\d[\\d,]*(?:\\.\\d+)?|\\(\\d[\\d,]*(?:\\.\\d+)?\\))';
function decimal(value:string){const negative=/^(?:−|-|\()/.test(value),clean=value.replace(/[(),−-]/g,'');if(!/^\d+(?:\.\d{1,4})?$/.test(clean))throw new Error('Unsupported financial number');return (negative?'-':'')+clean;}
function exact(value:string){const [whole,fraction='']=value.replace('-','').split('.');return BigInt((value.startsWith('-')?'-':'')+(whole+fraction.padEnd(4,'0')));}
function formatted(value:bigint,places=4){const negative=value<BigInt('0'),absolute=negative?-value:value,scale=BigInt('10')**BigInt(places),fraction=(absolute%scale).toString().padStart(places,'0').replace(/0+$/,'');return (negative?'-':'')+(absolute/scale).toString()+(fraction?'.'+fraction:'');}

// Read only explicit statement rows and two unambiguous reporting columns.
// Quarterly tables may occur in reports or calls; narrative numbers are not a
// substitute for a verified table, accounting scope, unit or period header.
export function extractFinancialFacts(passages:ResearchPassage[],metric:FinancialMetric,scope:FinancialScope):Omit<FinancialFact,'id'>[]{
  if(!passages.length||passages.some(p=>!['annual_report','earnings_call'].includes(p.type)||p.ticker!==passages[0].ticker||p.document_id!==passages[0].document_id||p.version_id!==passages[0].version_id||p.page!==passages[0].page))return [];
  const text=passages.map(p=>p.text).join('\n'),heading=passages.map(p=>p.heading).join('\n'),normal=text.replace(/\s+/g,' ');
  if(/\b(?:forecast|projection|projected|budgeted|illustrative|pro forma|guidance)\b/i.test(heading+' '+text.slice(0,1000)))return [];
  const quarterly=/\b(?:quarter(?:ly)?|three\s+months?)\b.{0,30}\b(?:ended|results|information|performance)\b/i.test(heading+' '+normal.slice(0,1200));
  if(!(cashMetric(metric)?/statement\s+of\s+cash\s*flows?|cash\s*flow\s*statement/i:/statement\s+of\s+profit\s+(?:and|&)\s+loss|income\s+statement|quarterly\s+(?:financial\s+)?(?:results|information)|financial\s+results/i).test(heading+' '+normal)||(!quarterly&&(!/year\s+ended/i.test(normal)||!/(?:31\s*(?:st)?\s*(?:March|Mar\b)|March\s*31)/i.test(normal))))return [];
  const declared=new Set((heading+' '+text.slice(0,700)).match(/\b(?:consolidated|standalone)\b/gi)?.map(s=>s.toLowerCase()));
  if(declared.size!==1||!declared.has(scope))return [];
  const unitMatches=[...normal.matchAll(/(?:INR|Rs\.?|₹|`|\bH)\s*(?:in\s*)?(crores?|lakhs?|millions?|Mn)\b|\bin\s+(crores?|lakhs?|millions?|Mn)\s*(?:of\s*)?(?:INR|rupees|₹|`)/gi)].map(m=>{const unit=(m[1]||m[2]).toLowerCase().replace(/s$/,'');return unit==='mn'?'million':unit;});
  const unitSet=new Set(unitMatches);if(unitSet.size!==1||/\b(?:US\s*\$|USD|dollars?)\b/i.test(text))return [];
  const unit=[...unitSet][0] as FinancialFact['unit'];
  let periods:{period:string;periodEnd:string;durationMonths:3|12}[]=[];
  if(quarterly){
    // Mixed annual/quarterly columns need a layout-aware parser; do not guess.
    if(/\byear\s+ended\b/i.test(text))return [];
    const pairs=[...text.matchAll(/\bQ([1-4])\s+FY(20\d{2})[^\S\r\n]{2,}Q([1-4])\s+FY(20\d{2})\b/gi)];
    if(new Set(pairs.map(m=>m.slice(1).join(':'))).size!==1)return [];
    const m=pairs[0];if(!m)return [];
    const ends:Record<number,string>={1:'06-30',2:'09-30',3:'12-31',4:'03-31'};
    periods=[[Number(m[1]),Number(m[2])],[Number(m[3]),Number(m[4])]].map(([q,fy])=>({period:'Q'+q+' FY'+fy,periodEnd:String(fy-(q<4?1:0))+'-'+ends[q],durationMonths:3}));
    if(periods[0].period===periods[1].period||periods.some(p=>Date.parse(p.periodEnd)>Date.now()))return [];
  }else{
    if(passages[0].type!=='annual_report')return [];
    const yearPairs=[...text.matchAll(/\b(20\d{2})[^\S\r\n]{2,}(20\d{2})\b/g),...text.matchAll(/March\s+31,?\s+(20\d{2})[^\S\r\n]{2,}March\s+31,?\s+(20\d{2})/gi),...text.matchAll(/31\s+March\s+(20\d{2})[^\S\r\n]{2,}31\s+March\s+(20\d{2})/gi)].filter(m=>Math.abs(Number(m[1])-Number(m[2]))===1);
    const uniquePairs=[...new Map(yearPairs.map(m=>[m[1]+':'+m[2],m])).values()];if(uniquePairs.length!==1)return [];
    const pair=uniquePairs[0],years=[Number(pair[1]),Number(pair[2])],reportYear=Number(passages[0].period.match(/^FY(20\d{2})$/)?.[1]);
    const today=new Date(),latestCompletedAnnual=today.getUTCFullYear()-(today.getUTCMonth()<3?1:0);
    if(Math.max(...years)!==reportYear||reportYear>latestCompletedAnnual)return [];
    periods=years.map(year=>({period:'FY'+year,periodEnd:year+'-03-31',durationMonths:12}));
  }
  const noteColumns=[...new Set(text.split(/\r?\n/).filter(l=>/year\s+ended|^\s*notes?\s*$|particulars/i.test(l)).flatMap(l=>{const m=/\bnotes?\b/i.exec(l);return m?[m.index]:[];}))];
  const pattern=metricPattern(metric),rows: {row:string;values:string[]}[]=[];
  for(const line of text.split(/\r?\n/)){
    const match=pattern.exec(line);if(!match)continue;
    const rawRest=line.slice(match.index+match[0].length);
    let rest=rawRest.replace(/^\s*(?:[-–]\s*\[?[ABC]\]?|\*|\([ABC]\))?\s*/,'');
    const rawNumbers=[...rawRest.matchAll(new RegExp(numberToken,'g'))];
    // An explicit Note column is not a third financial amount. Remove it only
    // when the row's small reference occupies the observed header column.
    if(rawNumbers.length===3&&noteColumns.length===1&&/^\d{1,3}(?:\.\d{1,2})?$/.test(rawNumbers[0][0])&&Math.abs(noteColumns[0]-(match.index+match[0].length+rawNumbers[0].index!))<=3&&/^\s*$/.test(rawRest.slice(0,rawNumbers[0].index))){rest=rawRest.slice(rawNumbers[0].index!+rawNumbers[0][0].length);}
    const values=rest.match(new RegExp(numberToken,'g'))||[];
    if(values.length!==2||!new RegExp('^\\s*'+numberToken+'\\s{2,}'+numberToken+'\\s*$').test(rest))continue;
    rows.push({row:line.trim(),values});
  }
  const uniqueRows=[...new Map(rows.map(r=>[r.values.join('|'),r])).values()];if(uniqueRows.length!==1)return [];
  const row=uniqueRows[0];if(row.values.some(v=>!/^(?:−|-|\()?\d[\d,]*(?:\.\d{1,4})?\)?$/.test(v)))return [];
  const p=passages[0],header=[heading,...text.split(/\r?\n/).filter(l=>/year\s+ended|20\d{2}.*20\d{2}|crore|lakh|million|March|currency/i.test(l))].join('\n').slice(0,8000);
  const basis:FinancialFact['basis']=cashMetric(metric)?'cash-flow total':/discontinued\s+operations/i.test(text)?/from\s+continuing\s+operations/i.test(row.row)?'continuing operations':'uncertain':'reported total';
  return periods.map((period,i)=>({ticker:p.ticker,metric,...period,scope,definition:cashMetric(metric)?'reported net cash flow':financialMetrics[metric],basis,value:decimal(row.values[i]),originalValue:row.values[i],currency:'INR',unit,validation:basis==='uncertain'?'candidate':'validated',documentId:p.document_id,versionId:p.version_id,page:p.page,row:row.row,header,passages,extractor:factExtractor}));
}
export const extractCashFacts=extractFinancialFacts;
function periodPosition(period:string){const m=period.match(/^(?:Q([1-4]) )?FY(20\d{2})$/);return m?{rank:Number(m[2])*4+Number(m[1]||4),duration:m[1]?3:12}:null;}
export async function getFinancialFacts(ticker:string,metric:FinancialMetric,scope:FinancialScope):Promise<FinancialFacts>{
  if(!Object.hasOwn(financialMetrics,metric)||!['consolidated','standalone'].includes(scope))throw new Error('Choose a supported metric and accounting scope');
  const version=await sourceVersion(ticker),db=database();
  const cacheKey='research-facts:'+await hash(JSON.stringify([ticker,metric,scope,version,factExtractor])),cached=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(cacheKey).first<{data:string}>();
  if(cached){const result=parse<FinancialFacts|null>(cached.data,null);if(result?.sourceVersion===version)return result;}
  const match=cashMetric(metric)?'%net%cash%'+metric.split('_')[0]+'%activities%':metric==='revenue_from_operations'?'%revenue%operations%':metric==='profit_before_tax'?'%profit%before%tax%':'%profit%for%';
  const statement=cashMetric(metric)?'%statement of cash flow%':'%statement of profit and loss%',alternate=cashMetric(metric)?'%cash flow statement%':'%statement of profit & loss%';
  const query=(header:boolean,type:string,count:number)=>db.prepare(`SELECT c.*,d.title,d.period,d.type,d.source_url FROM research_chunks c JOIN research_documents d ON d.id=c.document_id AND d.active_version=c.version_id WHERE c.ticker=? AND d.type=? AND ${header?'(c.text LIKE ? OR c.heading LIKE ? OR c.text LIKE ? OR c.heading LIKE ?)':'c.text LIKE ?'} ORDER BY CAST(substr(d.period,-4) AS INTEGER) DESC,CASE WHEN c.heading LIKE '%statement of%' THEN 0 WHEN c.text LIKE '%\nConsolidated Statement%' OR c.text LIKE '%\nStandalone Statement%' THEN 1 ELSE 2 END,c.ordinal LIMIT ?`).bind(ticker,type,header?statement:match,...(header?[statement,alternate,alternate]:[]),count).all<ResearchPassage>();
  const [headers,annualRows,callHeaders,callRows]=await Promise.all([query(true,'annual_report',20),query(false,'annual_report',24),query(true,'earnings_call',12),query(false,'earnings_call',24)]);
  // Narrative mentions in calls cannot consume the annual statement budget.
  // Header-first candidates also find a total in a later chunk of the same page.
  const distinct=(rows:ResearchPassage[],limit:number)=>[...new Map(rows.map(p=>[p.document_id+':'+p.page,p])).values()].slice(0,limit);
  const pages=[...distinct([...headers.results,...annualRows.results],8),...distinct([...callHeaders.results,...callRows.results],4)],found:FinancialFact[]=[];
  for(const page of pages){
    const rows=await db.prepare('SELECT c.*,d.title,d.period,d.type,d.source_url FROM research_chunks c JOIN research_documents d ON d.id=c.document_id AND d.active_version=c.version_id WHERE c.ticker=? AND c.version_id=? AND c.page=? ORDER BY c.ordinal LIMIT 41').bind(ticker,page.version_id,page.page).all<ResearchPassage>();
    if(rows.results.length>40)continue;
    for(const fact of extractFinancialFacts(rows.results,metric,scope)){const id=await hash(JSON.stringify([fact.extractor,fact.ticker,fact.versionId,fact.page,fact.metric,fact.scope,fact.period,fact.value,fact.unit,fact.basis,fact.durationMonths]));found.push({...fact,id});}
  }
  if(await sourceVersion(ticker)!==version)throw new Error('Documents changed while reading financial tables. Please retry.');
  // Prefer the newest statement's comparative columns. Do not silently mix an
  // original prior-year number with a revised comparative in a newer statement.
  const facts:FinancialFact[]=[],candidates:FinancialFact[]=[],gaps:string[]=[];
  const selectedPeriods=[...new Set(found.map(f=>f.period))].sort((a,b)=>(periodPosition(b)?.rank||0)-(periodPosition(a)?.rank||0));
  if(selectedPeriods.length>12)gaps.push('Results are limited to the twelve most recent verified reporting periods.');
  for(const period of selectedPeriods.slice(0,12)){
    const options=found.filter(f=>f.period===period),latest=Math.max(...options.map(f=>periodPosition(f.passages[0].period)?.rank||0)),current=options.filter(f=>(periodPosition(f.passages[0].period)?.rank||0)===latest);
    if(new Set(current.map(f=>exact(f.value)*units[f.unit])).size!==1){gaps.push(period+': conflicting totals in the same reporting year; comparison withheld.');continue;}
    if(current.some(f=>f.validation!=='validated')){candidates.push(...current);gaps.push(period+': accounting basis requires review, so the figure remains a candidate and is excluded from calculations.');}else facts.push(current[0]);
  }
  if(!facts.length)gaps.push('No unambiguous '+scope+' table was verified with two reporting columns, INR units and the requested total row. Inspect the original statements; text search remains available.');
  if(facts.length||candidates.length)await db.batch([...facts,...candidates].map(f=>db.prepare('INSERT OR IGNORE INTO research_financial_facts(id,ticker,document_id,version_id,metric,period,scope,validation,data,extractor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(f.id,ticker,f.documentId,f.versionId,metric,f.period,scope,f.validation,JSON.stringify(f),factExtractor,stamp())));
  const result={facts,candidates,gaps,sourceVersion:version,extractor:factExtractor};
  await db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(cacheKey,JSON.stringify(result),stamp()).run();
  return result;
}
export function compareFinancialFacts(base:FinancialFact,current:FinancialFact){
  const aPeriod=periodPosition(base.period),bPeriod=periodPosition(current.period),distance=aPeriod&&bPeriod?bPeriod.rank-aPeriod.rank:0;
  if(base.validation!=='validated'||current.validation!=='validated'||base.ticker!==current.ticker||base.metric!==current.metric||base.scope!==current.scope||base.definition!==current.definition||base.basis!==current.basis||base.basis==='uncertain'||base.currency!==current.currency||base.durationMonths!==current.durationMonths||!aPeriod||!bPeriod||aPeriod.duration!==base.durationMonths||bPeriod.duration!==current.durationMonths||!(base.durationMonths===12?distance===4:[1,4].includes(distance)))throw new Error('Comparison requires the same company, metric, scope, currency, basis and consecutive annual periods, consecutive quarters or the same quarter a year apart');
  const a=exact(base.value)*units[base.unit],b=exact(current.value)*units[current.unit],difference=b-a;
  return {base,current,comparisonType:base.durationMonths===12?'annual YoY':distance===4?'quarterly YoY':'QoQ',change:formatted(difference/units[current.unit]),unit:current.unit,currency:current.currency,percent:a>BigInt('0')?formatted(difference*BigInt('1000000')/a,4):null,percentReason:a<=BigInt('0')?'Percentage growth is withheld for a zero or negative base.':null,formula:'change = current − base; percentage = (current − base) / base × 100',dependencies:[base.id,current.id],rounding:'Amounts retain four decimal places; percentage truncated to four decimal places.',modelInvoked:false};
}
export async function compareAnnualFacts(ticker:string,metric:FinancialMetric,scope:FinancialScope,basePeriod:string,currentPeriod:string){
  if(!periodPosition(basePeriod)||!periodPosition(currentPeriod))throw new Error('Choose two reporting periods');
  const result=await getFinancialFacts(ticker,metric,scope),base=result.facts.find(f=>f.period===basePeriod),current=result.facts.find(f=>f.period===currentPeriod);
  if(!base||!current)return {...result,comparison:null,gaps:[...result.gaps,'A verified total is missing for one or both selected periods; comparison withheld.']};
  const comparison=compareFinancialFacts(base,current),key='research-calculation:'+await hash(JSON.stringify([base.id,current.id,'annual-change-1']));
  await database().prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(key,JSON.stringify(comparison),stamp()).run();
  return {...result,comparison};
}
export function calculateProfitMargin(profit:FinancialFact,revenue:FinancialFact){
  if(profit.metric!=='profit_for_year'||revenue.metric!=='revenue_from_operations'||profit.validation!=='validated'||revenue.validation!=='validated'||profit.ticker!==revenue.ticker||profit.scope!==revenue.scope||profit.period!==revenue.period||profit.durationMonths!==revenue.durationMonths||profit.currency!==revenue.currency||profit.basis!==revenue.basis||profit.basis==='uncertain'||profit.versionId!==revenue.versionId)throw new Error('Margin requires verified profit and operating revenue from the same statement version, period, currency, scope and accounting basis');
  const numerator=exact(profit.value)*units[profit.unit],denominator=exact(revenue.value)*units[revenue.unit];
  if(denominator<=BigInt('0'))throw new Error('Margin is withheld for zero or negative operating revenue');
  return {period:profit.period,scope:profit.scope,basis:profit.basis,value:formatted(numerator*BigInt('1000000')/denominator,4),unit:'%',formula:'reported profit for the period / revenue from operations × 100',dependencies:[profit.id,revenue.id],profit,revenue,modelInvoked:false};
}
export async function compareProfitMargins(ticker:string,scope:FinancialScope,basePeriod:string,currentPeriod:string){
  if(!periodPosition(basePeriod)||!periodPosition(currentPeriod))throw new Error('Choose two reporting periods');
  const profit=await getFinancialFacts(ticker,'profit_for_year',scope),revenue=await getFinancialFacts(ticker,'revenue_from_operations',scope);
  if(profit.sourceVersion!==revenue.sourceVersion||await sourceVersion(ticker)!==profit.sourceVersion)throw new Error('Documents changed while verifying margin inputs. Please retry.');
  const facts=[...profit.facts,...revenue.facts],gaps=[...new Set([...profit.gaps,...revenue.gaps])],inputs=[basePeriod,currentPeriod].map(period=>({profit:profit.facts.find(f=>f.period===period),revenue:revenue.facts.find(f=>f.period===period)}));
  if(inputs.some(i=>!i.profit||!i.revenue))return {facts,gaps:[...gaps,'Verified profit and operating revenue are required for both periods; margin comparison withheld.'],marginComparison:null};
  try{
    // Reuse period/entity/definition checks before comparing the two ratios.
    const change=compareFinancialFacts(inputs[0].profit!,inputs[1].profit!),base=calculateProfitMargin(inputs[0].profit!,inputs[0].revenue!),current=calculateProfitMargin(inputs[1].profit!,inputs[1].revenue!);
    const marginComparison={base,current,comparisonType:change.comparisonType,changePercentagePoints:formatted(exact(current.value)-exact(base.value)),rounding:'Margins and their difference are truncated to four decimal places.',modelInvoked:false};
    const key='research-margin:'+await hash(JSON.stringify([...base.dependencies,...current.dependencies,'reported-margin-1']));
    await database().prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(key,JSON.stringify(marginComparison),stamp()).run();
    return {facts,gaps,marginComparison};
  }catch(e){return {facts,gaps:[...gaps,(e as Error).message],marginComparison:null};}
}
