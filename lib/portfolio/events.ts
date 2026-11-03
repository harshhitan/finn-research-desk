import type {Filing,FilingAnalysis} from './types';
export type PortfolioEvent={id:string;ticker:string;title:string;category:string;priority:'high'|'medium'|'routine';publishedAt:string;period:string|null;filings:Filing[];primary:Filing;analysis?:FilingAnalysis;reason:string;amended:boolean};
export const priorityReasons:Record<string,string>={results:'Reported financial performance and comparison periods deserve review.',management_change:'A leadership or board change may affect oversight and execution.',"M&A":'Transaction terms, size, approvals and conditions deserve review.',fund_raise:'Funding terms may affect debt, financing costs or dilution.',litigation:'The legal or regulatory outcome and its financial scope deserve review.',credit_rating:'The rating action and rationale may affect financing conditions.',capex:'The investment or operating-capacity change may affect future cash requirements.',pledging:'Changes in pledged shares deserve a review of financing exposure.',earnings_call:'Management commentary may add context to the reported results.',investor_meetings:'A meeting or recording notice provides timing and source access.',dividend:'Check the distribution, record date and applicable conditions.',bonus_split:'The corporate action affects share counts and price comparability.'};
export function reportingEnd(f:Filing,analysis?:FilingAnalysis){
  if(analysis?.resultPeriod?.periodEnd)return analysis.resultPeriod.periodEnd;
  const text=f.title+' '+f.description;if(!/financial results|quarter|half.year|earnings/i.test(text))return null;
  const names=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const m=/(?:ended|ending)\s+(?:(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?)[,\s]+(20\d{2})/i.exec(text);
  if(!m)return null;const month=names.findIndex(n=>n.startsWith((m[2]||m[3]).toLowerCase()));if(month<0)return null;
  const date=`${m[5]}-${String(month+1).padStart(2,'0')}-${String(Number(m[1]||m[4])).padStart(2,'0')}`;return Number.isFinite(Date.parse(date))?date:null;
}
export function groupPortfolioEvents(filings:Filing[],analyses:Record<string,FilingAnalysis>={}):PortfolioEvent[]{
  const groups=new Map<string,{period:string|null;filings:Filing[]}>(),rank={high:0,medium:1,routine:2};
  for(const f of filings){const a=analyses[f.id],period=reportingEnd(f,a),results=!!period&&(f.category==='results'||f.category==='earnings_call'||/financial results|unaudited|audited|quarter.*results|earnings/i.test(f.title+' '+f.description)||a?.category==='results');const key=results?f.ticker+':results:'+period:f.id;const group=groups.get(key)||{period:results?period:null,filings:[]};group.filings.push(f);groups.set(key,group);}
  return [...groups.entries()].map(([id,g])=>{
    const members=[...g.filings].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
    const quality=(f:Filing)=>{const a=analyses[f.id];return (a?.hasVerifiedFigures?100:0)+((a?.metricCount??a?.metrics.length)?50:0)+(a?.resultPeriod?20:0)+(a?.sourceKind==='pdf'?10:0)+(a?5:0)+(/press release|financial results|outcome of board/i.test(f.title)?3:0);};
    const primary=[...members].sort((a,b)=>quality(b)-quality(a)||b.publishedAt.localeCompare(a.publishedAt))[0],analysis=analyses[primary.id];
    const priority=[...members].map(f=>analyses[f.id]?.priority||f.priority).sort((a,b)=>rank[a]-rank[b])[0];
    const category=g.period?'results':analysis?.category||primary.category;
    return {id,ticker:primary.ticker,title:g.period?'Results · period ended '+g.period:primary.title,category,priority,publishedAt:members[0].publishedAt,period:g.period,filings:members,primary,analysis,reason:priorityReasons[category]||'Review the source disclosure for the event scope and effective dates.',amended:members.some(f=>/revis|amend|corrigend|correct/i.test(f.title+' '+f.description))};
  }).sort((a,b)=>rank[a.priority]-rank[b.priority]||b.publishedAt.localeCompare(a.publishedAt));
}
