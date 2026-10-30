import type { Corpus, Evidence, Market, Period } from "./types";
import type { PlotInput, PlotPoint, PlotRequest, PlotSeries, PlotSource, PlotSpec } from "./plot-types";

const annualSources:Record<string,string[]>={grossRevenue:["e-annual","e-income"],ebitda:["e-annual"],pat:["e-income","e-annual"],cfo:["e-cashflow"],cashCapex:["e-cashflow"],netDebt:["e-debt"]};
const colors=["#37644e","#b19a62","#70889b","#976a5e","#87975f"];
function base(c:Corpus,r:PlotRequest):PlotSpec{return {version:1,kind:r.kind,status:"unavailable",company:c.company.name,title:"Evidence-backed plot",description:"",frequency:r.frequency||"annual",notes:[],series:[],generatedAt:new Date().toISOString()};}
function unavailable(spec:PlotSpec,reason:string){return {...spec,status:"unavailable" as const,reason,series:[]};}
function source(c:Corpus,e:Evidence,path:string):PlotSource|undefined{
  const d=c.documents.find(d=>d.id===e.documentId);if(!d)return;
  return {id:`${e.id}:${path}`,evidenceId:e.id,documentId:d.id,title:d.title,url:e.url||d.url,section:e.section,page:e.page||e.pdfPage,factPath:`${e.id}.facts.${path}`};
}
function missing(id:string,label:string,date:string,metric:string,basis:string,reason:string):PlotPoint{return {id:`${id}:${metric}`,label,date,value:null,unit:"₹ crore",basis,kind:"reported",sources:[],missingReason:reason};}
function annualPoint(c:Corpus,p:Period,metric:string):PlotPoint{
  const basis=metric==="netDebt"?"Consolidated; at period end; debt less cash and marketable securities":metric==="cfo"?"Consolidated annual; cash from operations after tax":metric==="pat"?"Consolidated annual; PAT including associates/JVs, before NCI allocation":metric==="cashCapex"?"Consolidated annual; cash spending on property, equipment, spectrum and intangibles":"Consolidated annual; gross revenue includes GST; reported EBITDA";
  const blank=missing(p.period,p.period,p.periodEnd,metric,basis,"No matching verified source fact for this metric and period.");
  const value=p[metric];if(typeof value!=="number"||!Number.isFinite(value))return {...blank,missingReason:"This metric is not available for the selected annual period."};
  const candidates=(annualSources[metric]||[]).map(id=>c.evidence.find(e=>e.id===id)).filter((e):e is Evidence=>!!e&&/consolidated/i.test(e.basis||"")&&c.documents.some(d=>d.id===e.documentId&&d.allowedForResearch));
  const assertions=candidates.map(e=>({e,value:(e.facts?.[p.period] as Record<string,unknown>|undefined)?.[metric]})).filter(r=>typeof r.value==="number"&&Number.isFinite(r.value));
  if(!assertions.length||assertions.some(a=>a.value!==value))return {...blank,missingReason:"The stored value is missing evidence or conflicts with the source fact; no value was plotted."};
  const sources=assertions.map(a=>source(c,a.e,`${p.period}.${metric}`)).filter((s):s is PlotSource=>!!s);
  return sources.length?{...blank,value,sources}:blank;
}
function quarterlyPoint(c:Corpus,p:Period,metric:string):PlotPoint{
  const basis=metric==="netDebt"?"Consolidated; at quarter end; source comparison table":"Consolidated quarterly; Q1 FY2027 filing comparison basis; prior Q1 EBITDA excludes investment gain";
  const blank=missing(p.period,p.period,p.periodEnd,metric,basis,"No verified quarter-specific fact in the results comparison table.");
  const e=c.evidence.find(e=>e.id==="e-results-q1");if(!e||!/consolidated/i.test(String(e.facts?.quarterComparisonBasis||"")))return blank;
  const fact=((e.facts?.quarters as Record<string,Record<string,unknown>>|undefined)?.[p.period])?.[metric];const value=p[metric];
  if(typeof value!=="number"||!Number.isFinite(value)||fact!==value)return blank;
  const ref=source(c,e,`quarters.${p.period}.${metric}`);return ref?{...blank,value,sources:[ref]}:blank;
}
function input(metric:string,p:PlotPoint):PlotInput{return {metric,value:p.value!,unit:p.unit,basis:p.basis,sources:p.sources};}
function ratio(a:PlotPoint,b:PlotPoint):PlotPoint{
  const point:PlotPoint={...a,id:`${a.label}:margin`,unit:"%",kind:"calculated",basis:`${a.basis}; EBITDA divided by the same period's gross revenue`,value:null,sources:[],formula:"100 × EBITDA / gross revenue"};
  if(a.value==null||b.value==null||b.value<=0)return {...point,missingReason:"Both source-backed inputs and positive revenue are required; no ratio was calculated."};
  if(a.date!==b.date)return {...point,missingReason:"Input periods do not match."};
  return {...point,value:100*a.value/b.value,sources:[...a.sources,...b.sources],inputs:[input("EBITDA",a),input("Gross revenue",b)]};
}
function series(id:string,label:string,unit:string,points:PlotPoint[],display:"bar"|"line"="bar",axis:"left"|"right"="left",color=colors[0]):PlotSeries{return {id,label,unit,points,display,axis,color};}
function inWindow(date:string,r:PlotRequest){return (!r.from||date>=r.from)&&(!r.to||date<=r.to);}

export function buildPlot(c:Corpus,r:PlotRequest,market?:Market):PlotSpec{
  let spec=base(c,r);
  if(r.ticker&&r.ticker!==c.company.ticker)return unavailable(spec,"This company is not indexed. No values from another issuer were substituted.");
  if(r.from&&r.to&&r.from>r.to)return unavailable(spec,"The start date must precede the end date.");
  if(r.kind==="guidance")return unavailable({...spec,title:"Guidance vs. delivery"},"No verified set of numerical guidance and delivered actuals with matching metric, unit, scope and horizon is available. A chart would imply a comparison the evidence does not establish.");
  if(r.kind==="candlestick")return unavailable({...spec,title:"Candlestick chart"},"The stored market series contains closing prices and volume, not verified open/high/low values. Candles cannot be reconstructed from a closing price.");
  if(r.context==="research"&&(r.frequency==="quarterly"||r.kind==="price-volume"))return unavailable(spec,"Research-support plots use only the allowed annual-report/transcript corpus. Market data and quarterly results filings are available separately in Chart lab.");
  if(r.kind==="price-volume"){
    spec={...spec,title:"Closing price & traded volume",description:"Actual completed NSE sessions. No interpolation or holiday observations.",frequency:"daily"};
    if(!market||market.status!=="available"||!market.history?.length)return unavailable(spec,"No completed-session provider series is available. No sample price data was substituted.");
    if(!market.fetchedAt||!Number.isFinite(Date.parse(market.fetchedAt)))return unavailable(spec,"The provider retrieval timestamp is missing; provenance is incomplete.");
    if(market.history.some(p=>!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date))return unavailable(spec,"Invalid session dates were supplied by the provider; plot withheld.");
    const rows=market.history.filter(p=>inWindow(p.date,r));
    if(!rows.length)return unavailable(spec,"The provider has no completed sessions in this date window.");
    if(new Set(rows.map(p=>p.date)).size!==rows.length)return unavailable(spec,"The provider series contains duplicate session dates; plot withheld.");
    const providerSource=(date:string,metric:string):PlotSource=>({id:`yahoo:${date}:${metric}`,title:market.provider,url:"https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=3mo&interval=1d&events=splits",section:`NSE RELIANCE · completed session ${date}`,retrievedAt:market.fetchedAt,factPath:`chart.history[${date}].${metric}`});
    const points=(metric:"close"|"volume")=>rows.map(p=>({id:`${p.date}:${metric}`,label:p.date,date:p.date,value:Number.isFinite(p[metric])&&p[metric]>=0?p[metric]:null,unit:metric==="close"?"₹ / share":"shares",basis:metric==="close"?"Raw NSE daily closing price; not a total-return series":"Actual traded volume; shares per completed session",kind:"provider" as const,sources:[providerSource(p.date,metric)],missingReason:!Number.isFinite(p[metric])?"Invalid provider observation":undefined}));
    spec.series=[series("close","Closing price","₹ / share",points("close"),"line"),series("volume","Volume","shares",points("volume"),"bar","right",colors[1])];
    spec.notes=["Price and volume use separate, labelled axes. The price axis starts at zero.","Raw closing prices may reflect corporate actions; do not interpret this as adjusted investment return.",`Provider fetched: ${market.fetchedAt||"not recorded"}. ${market.stale?"Refresh failed; displaying the last successful series.":"Completed sessions only; not a live quote."}`];
  }else{
    if(c.currency!=="INR"||c.unit!=="crore")return unavailable(spec,"Financial currency/unit metadata is missing or incompatible; plot withheld.");
    const quarterly=r.frequency==="quarterly";
    if(quarterly&&!["performance","net-debt"].includes(r.kind))return unavailable(spec,"This comparison has verified annual inputs only. No quarterly observations were inferred.");
    const periods=[...(quarterly?c.quarterly:c.annual)].filter(p=>inWindow(p.periodEnd,r)).sort((a,b)=>a.periodEnd.localeCompare(b.periodEnd));
    if(!periods.length)return unavailable(spec,"No verified reporting periods fall in this window.");
    if(new Set(periods.map(p=>p.periodEnd)).size!==periods.length)return unavailable(spec,"Reporting dates are duplicated; plot withheld to avoid ambiguous periods.");
    const point=(p:Period,metric:string)=>quarterly?quarterlyPoint(c,p,metric):annualPoint(c,p,metric);
    spec.notes=["Missing or conflicting facts remain gaps. No interpolation, forecasts or zero-filling.","All financial values are INR crore unless a percentage is explicitly labelled."];
    if(r.kind==="performance"){
      spec={...spec,title:"Revenue & profitability",description:quarterly?"Consolidated quarterly comparison, on the source filing's stated basis.":"Consolidated annual gross revenue with a calculated EBITDA / revenue ratio."};
      const revenue=periods.map(p=>point(p,"grossRevenue"));const margins=periods.map((p,i)=>ratio(point(p,quarterly?"comparisonEbitda":"ebitda"),revenue[i]));
      spec.series=[series("grossRevenue","Gross revenue","₹ crore",revenue),series("margin","EBITDA / gross revenue","%",margins,"line","right",colors[1])];
      spec.notes.push("The line is calculated as 100 × EBITDA / gross revenue, using the bar's denominator. It is not a cash-flow margin.",quarterly?"Q1 FY2026 comparison EBITDA excludes the disclosed ₹8,924 crore investment-sale gain. Quarters not present in the verified table remain absent; spacing follows actual period ends.":"Reported annual EBITDA includes one-off gains where disclosed; reported growth is not automatically recurring operating growth.");
    }else if(r.kind==="cash-quality"){
      spec={...spec,title:"Are profits becoming cash?",description:"Annual consolidated PAT and operating cash flow, on matching fiscal periods."};
      spec.series=[series("pat","PAT incl. associates/JVs","₹ crore",periods.map(p=>point(p,"pat"))),series("cfo","Cash from operations","₹ crore",periods.map(p=>point(p,"cfo")),"bar","left",colors[1])];
      spec.notes.push("PAT is before non-controlling-interest allocation. CFO is after taxes. FY2024 CFO is not verified in this corpus and is displayed as a gap.");
    }else if(r.kind==="net-debt"){
      spec={...spec,title:"Net debt, across reporting dates",description:"Consolidated point-in-time debt, net of the stated cash and marketable-securities basket."};
      spec.series=[series("netDebt","Net debt","₹ crore",periods.map(p=>point(p,"netDebt")),"line")];
      spec.notes.push("This is a balance at each reporting date, not a period flow. The liquidity basket is not cash alone.");
    }else if(r.kind==="segment-ebitda"){
      const period=periods.at(-1)!;
      spec={...spec,title:"Which businesses drive EBITDA?",description:`Reported segment EBITDA · ${period.period}. Each bar is a distinct business scope.`};
      const e=c.evidence.find(e=>e.id==="e-segments");const segments=e?.facts?.segments as {id:string;ebitda:number}[]|undefined;
      // The source's segment array explicitly covers FY2026, never another year's numbers.
      const points=c.segments.map(s=>{const blank=missing(s.id,s.name,period.periodEnd,"ebitda","Segment EBITDA; FY2026; ₹ crore","No segment fact is verified for this period.");if(period.period!==e?.facts?.period)return blank;const fact=segments?.find(f=>f.id===s.id);const ref=e?source(c,e,`segments[id=${s.id}].ebitda`):undefined;return typeof s.ebitda==="number"&&Number.isFinite(s.ebitda)&&fact?.ebitda===s.ebitda&&ref?{...blank,value:s.ebitda,sources:[ref]}:blank;});
      spec.series=[series("segmentEbitda","Segment EBITDA","₹ crore",points)];
      spec.notes.push("Segment figures have different business scopes and eliminations. Bars are not a revenue-share pie and are not assumed to sum to the group total.","Media's comparative period changed with consolidation; this chart compares current-period levels, not like-for-like segment growth.");
    }
  }
  if(!spec.series.some(s=>s.points.some(p=>p.value!=null&&p.sources.length)))return unavailable(spec,"No source-backed values pass the period, unit and evidence checks for this plot.");
  return {...spec,status:"ready"};
}

export function plotCsv(spec:PlotSpec){
  const rows:(string|number|null)[][]=[["Company","Chart","Series","Period/session","Date","Value","Unit","Basis","Value kind","Formula","Calculation inputs","Evidence paths","Original sources","Source pages/sections"]];
  for(const s of spec.series)for(const p of s.points)rows.push([spec.company,spec.title,s.label,p.label,p.date,p.value,p.unit,p.basis,p.value==null?"missing":p.kind,p.formula||"",p.inputs?.map(i=>`${i.metric}=${i.value} ${i.unit}`).join("; ")||p.missingReason||"",p.sources.map(r=>r.factPath).join("; "),p.sources.map(r=>r.url).join("; "),p.sources.map(r=>`${r.page?`Page ${r.page}; `:""}${r.section}`).join(" | ")]);
  return rows.map(row=>row.map(value=>{const text=value==null?"":String(value);const safe=typeof value==="string"&&/^[=+@\-\t\r]/.test(text)?`'${text}`:text;return `"${safe.replaceAll('"','""')}"`;}).join(",")).join("\r\n");
}
