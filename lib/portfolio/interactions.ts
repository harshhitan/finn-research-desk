import {database} from '../repository';
export async function alertInteraction(owner:string,body:any){
  if(typeof body?.id!=='string'||!['review','save','unsave','snooze','unsnooze'].includes(body.action))throw new Error('Choose an alert and a supported action');
  const db=database(),alert=await db.prepare('SELECT trigger_key FROM portfolio_alerts WHERE owner=? AND trigger_key=?').bind(owner,body.id).first();if(!alert)throw new Error('This alert was not found');
  const key='portfolio-alert-state:'+owner+':'+body.id,prior=await db.prepare('SELECT data FROM provider_cache WHERE key=?').bind(key).first<{data:string}>(),state=prior?JSON.parse(prior.data):{},now=new Date().toISOString();
  if(body.action==='review')await db.prepare('UPDATE portfolio_alerts SET read_at=? WHERE owner=? AND trigger_key=?').bind(now,owner,body.id).run();
  if(body.action==='save'||body.action==='unsave')state.saved=body.action==='save';
  if(body.action==='snooze'||body.action==='unsnooze')state.snoozedUntil=body.action==='snooze'?new Date(Date.now()+86400000).toISOString():null;
  await db.prepare('INSERT INTO provider_cache(key,data,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at').bind(key,JSON.stringify(state),now).run();return {accepted:true};
}
export async function alertStates(owner:string){const prefix='portfolio-alert-state:'+owner+':',rows=await database().prepare('SELECT key,data FROM provider_cache WHERE key>=? AND key<? LIMIT 500').bind(prefix,prefix+'\uffff').all<{key:string;data:string}>();return Object.fromEntries(rows.results.map(r=>[r.key.slice(prefix.length),JSON.parse(r.data)]));}
