"use client";

import { useEffect, useState } from "react";
import { CircleHelp, ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import type { FilingContent } from "../lib/filing-content";

export default function FilingReader({documentId,sourceUrl}:{documentId:string;sourceUrl:string}) {
  const [content,setContent]=useState<FilingContent|null>(null);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const [loadedId,setLoadedId]=useState("");
  useEffect(()=>{
    const controller=new AbortController();setContent(null);setError("");setLoadedId(documentId);
    fetch(`/api/documents/${encodeURIComponent(documentId)}/content${attempt?"?retry=1":""}`,{signal:controller.signal})
      .then(async response=>{const result:any=await response.json();if(!response.ok)throw new Error(result.error||"Could not load this filing.");return result as FilingContent;})
      .then(result=>{if(!controller.signal.aborted)setContent(result);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Could not load this filing.");});
    return()=>controller.abort();
  },[documentId,attempt]);

  if(loadedId!==documentId||(!content&&!error))return <section className="filing-loading" role="status"><Loader2 size={22} className="spin"/><div><h4>Reading the original filing</h4><p>Downloading the company PDF and extracting its page text.</p></div></section>;
  if(error||content?.status==="unavailable")return <section className="filing-unavailable" role="alert"><CircleHelp size={21}/><h4>We couldn’t read this PDF</h4><p>{error||content?.reason}</p><div><button className="outline-button" onClick={()=>setAttempt(a=>a+1)}><RefreshCw size={14}/> Retry extraction</button><a className="text-button" href={sourceUrl} target="_blank" rel="noreferrer">Read the original <ExternalLink size={14}/></a></div></section>;
  const keyPassage=content?.pages.map(p=>{
    const start=p.text.search(/\bSub(?:ject)?\s*:/i);
    if(start<0)return null;
    const body=p.text.slice(start).split(/This is for (?:information|your information)|Thanking you|Yours faithfully/i)[0].trim();
    return body.length>50?{page:p.page,text:body.length>1400?`${body.slice(0,1400)}…`:body}:null;
  }).find(Boolean);
  return <div className="filing-reader"><div className="filing-ready"><FileText size={15}/><span>Original PDF text · {content?.pageCount} {content?.pageCount===1?"page":"pages"}</span></div>{keyPassage&&<section className="filing-key-passage"><div className="eyebrow">KEY PASSAGE · PAGE {keyPassage.page}</div><p>{keyPassage.text}</p><a className="text-button" href={`${sourceUrl.split("#")[0]}#page=${keyPassage.page}`} target="_blank" rel="noreferrer">Verify this passage <ExternalLink size={13}/></a></section>}{content?.pages.map(p=><details className="filing-page" key={p.page} open={!keyPassage&&p.page===1}><summary>Page {p.page} · complete extracted text<a href={`${sourceUrl.split("#")[0]}#page=${p.page}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} aria-label={`Verify page ${p.page} in the original PDF`}><ExternalLink size={13}/></a></summary><p>{p.text||"This page has no extractable text. See the original for images or scanned content."}</p></details>)}<div className="soft-note"><CircleHelp size={15}/>This is extracted company-filing text. PDF layout and table alignment may differ; use the original for visual verification. Issuer filings remain separate from the annual-report/transcript research corpus.</div></div>;
}
