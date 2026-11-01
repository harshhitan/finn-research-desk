// Credentials arrive on stdin only; never put them in commands, URLs or files.
const input=JSON.parse(await new Promise((resolve,reject)=>{
  let text='';const terminal=process.stdin.isTTY;
  const finish=error=>{process.stdin.off('data',read);process.stdin.off('end',end);if(terminal)process.stdin.setRawMode(false);process.stdin.pause();error?reject(error):resolve(text.trim());};
  const read=chunk=>{text+=chunk;if(text.includes('\u0003'))finish(new Error('Collector cancelled'));else if(text.length>65536)finish(new Error('Collector input too large'));else if(text.includes('\n')||text.includes('\r'))finish();};
  const end=()=>finish();
  if(terminal)process.stdin.setRawMode(true);
  process.stderr.write('Ready for collector JSON on stdin (input is hidden).\n');
  process.stdin.setEncoding('utf8');process.stdin.on('data',read);process.stdin.once('end',end);process.stdin.resume();
})),origin=new URL(input.url);
if(origin.protocol!=='https:'||origin.hostname!=='finn-reliance-research-desk.anandharshitwork03.chatgpt.site'||origin.username||origin.password||origin.port)throw new Error('Unexpected FINN Site origin');
if(typeof input.serviceToken!=='string'||!input.serviceToken)throw new Error('Site service access is required');
const headers={'OAI-Sites-Authorization':`Bearer ${input.serviceToken}`,'X-Finn-Job-Token':input.serviceToken,'Content-Type':'application/json'};
for(let i=0;i<Math.max(0,Math.min(15,input.maxCalls??10));i++){
  const response=await fetch(new URL('/api/portfolio/jobs/run?kind=collect',origin),{method:'POST',headers,signal:AbortSignal.timeout(110000),redirect:'error'});
  if(!response.ok)throw new Error(`Collector returned HTTP ${response.status}`);
  const result=await response.json();console.log(JSON.stringify({call:i+1,...result}));
  if(result.jobKind!=='collect')throw new Error('Collector refused a response without the collection-only selector');
  if(result.remaining===0)break;
  if(result.busy){await new Promise(resolve=>setTimeout(resolve,5000));continue;}
  if(result.processed===0)break;
}
let response;
for(let attempt=0;attempt<3;attempt++){try{response=await fetch(new URL('/api/portfolio/jobs/status?kind=collect',origin),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});break;}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}}
if(!response.ok)throw new Error(`Collector readback returned HTTP ${response.status}`);
console.log(JSON.stringify({readback:await response.json()}));
