export function vmArtifacts(baseUrl,token){
  if(!baseUrl||!token)throw new Error('Configure FINN_VM_STORAGE_URL and FINN_VM_STORAGE_TOKEN');
  const origin=new URL(baseUrl);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)throw new Error('VM artifact service requires a plain HTTPS origin');
  const url=key=>{if(!/^research\/[a-f0-9]{2}\/[a-f0-9]{64}\.(pdf|jsonl)$/.test(key))throw new Error('Invalid document artifact key');return new URL('/v1/artifacts/'+key,origin);};
  async function call(key,method,options={}){const response=await fetch(url(key),{...options,method,headers:{...options.headers,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(90000)});if(response.status===404)return null;if(!response.ok){await response.body?.cancel();throw new Error('Document storage is temporarily unavailable');}return response;}
  return {
    async head(key){const response=await call(key,'HEAD');return response?{key,size:Number(response.headers.get('Content-Length'))}:null;},
    async get(key,options){const range=options?.range,response=await call(key,'GET',range?{headers:{Range:`bytes=${range.offset}-${range.offset+range.length-1}`}}:{});return response?{key,body:response.body}:null;},
    async put(key,body){const response=await call(key,'PUT',{body,duplex:'half'});if(!response)throw new Error('Artifact upload failed');await response.body?.cancel();return {key};},
  };
}
