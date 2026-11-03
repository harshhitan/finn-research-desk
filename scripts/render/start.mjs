import http from 'node:http';
import next from 'next';
import {prepareVisitorRequest} from '../../lib/public-session.mjs';
import {timingSafeEqual} from 'node:crypto';
import {recordWorkerHeartbeat,wakeWorkerQueue,shouldCheckWorkerQueue} from '../../lib/runtime-worker-state.mjs';

const port=Number(process.env.PORT||3000),hostname='0.0.0.0';
const origin=new URL(process.env.FINN_PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||`http://localhost:${port}`).origin;
const secret=process.env.FINN_SESSION_SECRET,adminToken=process.env.FINN_ADMIN_TOKEN;
if(!secret||secret.length<32||!adminToken||adminToken.length<32)throw new Error('Configure FINN_SESSION_SECRET and FINN_ADMIN_TOKEN with at least 32 random characters');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
if(!process.env.FINN_MONITOR_JOB_TOKEN||!process.env.FINN_PRIVATE_CODEX_OWNER)throw new Error('Configure the shared worker owner and service token');
const serviceToken=process.env.FINN_MONITOR_JOB_TOKEN;
const serviceAuthorised=request=>{const supplied=request.headers['x-finn-job-token'];if(typeof supplied!=='string')return false;const a=Buffer.from(supplied),b=Buffer.from(serviceToken);return a.length===b.length&&timingSafeEqual(a,b);};
const claims=new Map([['/api/research/worker/claim','job'],['/api/research/worker/directory/claim','lookup'],['/api/research/worker/question/claim','question'],['/api/portfolio/private-worker/claim','job']]);
const send=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
async function workerGateway(request,response){
  const path=new URL(request.url,origin).pathname;
  const service=path.startsWith('/api/research/worker/')||path.startsWith('/api/portfolio/private-worker/')||['/api/portfolio/jobs/run','/api/portfolio/jobs/status'].includes(path);
  if(service&&!serviceAuthorised(request)){send(response,401,{error:'Worker authorization is required.'});return true;}
  if(service&&path==='/api/research/worker/heartbeat'&&request.method==='POST'){
    let body='';for await(const chunk of request){body+=chunk.toString('utf8');if(body.length>16000){send(response,413,{error:'Heartbeat is too large.'});return true;}}
    recordWorkerHeartbeat(JSON.parse(body));send(response,200,{ok:true});return true;
  }
  if(service&&claims.has(path)&&request.method==='POST'){
    if(!shouldCheckWorkerQueue()){request.resume();send(response,200,{[claims.get(path)]:null});return true;}
  }else if(path.startsWith('/api/'))wakeWorkerQueue();
  return false;
}
const app=next({dev:false,hostname,port}),handler=app.getRequestHandler();await app.prepare();
const server=http.createServer(async(request,response)=>{
  try{
    const state=prepareVisitorRequest(request,{origin,secret,adminToken});
    if(state.session.cookie)response.setHeader('Set-Cookie',state.session.cookie+(origin.startsWith('https:')?'; Secure':''));
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    if(state.status){response.writeHead(state.status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:state.error}));return;}
    if(await workerGateway(request,response))return;
    await handler(request,response);
  }catch{if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'FINN could not complete this request.'}));}
});
server.requestTimeout=120000;server.headersTimeout=15000;server.listen(port,hostname,()=>console.log('FINN listening on port '+port));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
