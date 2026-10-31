// Send the selected Site's service credential to the owner's VM over SSH.
// Hidden stdin keeps it out of shell arguments, command history and output.
import {spawn} from 'node:child_process';
const key=process.argv[2];if(!key)throw new Error('Pass the SSH private-key path');
const input=await new Promise((resolve,reject)=>{
  let value='';const terminal=process.stdin.isTTY;
  const finish=()=>{process.stdin.removeAllListeners('data');if(terminal)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(value.trim()));}catch{reject(new Error('Invalid worker configuration'));}};
  if(terminal)process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{value+=chunk;if(value.includes('\u0003'))process.exit(130);if(value.length>16000)reject(new Error('Input too large'));if(/[\r\n]/.test(value))finish();});
  process.stdin.on('end',finish);process.stdin.resume();console.log('Ready for private worker configuration on stdin (input is hidden).');
});
if(input.url!=='https://finn-reliance-research-desk.cozyjay15.chatgpt.site'||typeof input.serviceToken!=='string'||input.serviceToken.length<32)throw new Error('Unexpected Site configuration');
const python="import json,os,sys; from pathlib import Path; d=json.load(sys.stdin); p=Path('/home/azureuser/finn-personal/config.json'); fd=os.open(str(p)+'.new',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600); f=os.fdopen(fd,'w'); json.dump(d,f); f.close(); os.replace(str(p)+'.new',p); print('Private worker configuration saved with mode 0600')";
const remote="python3 -c '"+python.replaceAll("'","'\\''")+"'";
const proc=spawn('ssh',['-T','-i',key,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','azureuser@20.219.142.78',remote],{stdio:['pipe','pipe','pipe']});
let output='';proc.stdout.on('data',chunk=>{output+=chunk;});proc.stderr.resume();proc.stdin.end(JSON.stringify(input));
const code=await new Promise(resolve=>proc.on('close',resolve));if(code!==0)throw new Error('Private worker configuration transfer failed');console.log(output.trim());
