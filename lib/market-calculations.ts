export type TradingBar={date:string;close:number;volume:number;comparableClose?:number};

export function completedSessionStats(bars:TradingBar[],splitDates:string[],now=new Date()){
  const today=now.toISOString().slice(0,10);const complete=now.getUTCHours()>=10;
  const history=bars.filter(p=>Number.isFinite(p.close)&&p.close>0&&Number.isFinite(p.volume)&&p.volume>0&&(p.date<today||(p.date===today&&complete))).sort((a,b)=>a.date.localeCompare(b.date));
  const last=history.at(-1);if(!last)return null;const previous=history.at(-2);const baseline=history.slice(-21,-1);
  const split=splitDates.some(d=>d>=(history.at(-21)?.date||last.date)&&d<=last.date);
  const mean=baseline.length===20?baseline.reduce((s,p)=>s+p.volume,0)/20:null;
  const useAdjusted=Number.isFinite(last.comparableClose)&&Number.isFinite(previous?.comparableClose);
  const comparable=useAdjusted?last.comparableClose!:last.close;const previousComparable=useAdjusted?previous?.comparableClose:previous?.close;
  return {history,last,baseline,split,movePct:previousComparable&&previousComparable>0&&!split?100*(comparable/previousComparable-1):null,volumeMultiple:mean&&mean>0&&!split?last.volume/mean:null};
}
