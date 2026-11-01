import {database,session} from "../repository";
import {askQuestion,companies,company,coverage,enqueuePreparation,hydrateQuestion,readPassages,refreshQuestion,searchCorpus,seedResearch,stamp,workerStatus} from "./store";
import {canonicalTicker,directoryPending,resolveCompany,searchCompanies,researchTools} from "./tools";
import {artifacts,putArtifact,researchWorkerAction,workerAuthorised} from "./worker";
import type {ResearchFilters} from "./types";
import {financialMetrics,type FinancialMetric,type FinancialScope} from './facts';

function filters(value:any):ResearchFilters{
  if(value===undefined)return {};
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!["period","types"].includes(k)))throw new Error("Invalid research filters");
  if(value.period!==undefined&&(typeof value.period!=="string"||!/^\d{4}(?:-\d{2,4})?$/.test(value.period)))throw new Error("Choose a valid reporting year");
  if(value.types!==undefined&&(!Array.isArray(value.types)||!value.types.length||value.types.length>2||value.types.some((s:string)=>!["annual_report","earnings_call"].includes(s))))throw new Error("Choose annual reports or earnings-call transcripts");
  return value;
}
export async function handleResearch(request:Request){
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/research\/?/,""),local=["localhost","127.0.0.1"].includes(url.hostname),identity=request.headers.get("oai-authenticated-user-id"),owner=session(request).owner;
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  try{
    if(path.startsWith("worker/")){
      if(!await workerAuthorised(request))return json({error:"Research worker authorization is required."},401);
      const artifact=path.match(/^worker\/artifact\/([a-f0-9-]{36})\/([a-f0-9]{64})\/(pdf|jsonl)$/);
      if(artifact&&request.method==="PUT")return putArtifact(request,artifact[1],artifact[2],artifact[3]);
      if(request.method!=="POST")return json({error:"Method not supported."},405);
      const raw=await request.text();if(raw.length>250000)return json({error:"Research request is too large."},413);
      return json(await researchWorkerAction(path.slice(7),JSON.parse(raw||"{}")));
    }
    const originalRead=/^documents\/[a-f0-9]{64}\/original$/.test(path)&&['GET','HEAD'].includes(request.method);
    // The same protected ingestion service may verify stored public-source PDFs.
    // It never receives a visitor identity or access to their question history.
    if(!identity&&!local&&!(originalRead&&await workerAuthorised(request)))return json({error:"Sign in to FINN to use company research."},401);
    if(!['GET','HEAD'].includes(request.method)&&request.headers.get("origin")!==url.origin)return json({error:"A same-origin research request is required."},403);
    if(Number(request.headers.get("content-length"))>12000)return json({error:"Research request is too large."},413);
    await seedResearch();
    if(path===""&&request.method==="GET"){
      const list=await companies();
      return json({companies:list,counts:{registered:list.length,ready:list.filter(c=>c.status==="ready").length,partial:list.filter(c=>c.status==="partial").length,preparing:list.filter(c=>c.status==="preparing").length},worker:await workerStatus(),policy:"Annual reports and earnings-call transcripts only",tools:Object.keys(researchTools)});
    }
    if(path==="companies/search"&&request.method==="GET"){const query=(url.searchParams.get('q')||'').trim().slice(0,100),found=await searchCompanies(query);return json({companies:found,pending:!found.length&&await directoryPending(query)});}
    if(path==="companies/prepare"&&request.method==="POST"){
      const body:any=await request.json(),c=await resolveCompany(String(body.ticker||""));return json({company:c,job:await enqueuePreparation(c.ticker,owner)},202);
    }
    const companyPath=path.match(/^companies\/([A-Z0-9&-]{1,25})$/);
    if(companyPath&&request.method==="GET")return json(await coverage(companyPath[1]));
    if(path==="search"&&request.method==="POST"){
      const b:any=await request.json();if(typeof b.query!=="string"||b.query.length<2||b.query.length>600)throw new Error("Enter a research question between 2 and 600 characters");
      const ticker=canonicalTicker(String(b.ticker||""));if(!await company(ticker))throw new Error("Choose a research company first");
      return json({passages:await searchCorpus(ticker,b.query,filters(b.filters))});
    }
    if(path==="questions"&&request.method==="POST"){
      const b:any=await request.json();if(typeof b.question!=="string"||b.question.trim().length<5||b.question.length>600)throw new Error("Enter a research question between 5 and 600 characters");
      const c=await resolveCompany(String(b.ticker||""));return json(await askQuestion(owner,c.ticker,b.question.trim(),filters(b.filters)),202);
    }
    if(['facts','facts/compare','facts/margin'].includes(path)&&request.method==='POST'){
      const b:any=await request.json(),ticker=canonicalTicker(String(b.ticker||''));
      if(!await company(ticker)||(path!=='facts/margin'&&!Object.hasOwn(financialMetrics,b.metric))||!['consolidated','standalone'].includes(b.scope))throw new Error('Choose a research company, supported financial metric and accounting scope');
      if(path==='facts/margin')return json(await researchTools.calculate_margin.run(ticker,b.scope,String(b.basePeriod||''),String(b.currentPeriod||'')));
      return json(path==='facts'?await researchTools.get_financial_facts.run(ticker,b.metric as FinancialMetric,b.scope as FinancialScope):await researchTools.compare_facts.run(ticker,b.metric as FinancialMetric,b.scope as FinancialScope,String(b.basePeriod||''),String(b.currentPeriod||'')));
    }
    if(path==="history"&&request.method==="GET"){
      const ticker=url.searchParams.get("ticker"),rows=await database().prepare("SELECT * FROM research_questions WHERE owner=? AND (? IS NULL OR ticker=?) ORDER BY created_at DESC LIMIT 30").bind(owner,ticker,ticker).all();return json({questions:rows.results.map(hydrateQuestion)});
    }
    const questionPath=path.match(/^questions\/([a-f0-9-]{36})(\/retry)?$/);
    if(questionPath){
      if(questionPath[2]&&request.method==="POST"){
        const q=await database().prepare("SELECT * FROM research_questions WHERE id=? AND owner=? AND status='error'").bind(questionPath[1],owner).first<any>();
        if(!q)throw new Error("This research question cannot be retried");
        await database().prepare("UPDATE research_questions SET status='waiting_model',attempts=0,error=NULL,updated_at=? WHERE id=? AND owner=? AND status='error'").bind(stamp(),q.id,owner).run();
      }else if(request.method!=="GET")return json({error:"Method not supported."},405);
      const q=await refreshQuestion(questionPath[1],owner);return q?json(q):json({error:"Research question not found."},404);
    }
    const passagePath=path.match(/^passages\/(.+)$/);
    if(passagePath&&request.method==="GET"){
      const id=decodeURIComponent(passagePath[1]),ticker=url.searchParams.get("ticker")||"",passage=(await readPassages(ticker,[id]))[0];return passage?json(passage):json({error:"Evidence passage not found in the active company index."},404);
    }
    const original=path.match(/^documents\/([a-f0-9]{64})\/original$/);
    if(original&&['GET','HEAD'].includes(request.method)){
      const version=url.searchParams.get("version");
      const doc=await database().prepare("SELECT v.artifact_key,d.title FROM research_documents d JOIN research_document_versions v ON v.document_id=d.id WHERE d.id=? AND v.id=COALESCE(?,d.active_version) AND v.status IN ('ready','partial')").bind(original[1],version).first<{artifact_key:string;title:string}>();
      if(!doc)return json({error:"Original document not found."},404);
      const bucket=artifacts(),head=await bucket?.head(doc.artifact_key);if(!head||!bucket)return json({error:"Original document storage is temporarily unavailable."},503);
      const size=head.size,range=request.headers.get('range');let offset=0,length=size,status=200;
      if(range){const match=range.match(/^bytes=(\d*)-(\d*)$/);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
        if(!match[1]){length=Math.min(size,Number(match[2]));offset=size-length;}else{offset=Number(match[1]);length=(match[2]?Math.min(size-1,Number(match[2])):size-1)-offset+1;}
        if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||offset>=size||length<1)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});status=206;
      }
      const headers:Record<string,string>={"Content-Type":"application/pdf","Content-Disposition":'inline; filename="finn-research.pdf"',"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff",'Accept-Ranges':'bytes','Content-Length':String(length)};
      if(status===206)headers['Content-Range']=`bytes ${offset}-${offset+length-1}/${size}`;
      if(request.method==='HEAD')return new Response(null,{status,headers});
      const file=await bucket.get(doc.artifact_key,range?{range:{offset,length}}:undefined);if(!file)return json({error:"Original document storage is temporarily unavailable."},503);
      return new Response(file.body,{status,headers});
    }
    return json({error:"Research endpoint not found."},404);
  }catch(error){
    const message=error instanceof Error?error.message:"Research could not be completed";
    if(/no such table|no such module|D1_|SQLITE/i.test(message))return json({error:"The research index is being prepared. Existing portfolio data remains available."},503);
    return json({error:message.slice(0,600)},400);
  }
}
