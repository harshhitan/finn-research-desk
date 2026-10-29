import type { Corpus, FeedItem, Period, ResearchAnswer, Rules } from "./types";

export const defaultRules: Rules = { priceThreshold: 5, volumeThreshold: 2, categories: ["results", "management_change", "M&A", "capex"], enabled: true, version: "1" };
export const topics = [
  { id: "business", label: "Business & segments", question: "What drives Reliance's business?", terms: "business segments retail digital jio oil gas o2c revenue mix" },
  { id: "financials", label: "Financial performance", question: "How are revenue and profits growing?", terms: "revenue sales ebitda pbt pat profit margin earnings growth quarterly yoy qoq" },
  { id: "cash", label: "Cash quality", question: "Are profits turning into cash?", terms: "cash cashflow cash-flow cfo conversion free fcf operations" },
  { id: "balance", label: "Balance sheet", question: "How much debt does Reliance carry?", terms: "debt leverage balance sheet working capital liquidity borrowings inventory receivables" },
  { id: "guidance", label: "Management & guidance", question: "What has management committed to?", terms: "guidance promise promised delivered target capex commitment narrative commentary management outlook ambition" },
  { id: "risk", label: "Risks & governance", question: "What risks deserve attention?", terms: "risk risks contingent liabilities litigation related-party rpt auditor qualification governance competition volatility" },
  { id: "trajectory", label: "Multi-year trajectory", question: "What is changing across years?", terms: "trajectory trend years annual multi-year direction growing compressing" },
  { id: "cases", label: "Bull & bear cases", question: "What is the case on each side?", terms: "bull bear thesis opportunity upside downside case valuation" },
];
export function change(current?: number | null, previous?: number | null) { return current != null && previous != null && previous > 0 ? 100 * (current / previous - 1) : null; }
export function money(value?: number | null) { return value == null ? "Unavailable" : `₹${Math.round(value).toLocaleString("en-IN")} crore`; }
export function latest(periods: Period[]) { return [...periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1)!; }
export function validEvidence(corpus: Corpus, ids: string[]) { return [...new Set(ids)].filter(id => corpus.evidence.some(e => e.id === id && corpus.documents.some(d => d.id === e.documentId && d.allowedForResearch))); }

export function buildFeed(corpus: Corpus): FeedItem[] {
  return corpus.documents.filter(d => d.publishedAt && (d.type.includes("results") || d.type === "earnings_call" || d.type.includes("annual"))).map(d => {
    const q = corpus.quarterly.find(p => p.evidenceIds.some(id => corpus.evidence.find(e => e.id === id)?.documentId === d.id));
    const a = corpus.annual.find(p => p.evidenceIds.some(id => corpus.evidence.find(e => e.id === id)?.documentId === d.id));
    const p = q || a;
    const call=d.type === "earnings_call";
    return { id: `filing-${d.id}`, title: call ? `${d.period} earnings call` : d.type.includes("results") ? `${d.period} financial results` : `${d.period} annual report`, category: call ? "earnings_call" : "results", publishedAt: d.publishedAt!, priority: call ? "medium" : "high", summary: p ? `Gross revenue ${money(p.grossRevenue)}; EBITDA ${money(p.ebitda)}. Consolidated, ${p.period}.` : d.title, implication: call ? "Read management's explanation alongside the reported numbers. Commentary is not automatically a numerical commitment." : "Use the reported basis and comparative period before interpreting growth. Open the source for the definitions.", evidenceIds: corpus.evidence.filter(e => e.documentId === d.id).map(e => e.id), documentId: d.id } as FeedItem;
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function chooseTopic(question: string, explicit?: string) {
  if (topics.some(t => t.id === explicit)) return topics.find(t => t.id === explicit)!;
  const q = question.toLowerCase();
  return [...topics].sort((a,b) => b.terms.split(" ").filter(w => q.includes(w)).length - a.terms.split(" ").filter(w => q.includes(w)).length)[0];
}
export function answerQuestion(corpus: Corpus, question: string, explicit?: string): ResearchAnswer {
  const topic = chooseTopic(question, explicit); const q = question.toLowerCase();
  const foreignIssuer = /\b(tcs|infosys|hdfc|icici|adani|tata|apple|microsoft|wipro)\b/i.test(q);
  const prediction = /\b(buy|sell|target price|price target|tomorrow|next week|recommendation|forecast share)\b/i.test(q);
  const qTerms = q.replace(/[^a-z0-9 -]/g, " ").split(/\s+/).filter(w => w.length > 2 && !["what","does","the","are","how","and","for","has","with","can","you","reliance","industries","this"].includes(w));
  const topicTerms = topic.terms.split(" ");
  const scored = corpus.evidence.filter(e => corpus.documents.some(d => d.id === e.documentId && d.allowedForResearch)).map(e => {
    const text = `${e.section} ${e.keywords.join(" ")} ${e.text}`.toLowerCase();
    return { e, score: qTerms.reduce((s,w) => s + (text.includes(w) ? 4 : 0),0) + topicTerms.reduce((s,w) => s + (text.includes(w) ? 1 : 0),0) };
  }).filter(r=>r.score > 0).sort((a,b)=>b.score-a.score);
  const quarterQuestion=/\bq[1-4]\b|quarter|recurring|reported earnings/i.test(q);
  const requestedYear=q.match(/\bfy\s*(?:20)?(\d{2})\b/i)?.[1];
  const requestedAnnual=requestedYear?corpus.annual.find(p=>p.period.endsWith(requestedYear)):null;
  const a = requestedAnnual || latest(corpus.annual); const points: ResearchAnswer["points"] = [];
  const scopeGap=!!requestedYear&&!quarterQuestion&&!requestedAnnual&&!["guidance","cases","risk"].includes(topic.id);
  const metricGap=!!requestedYear&&!!requestedAnnual&&((topic.id==="cash"&&a.cfo==null)||(topic.id==="balance"&&a.netDebt==null));
  const unsupportedTerms=qTerms.filter(w=>!["please","explain","summarize","tell","about","company","research","give","into","much","case","each","side","across","years","changing","drives","growing","profits","committed"].includes(w));
  const requestedQuarter=q.match(/\bq([1-4])\b/i)?.[1];
  const candidates=quarterQuestion?scored.filter(r=>{const d=corpus.documents.find(d=>d.id===r.e.documentId);return d?.type==="earnings_call"&&(!requestedYear||d.period.endsWith(requestedYear))&&(!requestedQuarter||d.period.toLowerCase().includes(`q${requestedQuarter}`));}):scored;
  const picked=candidates.filter(r=>r.score>=(candidates[0]?.score||0)*.5).slice(0,3).map(r=>r.e);
  const missing = foreignIssuer || prediction || scopeGap || metricGap || (!explicit && unsupportedTerms.length > 0 && !scored.some(r => unsupportedTerms.some(w => `${r.e.section} ${r.e.keywords.join(" ")} ${r.e.text}`.toLowerCase().includes(w)))) || !picked.length;
  if (!missing && !quarterQuestion && ["financials","trajectory"].includes(topic.id)) {
    const previous = [...corpus.annual].filter(p=>p.periodEnd<a.periodEnd).sort((x,y)=>x.periodEnd.localeCompare(y.periodEnd)).at(-1); const growth = previous ? change(a.grossRevenue,previous.grossRevenue) : null;
    points.push({text:`${a.period} consolidated gross revenue was ${money(a.grossRevenue)}${growth == null ? "" : `, ${growth.toFixed(1)}% above ${previous!.period}`}. EBITDA was ${money(a.ebitda)} and PAT including associates/JVs was ${money(a.pat)}.`, evidenceIds:validEvidence(corpus,["e-annual","e-income"])});
    if(a.ebitda && a.grossRevenue) points.push({text:`EBITDA / gross revenue was ${(100*a.ebitda/a.grossRevenue).toFixed(1)}%. This calculated ratio uses gross revenue; it is not a replacement for a differently defined reported margin.`, evidenceIds:validEvidence(corpus,["e-annual","e-income"])});
  }
  if(!missing && topic.id === "cash" && a.cfo != null) {
    points.push({text:`${a.period} cash from operations was ${money(a.cfo)} versus PAT of ${money(a.pat)}${a.pat ? `: ${(a.cfo/a.pat).toFixed(2)}× cash conversion` : ""}. These are consolidated annual figures.`, evidenceIds:validEvidence(corpus,["e-income","e-cashflow"])});
    if(a.cashCapex != null)points.push({text:`Cash from operations less cash capital expenditure was ${money(a.cfo-a.cashCapex)}. Cash capex here covers property, equipment, spectrum and intangible assets; company-reported capital expenditure has a different scope.`,evidenceIds:validEvidence(corpus,["e-cashflow"])});
  }
  if(!missing && topic.id === "balance" && a.netDebt != null) points.push({text:`At ${a.periodEnd}, consolidated net debt was ${money(a.netDebt)}${a.ebitda ? `, or ${(a.netDebt/a.ebitda).toFixed(2)}× annual EBITDA` : ""}. Net debt is distinct from gross borrowings and should be read with the cash reconciliation.`,evidenceIds:validEvidence(corpus,["e-annual","e-debt"])});
  if(!missing && topic.id === "cases") {
    points.push({text:"Bull case — an interpretation: consumer and digital earnings diversify the group's cash-generation base; Digital Services and Retail both increased FY2026 EBITDA. The supporting case depends on continued execution, not just reported group growth.",evidenceIds:validEvidence(corpus,["e-segments","e-cashflow"])});
    points.push({text:"Bear case — an interpretation: commodity exposure, a large capital-investment programme and refinancing or regulatory risks can pressure returns. One-off gains and differences between segment and entity scopes make headline comparisons less straightforward.",evidenceIds:validEvidence(corpus,["e-risk","e-segments","e-debt"])});
  }
  if(!missing) for (const e of picked) {
    if(points.some(p=>p.evidenceIds.includes(e.id)))continue;
    points.push({text:e.text.length > 650 ? `${e.text.slice(0,650).replace(/\s+\S*$/,"")}…` : e.text,evidenceIds:[e.id]});
    if(points.length>=3)break;
  }
  const finalPoints=points.slice(0,3);const ids = validEvidence(corpus,finalPoints.flatMap(p=>p.evidenceIds));
  return { id:crypto.randomUUID(),question,title:missing?"The evidence does not support that answer":topic.label,summary:missing?(foreignIssuer?"This first FINN workspace covers Reliance Industries only.":prediction?"Company reports do not establish a future share price or a buy/sell recommendation.":scopeGap||metricGap?"The requested metric and fiscal period are not verified together in the indexed evidence. No replacement period has been substituted.":"No sufficiently relevant passage was found in the indexed Reliance documents. Try a specific financial term or browse the source library."):quarterQuestion?"The relevant management-call passages are shown below. Reported and recurring comparisons use different bases; exact reported comparison numbers are available separately in Financials.":"Source extracts and calculated observations from Reliance's annual reports and earnings-call transcripts.",points:finalPoints,evidenceIds:ids,mode:"Source-grounded research",limitation:topic.id==="guidance"?"Forward-looking commentary is not a scored promise. A verdict needs earlier explicit guidance and a later actual with matching period, metric and scope. Four-quarter promise coverage is not yet established.":"Extractive research, not a generated forecast. Coverage is limited to the indexed documents; original passages and reported definitions take precedence.",createdAt:new Date().toISOString(),topic:topic.id,missing};
}
