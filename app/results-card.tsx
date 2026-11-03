"use client";
import {useEffect,useState} from "react";
import {ExternalLink,Loader2} from "lucide-react";
import type {GrowthComparison,ResultPoint,ResultsComparison} from "../lib/portfolio/results";

const number=(n:number)=>n.toLocaleString("en-IN",{maximumFractionDigits:2});
function PointSource({title,point}:{title:string;point:ResultPoint}){
  return <section className="result-point-source"><h5>{title}: {number(point.value)} {point.unit}</h5><p>{point.entity} · {point.periodEnd} · {point.scope} · {point.definition} · {point.basis}</p><small>Unit conversion: {number(point.value)} × {point.conversionFactor} = {number(point.inrCrore)} INR crore</small><blockquote>{point.source.quote}</blockquote><small>PDF page {point.source.page}</small><details><summary>Period, scope and definition evidence</summary>{point.source.periodDerivation&&<p>{point.source.periodDerivation}</p>}<blockquote>{point.source.contextQuote}</blockquote><small>PDF page {point.source.contextPage}</small>{point.source.contextEvidence?.map((ref,i)=><div key={i}><blockquote>{ref.quote}</blockquote><small>PDF page {ref.page}</small></div>)}</details><a className="text-button" href={point.source.url} target="_blank" rel="noreferrer">Original filing <ExternalLink size={12}/></a><small className="result-hash">SHA-256 {point.source.contentHash}</small></section>;
}
function Calculation({title,value}:{title:string;value:GrowthComparison}){
  return <section className="result-calculation"><h5>{title} · comparison quarter ended {value.targetPeriod}</h5>{value.status==="calculated"?<p>{value.formula}<br/>{number(value.inputs!.currentInrCrore)} / {number(value.inputs!.previousInrCrore)} → {value.pct!.toFixed(2)}%<br/>Inputs normalized to INR crore using exact unit conversion.</p>:<p>{value.reason}</p>}{value.previous&&<PointSource title="Comparison figure" point={value.previous}/>}</section>;
}
export default function ResultsCard({filingId,refreshedAt}:{filingId:string;refreshedAt?:string}){
  const [data,setData]=useState<ResultsComparison|null>(null),[error,setError]=useState(""),[groupIndex,setGroupIndex]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError("");setGroupIndex(0);
    fetch(`/api/portfolio/filings/${filingId}/results`,{signal:controller.signal}).then(async response=>{const value:any=await response.json();if(!response.ok)throw new Error(value.error||"Results could not be loaded.");if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[filingId,refreshedAt]);
  return <ResultsComparisonView data={data} error={error} groupIndex={groupIndex} onGroupChange={setGroupIndex}/>;
}
export function ResultsComparisonView({data,error="",groupIndex=0,onGroupChange=()=>{}}:{data:ResultsComparison|null;error?:string;groupIndex?:number;onGroupChange?:(index:number)=>void}){
  const group=data?.groups[groupIndex]||data?.groups[0];
  return <section className="results-card"><span className="eyebrow">RESULTS / REPORTED FIGURES & COMPARISONS</span><h3>Revenue, EBITDA, PBT & PAT</h3>{error?<p role="alert">{error}</p>:!data?<p className="portfolio-reader-status"><Loader2 size={15} className="spin"/>Checking sourced figures…</p>:!group?<div className="results-unavailable"><p>{data.reason}</p><small>No placeholder amounts or assumed growth rates are shown.</small></div>:<>
    <p className="results-period">Quarter ended {data.periodEnd}</p>
    {data.groups.length>1&&<div className="segmented" aria-label="Results accounting basis">{data.groups.map((g,i)=><button key={g.entity+g.scope+g.basis} className={i===groupIndex?"active":""} onClick={()=>onGroupChange(i)}>{g.entity} · {g.scope} · {g.basis}</button>)}</div>}
    <p className="results-basis">{group.entity} · {group.scope} · {group.basis}</p>
    <div className="results-table-scroll"><table><caption>Reported headline figures and compatible quarter comparisons</caption><thead><tr><th scope="col">Metric</th><th scope="col">Reported</th><th scope="col">QoQ</th><th scope="col">YoY</th></tr></thead><tbody>{group.rows.map(row=><tr key={row.name}><th scope="row">{row.name}</th><td>{row.current?<>{number(row.current.value)}<small>{row.current.unit}</small></>:<span title={row.reason||undefined}>Unavailable</span>}</td>{[row.qoq,row.yoy].map((c,i)=><td key={i}>{c.status==="calculated"?<span>{c.pct!>=0?"+":""}{c.pct!.toFixed(1)}%</span>:<span title={c.reason||undefined}>—<small>{c.reason}</small></span>}</td>)}</tr>)}</tbody></table></div>
    <div className="results-inspect">{group.rows.map(row=><details key={row.name}><summary>{row.name} · inspect figures and calculations</summary>{row.current?<PointSource title="Current figure" point={row.current}/>:<p>{row.reason}</p>}<Calculation title="QoQ" value={row.qoq}/><Calculation title="YoY" value={row.yoy}/></details>)}</div>
    {data.reason&&<p className="portfolio-caption">{data.reason}</p>}
  </>}{data?.coverage?.truncated&&<p className="portfolio-caption">Comparison coverage is limited to the selected filing and the most recent 50 available analyses. Older records have not been checked.</p>}{data&&<p className="portfolio-caption">{data.policy}</p>}</section>;
}
