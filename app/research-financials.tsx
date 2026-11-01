"use client";
import {useState} from 'react';
import type {FinancialFact,FinancialMetric,FinancialScope} from '../lib/research/facts';
type Comparison={base:FinancialFact;current:FinancialFact;comparisonType:string;change:string;unit:string;percent:string|null;percentReason:string|null;formula:string;rounding:string};
type Margin={period:string;value:string;scope:string;formula:string};
type Result={facts:FinancialFact[];gaps:string[];comparison?:Comparison|null;marginComparison?:{base:Margin;current:Margin;comparisonType:string;changePercentagePoints:string;rounding:string}|null};
const metrics:Record<FinancialMetric|'profit_margin',string>={operating_cash_flow:'Operating cash flow',investing_cash_flow:'Investing cash flow',financing_cash_flow:'Financing cash flow',revenue_from_operations:'Revenue from operations',profit_for_year:'Profit for the period',profit_before_tax:'Profit before tax',profit_margin:'Profit / operating revenue margin'};
export default function ResearchFinancials({ticker}:{ticker:string}){
  const [metric,setMetric]=useState<FinancialMetric|'profit_margin'>('operating_cash_flow'),[scope,setScope]=useState<FinancialScope>('consolidated'),[base,setBase]=useState('2025'),[current,setCurrent]=useState('2026'),[quarterly,setQuarterly]=useState(false),[baseQuarter,setBaseQuarter]=useState('Q1'),[currentQuarter,setCurrentQuarter]=useState('Q2'),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const period=(year:string,quarter:string)=>quarterly?quarter+' FY'+year:'FY'+year;
  function changed(){setResult(null);setError('');}
  async function compare(){
    setBusy(true);changed();
    try{
      const response=await fetch('/api/research/facts/'+(metric==='profit_margin'?'margin':'compare'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,metric,scope,basePeriod:period(base,baseQuarter),currentPeriod:period(current,currentQuarter)})});
      const value:any=await response.json();if(!response.ok)throw new Error(value.error||'Financial comparison is unavailable.');setResult(value);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="rh-financials">
    <span className="eyebrow">SOURCE TOTALS / CODE CALCULATIONS</span><h3>Compare financial periods</h3>
    <p>Verify table columns, units and accounting scope before calculating. Annual YoY, quarterly YoY and QoQ require compatible reported totals. This does not call a model.</p>
    <form onSubmit={e=>{e.preventDefault();compare();}}>
      <label>Metric<select disabled={busy} aria-label="Financial metric" value={metric} onChange={e=>{setMetric(e.target.value as typeof metric);changed();}}>{Object.entries(metrics).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
      <label>Scope<select disabled={busy} aria-label="Accounting scope" value={scope} onChange={e=>{setScope(e.target.value as FinancialScope);changed();}}><option value="consolidated">Consolidated</option><option value="standalone">Standalone</option></select></label>
      <label>Periods<select disabled={busy} aria-label="Financial period type" value={quarterly?'quarterly':'annual'} onChange={e=>{const next=e.target.value==='quarterly';setQuarterly(next);if(next)setBase(current);else if(base===current)setBase(String(Number(current)-1));changed();}}><option value="annual">Annual</option><option value="quarterly">Quarterly</option></select></label>
      <label>From year<input disabled={busy} aria-label="Base financial year" value={base} onChange={e=>{setBase(e.target.value);changed();}} pattern="20[0-9]{2}" maxLength={4} required/></label>
      {quarterly&&<label>From quarter<select disabled={busy} aria-label="Base financial quarter" value={baseQuarter} onChange={e=>{setBaseQuarter(e.target.value);changed();}}>{[1,2,3,4].map(q=><option key={q}>Q{q}</option>)}</select></label>}
      <label>To year<input disabled={busy} aria-label="Current financial year" value={current} onChange={e=>{setCurrent(e.target.value);changed();}} pattern="20[0-9]{2}" maxLength={4} required/></label>
      {quarterly&&<label>To quarter<select disabled={busy} aria-label="Current financial quarter" value={currentQuarter} onChange={e=>{setCurrentQuarter(e.target.value);changed();}}>{[1,2,3,4].map(q=><option key={q}>Q{q}</option>)}</select></label>}
      <button className="outline-button" disabled={busy}>{busy?'Checking tables…':'Verify & compare'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {result&&<>
      {result.comparison&&<div className="rh-financial-result"><b>{result.comparison.base.period}: {result.comparison.base.originalValue} {result.comparison.base.unit} INR → {result.comparison.current.period}: {result.comparison.current.originalValue} {result.comparison.current.unit} INR</b><p>{result.comparison.comparisonType} change: {result.comparison.change} {result.comparison.unit} INR{result.comparison.percent!==null?` · ${result.comparison.percent}%`:''}</p>{result.comparison.percentReason&&<p>{result.comparison.percentReason}</p>}<small>{result.comparison.formula}. {result.comparison.rounding}</small></div>}
      {result.marginComparison&&<div className="rh-financial-result"><b>{result.marginComparison.base.period}: {result.marginComparison.base.value}% → {result.marginComparison.current.period}: {result.marginComparison.current.value}%</b><p>{result.marginComparison.comparisonType} change: {result.marginComparison.changePercentagePoints} percentage points</p><small>{result.marginComparison.current.formula}. This is a calculated ratio using the reported profit and operating-revenue definitions, not a company-disclosed operating margin. {result.marginComparison.rounding}</small></div>}
      {result.gaps.map((gap,i)=><p className="rh-coverage-note" key={i}>{gap}</p>)}
      {result.facts.filter(f=>[period(base,baseQuarter),period(current,currentQuarter)].includes(f.period)).map(f=><details className="rh-financial-source" key={f.id}><summary>{f.period} · {f.definition} · {f.originalValue} INR {f.unit} · {f.scope} · PDF page {f.page}</summary><pre>{f.header}{'\n\n'}{f.row}</pre><p>{f.durationMonths} months ended {f.periodEnd} · {f.basis} · {f.validation}. Comparative figures use the newest verified statement, including any reported revision.</p><a className="text-button" target="_blank" rel="noreferrer" href={`/api/research/documents/${f.documentId}/original?version=${f.versionId}#page=${f.page}`}>Inspect original statement ↗</a></details>)}
    </>}
  </section>;
}
