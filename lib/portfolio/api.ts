import {env} from "cloudflare:workers";
import {database,session} from "../repository";
import {seedPortfolio,enqueueCollection,runJobs,portfolioSnapshot,saveMonitoringRules,monitoringRules} from "./monitor";
import {analyseFiling,portfolioDocument,resultsForFiling} from "./analysis";
import {subscriptionStatus,startSubscription,finishSubscription,disconnectSubscription} from "./chatgpt-auth";
import {privateWorkerAction} from "./private-worker";
import {privateCodexConfig} from "./private-config";
const clearedCookie="finn_chatgpt_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/portfolio/chatgpt; Max-Age=0";
async function equalSecret(a:string,b:string){if(!a||!b)return false;const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));const [aa,bb]=await Promise.all([hash(a),hash(b)]);let value=0;for(let i=0;i<aa.length;i++)value|=aa[i]^bb[i];return value===0;}
export async function handlePortfolio(request:Request){
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/portfolio\/?/,""),who=session(request);const headers:Record<string,string>={"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};if(who.cookie)headers["Set-Cookie"]=who.cookie;
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  try{
    const local=["127.0.0.1","localhost"].includes(url.hostname),identity=request.headers.get("oai-authenticated-user-id");
    const secret=(env as unknown as Record<string,string>).FINN_MONITOR_JOB_TOKEN;
    const worker=path.match(/^private-worker\/(claim|complete|failed)$/);
    const unattended=(path==="jobs/run"&&request.method==="POST"||path==="jobs/status"&&request.method==="GET"||!!worker&&request.method==="POST")&&await equalSecret(request.headers.get("X-Finn-Job-Token")||"",secret||"");
    if(!identity&&!local&&!unattended)return json({error:"Sign in to FINN to access portfolio monitoring."},401);
    if(request.method!=="GET"&&!unattended){const origin=request.headers.get("origin");if(!origin||origin!==url.origin)return json({error:"A same-origin portfolio request is required."},403);}
    if(Number(request.headers.get("content-length"))>(worker?350000:16000))return json({error:"Request is too large"},413);
    const jobKind=url.searchParams.get("kind");
    if((path==="jobs/run"||path==="jobs/status")&&jobKind!==null&&jobKind!=="collect")return json({error:"Unsupported job kind."},400);
    const collectionOnly=jobKind==="collect",kind=collectionOnly?"collect":null;
    await seedPortfolio();
    if(worker&&request.method==="POST"){
      if(!unattended||!privateCodexConfig())return json({error:"Private worker authorization is required."},403);
      const body=await request.text();if(body.length>350000)return json({error:"Request is too large"},413);
      return json(await privateWorkerAction(worker[1],JSON.parse(body||"{}")));
    }
    if(path===""&&request.method==="GET"){
      const now=new Date(),from=url.searchParams.get("from")||new Date(now.getTime()-86400000).toISOString(),to=url.searchParams.get("to")||now.toISOString(),ticker=url.searchParams.get("ticker")||undefined;
      if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>Date.parse(to)||Date.parse(to)-Date.parse(from)>366*86400000)return json({error:"Choose a valid window of up to one year."},400);
      const snapshot=await portfolioSnapshot(who.owner,new Date(from).toISOString(),new Date(to).toISOString(),ticker);
      const privateJobs=privateCodexConfig()?.owner===who.owner?(await database().prepare("SELECT filing_id,status,error,created_at FROM portfolio_private_jobs WHERE owner=? ORDER BY created_at DESC LIMIT 100").bind(who.owner).all()).results:[];
      return json({...snapshot,privateJobs,subscription:await subscriptionStatus(who.owner)});
    }
    if(path==="rules"&&request.method==="PUT"){const body=await request.text();if(body.length>16000)return json({error:"Request is too large"},413);try{return json(await saveMonitoringRules(who.owner,JSON.parse(body)));}catch{return json({error:"Use price thresholds of 0.1–50%, volume of 1–20× and known portfolio companies/categories."},400);}}
    if(path==="refresh"&&request.method==="POST"){await monitoringRules(who.owner);await enqueueCollection();return json({queued:true,...await runJobs(2,analyseFiling)});}
    if(path==="jobs/tick"&&request.method==="POST")return json(await runJobs(2,analyseFiling));
    if(path==="jobs/run"&&request.method==="POST"){
      if(!unattended)return json({error:"Unattended collector authorization is required."},403);
      await enqueueCollection();return json({...await runJobs(4,collectionOnly?undefined:analyseFiling,{kind:kind||undefined}),jobKind:kind||"all",remaining:(await database().prepare("SELECT COUNT(*) AS count FROM portfolio_jobs WHERE status IN ('queued','retry','running') AND (? IS NULL OR kind=?)").bind(kind,kind).first<{count:number}>())?.count||0,checkedAt:new Date().toISOString()});
    }
    if(path==="jobs/status"&&request.method==="GET"){
      if(!unattended)return json({error:"Unattended collector authorization is required."},403);
      const db=database();const [quotes,filings,errors,jobs,lock,active]=await Promise.all([db.prepare("SELECT COUNT(DISTINCT ticker) AS count FROM portfolio_prices").first<{count:number}>(),db.prepare("SELECT COUNT(*) AS count FROM portfolio_filings").first<{count:number}>(),db.prepare("SELECT ticker,source,error FROM portfolio_sources WHERE error IS NOT NULL").all(),db.prepare("SELECT status,COUNT(*) AS count FROM portfolio_jobs WHERE (? IS NULL OR kind=?) GROUP BY status").bind(kind,kind).all(),db.prepare("SELECT expires_at FROM portfolio_locks WHERE name='collector'").first(),db.prepare("SELECT id,ticker,kind,status,attempts,available_at,lease_until,error FROM portfolio_jobs WHERE status IN ('running','retry') AND (? IS NULL OR kind=?) ORDER BY created_at LIMIT 20").bind(kind,kind).all()]);
      return json({jobKind:kind||"all",quotes:quotes?.count||0,filings:filings?.count||0,sourceErrors:errors.results,jobs:jobs.results,collectorLock:lock,activeJobs:active.results,checkedAt:new Date().toISOString()});
    }
    if(path==="jobs"&&request.method==="GET"){const rows=await database().prepare("SELECT ticker,kind,status,attempts,created_at,finished_at,error FROM portfolio_jobs WHERE kind='collect' ORDER BY created_at DESC LIMIT 40").all();return json(rows.results);}
    const document=path.match(/^filings\/([a-zA-Z0-9-]+)\/content$/);
    if(document&&request.method==="GET")return json(await portfolioDocument(document[1]));
    const analysis=path.match(/^filings\/([a-zA-Z0-9-]+)\/analyse$/);
    if(analysis&&request.method==="POST")return json(await analyseFiling(who.owner,analysis[1]));
    const results=path.match(/^filings\/([a-zA-Z0-9-]+)\/results$/);
    if(results&&request.method==="GET")return json(await resultsForFiling(who.owner,results[1]));
    if(path==="alerts/read"&&request.method==="POST"){await database().prepare("UPDATE portfolio_alerts SET read_at=? WHERE owner=? AND read_at IS NULL").bind(new Date().toISOString(),who.owner).run();return json({read:true});}
    if(path==="chatgpt/status"&&request.method==="GET")return json(await subscriptionStatus(who.owner));
    if(path==="chatgpt/start"&&request.method==="GET"){
      const start=await startSubscription(who.owner,request);return new Response(null,{status:303,headers:{Location:start.url,"Set-Cookie":start.cookie,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
    }
    if(path==="chatgpt/callback"&&request.method==="GET"){
      try{await finishSubscription(who.owner,request);return new Response(null,{status:303,headers:{Location:"/?connection=connected#connection","Set-Cookie":clearedCookie,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});}catch{return new Response(null,{status:303,headers:{Location:"/?connection=failed#connection","Set-Cookie":clearedCookie,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});}
    }
    if(path==="chatgpt/disconnect"&&request.method==="POST"){await disconnectSubscription(who.owner);return json(await subscriptionStatus(who.owner));}
    return json({error:"Portfolio endpoint not found"},404);
  }catch(error){
    // Do not log callback URLs, tokens, provider bodies, or decoded credentials.
    const message=error instanceof Error?error.message:"";
    const safe=/^(Hosted ChatGPT|Connect ChatGPT|ChatGPT |This ChatGPT|An analysis|The model|Model |No readable|Unknown portfolio|The exchange|This PDF|This document|This source|Extracted|Invalid reported|Reported financial|Summary and significance)/.test(message);
    return json({error:safe?message:"Portfolio processing could not finish. Source health and retry status remain available."},503);
  }
}
