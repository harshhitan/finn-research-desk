import type {Filing,FilingAnalysis,MetricContext,Passage,ReportedMetric,ReportPeriod} from "./types";

export const analysisSchemaVersion=2;
export const headlineMetrics=["Revenue","EBITDA","PBT","PAT"] as const;
const factors:Record<string,number>={"INR crore":1,"INR lakh":.01,"INR million":.1,"INR billion":100};
const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
const whitespace=(value:string)=>value.replace(/\s+/g," ").trim();
const months=["January","February","March","April","May","June","July","August","September","October","November","December"];

export function validPeriodEnd(value:unknown):value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T00:00:00Z");
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value&&date.getUTCDate()===new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
}

export function supportsDate(quote:string,date:string){
  if(!validPeriodEnd(date))return false;
  const [year,month,day]=date.split("-").map(Number),name=months[month-1];
  const monthPattern=`(?:${name}|${name.slice(0,3)}${month===9?"t?":""})`;
  const gap="[\\s,./-]*",d=`0?${day}`,m=`0?${month}`;
  const suffix=day%100>=11&&day%100<=13?"th":({1:"st",2:"nd",3:"rd"} as Record<number,string>)[day%10]||"th";
  const namedDay=`${d}(?:${suffix})?`;
  return new RegExp(`(?:\\b${year}${gap}${m}${gap}${d}\\b|\\b${d}${gap}${m}${gap}${year}\\b|\\b${namedDay}${gap}${monthPattern}${gap}${year}\\b|\\b${monthPattern}${gap}${namedDay}${gap}${year}\\b)`,"i").test(quote);
}

export function validateReportPeriod(context:any,passages:Passage[]):ReportPeriod|null {
  if(context==null)return null;
  const passage=passages.find(p=>p.id===context.passageId);
  if(!passage||!validPeriodEnd(context.periodEnd)||![3,6,9,12].includes(context.durationMonths)||typeof context.quote!=="string"||context.quote.length>1800||!whitespace(passage.text).includes(whitespace(context.quote))||!supportsDate(context.quote,context.periodEnd))throw new Error("Reported financial period context is not supported by the filing");
  const durationPatterns:Record<number,RegExp>={3:/\b(?:three|3)\s+months?\s+ended\b|\bquarter(?:\s+and\s+half[ -]year)?\s+ended\b/i,6:/\b(?:six|6)\s+months?\s+ended\b|\bhalf[ -]year\s+ended\b/i,9:/\b(?:nine|9)\s+months?\s+ended\b/i,12:/\b(?:twelve|12)\s+months?\s+ended\b|\b(?:financial\s+)?year\s+ended\b/i};
  if(!durationPatterns[context.durationMonths].test(context.quote)||context.durationMonths===12&&/\bhalf[ -]year\s+ended\b/i.test(context.quote))throw new Error("Reported financial duration is not supported by its passage");
  return {periodEnd:context.periodEnd,durationMonths:context.durationMonths,passageId:context.passageId,quote:context.quote};
}
export function validateMetricContext(context:any,metric:ReportedMetric,passages:Passage[]):MetricContext|null {
  if(context==null)return null;
  validateReportPeriod(context,passages);
  if(!["consolidated","standalone"].includes(context.scope)||typeof context.entity!=="string"||context.entity.length<3||context.entity.length>180||!normalize(context.quote).includes(normalize(context.entity))||typeof context.definition!=="string"||context.definition.length<3||context.definition.length>150||!new RegExp(`\\b${context.scope}\\b`,"i").test(context.quote)||!normalize(context.quote).includes(normalize(context.definition))||!normalize(metric.basis).includes(context.scope))throw new Error("Reported financial entity, definition or scope is not supported by its passage");
  return {periodEnd:context.periodEnd,durationMonths:context.durationMonths,entity:context.entity,scope:context.scope,definition:context.definition,passageId:context.passageId,quote:context.quote};
}

export type ResultsReport={filing:Filing;analysis:FilingAnalysis};
export type ResultPoint={name:ReportedMetric["name"];value:number;unit:string;periodEnd:string;durationMonths:number;entity:string;scope:string;definition:string;basis:string;inrCrore:number;conversionFactor:number;source:{filingId:string;ticker:string;url:string;publishedAt:string;contentHash:string;page:number;quote:string;contextPage:number;contextQuote:string}};
export type GrowthComparison={status:"calculated"|"unavailable";targetPeriod:string;previous:ResultPoint|null;pct:number|null;reason:string|null;formula:string|null;inputs:{currentInrCrore:number;previousInrCrore:number}|null};
export type ResultRow={name:ReportedMetric["name"];current:ResultPoint|null;reason:string|null;qoq:GrowthComparison;yoy:GrowthComparison};
export type ResultsComparison={ticker:string;filingId:string;status:"ready"|"partial"|"unavailable";periodEnd:string|null;groups:{entity:string;scope:string;basis:string;rows:ResultRow[]}[];reason:string|null;policy:string;coverage?:{reportsConsidered:number;limit:number;truncated:boolean}};
const policy="Reported figures only. Current-filing comparatives take precedence. Comparisons require explicit three-month periods and matching scope, definition and accounting basis. Units are converted exactly to INR crore. No estimates, annual-to-quarter subtraction or zero-filled gaps.";

function point(report:ResultsReport,metric:ReportedMetric):ResultPoint|null {
  const c=metric.context;
  if(report.analysis.schemaVersion!==analysisSchemaVersion||!c||c.durationMonths!==3||!c.entity||!validPeriodEnd(c.periodEnd)||!Number.isFinite(metric.value)||!Object.hasOwn(factors,metric.unit)||!metric.basis||!c.definition||!report.analysis.contentHash)return null;
  if(!Number.isFinite(Date.parse(report.filing.publishedAt))||!Number.isFinite(metric.value*factors[metric.unit]))return null;
  const publishedDay=new Date(Date.parse(report.filing.publishedAt)+330*60000).toISOString().slice(0,10);
  if(c.periodEnd>publishedDay)return null;
  return {name:metric.name,value:metric.value,unit:metric.unit,periodEnd:c.periodEnd,durationMonths:c.durationMonths,entity:c.entity,scope:c.scope,definition:c.definition,basis:metric.basis,inrCrore:metric.value*factors[metric.unit],conversionFactor:factors[metric.unit],source:{filingId:report.filing.id,ticker:report.filing.ticker,url:report.filing.attachmentUrl||report.filing.sourceUrl,publishedAt:report.filing.publishedAt,contentHash:report.analysis.contentHash,page:Number(metric.passageId.match(/^p(\d+)/)?.[1]||0),quote:metric.quote,contextPage:Number(c.passageId.match(/^p(\d+)/)?.[1]||0),contextQuote:c.quote}};
}

function priorEnd(value:string,monthsBack:number){const d=new Date(value+"T00:00:00Z");return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-monthsBack+1,0)).toISOString().slice(0,10);}
const approximatelySame=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-10;
function select(points:ResultPoint[]):{value:ResultPoint|null;reason:string|null}{
  if(!points.length)return {value:null,reason:"A source-backed figure for this exact quarter is missing."};
  const first=points[0];
  if(points.some(p=>normalize(p.definition)!==normalize(first.definition)||!approximatelySame(p.inrCrore,first.inrCrore)))return {value:null,reason:"Source figures or metric definitions conflict for this quarter. No figure was selected."};
  return {value:first,reason:null};
}

function growth(current:ResultPoint|null,candidates:ResultPoint[],targetPeriod:string):GrowthComparison {
  const base:GrowthComparison={status:"unavailable",targetPeriod,previous:null,pct:null,reason:null,formula:null,inputs:null};
  if(!current)return {...base,reason:"The current-quarter metric is not verified."};
  const eligible=candidates.filter(p=>p.name===current.name&&p.periodEnd===targetPeriod&&normalize(p.entity)===normalize(current.entity)&&p.scope===current.scope&&normalize(p.basis)===normalize(current.basis)&&normalize(p.definition)===normalize(current.definition));
  const sameFiling=eligible.filter(p=>p.source.filingId===current.source.filingId);
  const selected=select(sameFiling.length?sameFiling:eligible);
  if(!selected.value)return {...base,reason:selected.reason};
  const previous=selected.value;
  if(previous.inrCrore<=0)return {...base,previous,reason:"The comparison-period figure is zero or negative; percentage growth is withheld."};
  const pct=100*(current.inrCrore/previous.inrCrore-1);
  if(!Number.isFinite(pct))return {...base,previous,reason:"The supplied figures do not produce a finite growth rate."};
  return {...base,status:"calculated",previous,pct,reason:null,formula:"100 × (current INR crore / comparison INR crore − 1)",inputs:{currentInrCrore:current.inrCrore,previousInrCrore:previous.inrCrore}};
}

export function buildResultsComparison(filing:Filing,reports:ResultsReport[]):ResultsComparison {
  const base:ResultsComparison={ticker:filing.ticker,filingId:filing.id,status:"unavailable",periodEnd:null,groups:[],reason:null,policy};
  const eligible=reports.filter(r=>r.filing.ticker===filing.ticker&&r.filing.publishedAt<=filing.publishedAt);
  const points=eligible.flatMap(r=>r.analysis.metrics.map(m=>point(r,m)).filter((p):p is ResultPoint=>!!p));
  const currentPoints=points.filter(p=>p.source.filingId===filing.id),primary=eligible.find(r=>r.filing.id===filing.id)?.analysis.resultPeriod;
  const periodEnd=primary?.durationMonths===3&&validPeriodEnd(primary.periodEnd)?primary.periodEnd:null;
  if(!periodEnd)return {...base,reason:"The primary reporting quarter is not verified. Connect an authorized model account and analyse the original results; an older comparison quarter will not be substituted."};
  const current=currentPoints.filter(p=>p.periodEnd===periodEnd),groupKey=(p:ResultPoint)=>`${normalize(p.entity)}|${p.scope}|${normalize(p.basis)}`,groupKeys=[...new Set(current.map(groupKey))];
  if(!current.length)return {...base,periodEnd,reason:"No verified headline figures are available for the filing's primary quarter. Earlier comparison periods have not been substituted."};
  const groups=groupKeys.map(key=>{
    const values=current.filter(p=>groupKey(p)===key),first=values[0];
    return {entity:first.entity,scope:first.scope,basis:first.basis,rows:headlineMetrics.map(name=>{
      const selected=select(values.filter(p=>p.name===name));
      return {name,current:selected.value,reason:selected.reason,qoq:growth(selected.value,points,priorEnd(periodEnd,3)),yoy:growth(selected.value,points,priorEnd(periodEnd,12))};
    })};
  });
  const complete=groups.every(g=>g.rows.every(r=>r.current&&r.qoq.status==="calculated"&&r.yoy.status==="calculated"));
  return {...base,periodEnd,groups,status:complete?"ready":"partial",reason:complete?null:"Some headline metrics or comparable quarters are unavailable. Inspect the reason beside each gap."};
}
