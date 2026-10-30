// Credentials arrive on stdin only; never put them in commands, URLs or files.
import {readFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8')),origin=new URL(input.url);
if(origin.protocol!=='https:'||origin.hostname!=='finn-reliance-research-desk.cozyjay15.chatgpt.site'||origin.username||origin.password||origin.port)throw new Error('Unexpected FINN Site origin');
if(typeof input.serviceToken!=='string'||!input.serviceToken)throw new Error('Site service access is required');
const headers={'OAI-Sites-Authorization':`Bearer ${input.serviceToken}`,'X-Finn-Job-Token':input.serviceToken,'Content-Type':'application/json'};
for(let i=0;i<Math.min(15,input.maxCalls||10);i++){
  const response=await fetch(new URL('/api/portfolio/jobs/run',origin),{method:'POST',headers,signal:AbortSignal.timeout(110000),redirect:'error'});
  if(!response.ok)throw new Error(`Collector returned HTTP ${response.status}`);
  const result=await response.json();console.log(JSON.stringify({call:i+1,...result}));
  if(result.remaining===0||result.busy||result.processed===0)break;
}
const response=await fetch(new URL('/api/portfolio/jobs/status',origin),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
if(!response.ok)throw new Error(`Collector readback returned HTTP ${response.status}`);
console.log(JSON.stringify({readback:await response.json()}));
