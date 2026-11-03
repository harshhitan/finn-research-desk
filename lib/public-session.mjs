import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function visitorSession(cookie,secret){
  if(!secret||secret.length<32)throw new Error('FINN_SESSION_SECRET must contain at least 32 characters');
  const sign=id=>createHmac('sha256',secret).update(id).digest('base64url');
  const prior=(cookie||'').match(/(?:^|;\s*)finn_visitor=([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})(?:;|$)/i);
  if(prior&&equal(prior[2],sign(prior[1])))return {id:prior[1],cookie:null};
  const id=randomUUID();return {id,cookie:`finn_visitor=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`};
}
export function prepareVisitorRequest(request,{origin,secret,adminToken}){
  for(const key of Object.keys(request.headers))if(key.startsWith('oai-authenticated-')||key==='x-finn-admin')delete request.headers[key];
  const session=visitorSession(request.headers.cookie,secret),supplied=request.headers['x-finn-admin-token'];
  const admin=typeof supplied==='string'&&!!adminToken&&adminToken.length>=32&&equal(supplied,adminToken);delete request.headers['x-finn-admin-token'];
  request.headers['oai-authenticated-user-id']=session.id;if(admin)request.headers['x-finn-admin']='1';
  const path=new URL(request.url,origin).pathname;
  const service=path.startsWith('/api/research/worker/')||path.startsWith('/api/portfolio/private-worker/')||['/api/portfolio/jobs/run','/api/portfolio/jobs/status'].includes(path);
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!service&&request.headers.origin!==origin)return {session,status:403,error:'A same-origin request is required.'};
  const restricted=/^\/api\/portfolio\/(?:interpretation\/|chatgpt\/|filings\/[^/]+\/analyse$)/.test(path)&&!path.endsWith('/chatgpt/status');
  if(restricted&&!admin)return {session,status:403,error:'Only the administrator can change shared AI settings.'};
  // Render terminates TLS. Use the configured public origin, never caller input,
  // for Next's reconstructed Request URL and same-origin checks.
  const target=new URL(origin);request.headers.host=target.host;request.headers['x-forwarded-host']=target.host;request.headers['x-forwarded-proto']=target.protocol.slice(0,-1);
  return {session,admin};
}
