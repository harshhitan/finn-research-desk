// Shared between the custom Node server and Next's bundled route handlers.
const key=Symbol.for('finn.render.worker-state');
const state=globalThis[key]??={heartbeat:null,awakeUntil:0,nextProbe:0};
export function readWorkerHeartbeat(){return state.heartbeat;}
export function recordWorkerHeartbeat(body,time=Date.now()){
  state.heartbeat={lastSeen:new Date(time).toISOString(),modelReady:body.modelReady===true,modelEnabled:body.modelEnabled===true,memoryAvailableMb:Number(body.memoryAvailableMb)||0,lastChildPeakMb:Number(body.lastChildPeakMb)||0,workerVersion:String(body.workerVersion||'').slice(0,40),modelRetryAt:typeof body.modelRetryAt==='string'&&Number.isFinite(Date.parse(body.modelRetryAt))?body.modelRetryAt:null,modelReason:body.modelReason?'ChatGPT capacity is temporarily unavailable. Saved answers and document preparation remain available.':null};
}
export function wakeWorkerQueue(time=Date.now()){state.awakeUntil=Math.max(state.awakeUntil,time+60000);}
export function shouldCheckWorkerQueue(time=Date.now()){
  if(time<state.awakeUntil)return true;
  if(time<state.nextProbe)return false;
  // Check durable work periodically after process restarts or a lost wake-up.
  // A normal visitor API request wakes it immediately, including company search.
  state.nextProbe=time+20*60000;state.awakeUntil=time+10000;return true;
}
