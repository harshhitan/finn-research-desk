import {postgresDatabase} from './postgres-database.mjs';
import {vmArtifacts} from './vm-artifacts.mjs';
import {readWorkerHeartbeat} from './runtime-worker-state.mjs';
let database,bucket;
export const env=new Proxy({}, {get(_target,key){
  if(key==='FINN_RUNTIME')return 'render';
  if(key==='FINN_IN_MEMORY_WORKER_STATUS')return readWorkerHeartbeat();
  if(key==='DB')return database??=postgresDatabase(process.env.DATABASE_URL);
  if(key==='BUCKET')return bucket??=vmArtifacts(process.env.FINN_VM_STORAGE_URL,process.env.FINN_VM_STORAGE_TOKEN);
  return process.env[key];
}});
