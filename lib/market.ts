import type { Market } from "./types";
import { database } from "./repository";
import { completedSessionStats } from "./market-calculations";
export async function getMarket(refresh=false): Promise<Market> {
  const db=database(); const cached=await db.prepare("SELECT data, fetched_at FROM provider_cache WHERE key = 'market-RELIANCE'").first<{data:string;fetched_at:string}>();
  if(cached && !refresh && Date.now()-Date.parse(cached.fetched_at)<60*60*1000)return JSON.parse(cached.data);
  try {
    const response=await fetch("https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=3mo&interval=1d&events=splits",{headers:{"User-Agent":"FINN research prototype / public EOD data"},signal:AbortSignal.timeout(9000)});
    if(!response.ok)throw new Error(`Provider returned ${response.status}`); const data:any=await response.json(); const r=data.chart?.result?.[0];if(!r)throw new Error("No market series supplied"); const series=r.indicators.quote[0];
    const bars=(r.timestamp as number[]).map((ts,i)=>({date:new Date(ts*1000).toISOString().slice(0,10),close:series.close[i],volume:series.volume[i],comparableClose:r.indicators.adjclose?.[0]?.adjclose?.[i]}));
    const stats=completedSessionStats(bars,Object.values(r.events?.splits||{}).map((x:any)=>new Date(x.date*1000).toISOString().slice(0,10)));if(!stats)throw new Error("No completed session available");
    const {last,history,split}=stats;
    const result:Market={status:"available",provider:"Yahoo Finance · EOD",sessionDate:last.date,close:last.close,volume:last.volume,movePct:stats.movePct,volumeMultiple:stats.volumeMultiple,history,fetchedAt:new Date().toISOString(),error:split?"Corporate action affects comparison; alert calculations paused.":undefined};
    await db.prepare("INSERT INTO provider_cache(key,data,fetched_at) VALUES('market-RELIANCE',?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(JSON.stringify(result),result.fetchedAt).run();return result;
  }catch{return cached?{...JSON.parse(cached.data),stale:true,error:"Market refresh failed. Showing the last successful completed session."}:{status:"unavailable",provider:"Yahoo Finance · EOD",error:"The market provider is unavailable. Company reports and research remain available."};}
}
