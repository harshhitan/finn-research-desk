import {database} from "../repository";
let ready:Promise<void>|undefined;
export function ensurePortfolio(){
  if(!ready)ready=(async()=>{
    const db=database();
    // Idempotent setup also supports an existing deployed D1 database. No old
    // research tables are replaced; indexes enforce durable idempotency.
    for(const sql of [
      "CREATE TABLE IF NOT EXISTS portfolio_companies(ticker TEXT PRIMARY KEY,data TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS portfolio_filings(id TEXT PRIMARY KEY,ticker TEXT NOT NULL,published_at TEXT NOT NULL,attachment_url TEXT,data TEXT NOT NULL,first_seen TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS portfolio_filings_window ON portfolio_filings(published_at,ticker)",
      "CREATE INDEX IF NOT EXISTS portfolio_filings_attachment ON portfolio_filings(ticker,attachment_url)",
      "CREATE TABLE IF NOT EXISTS portfolio_prices(ticker TEXT NOT NULL,session_date TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(ticker,session_date))",
      "CREATE TABLE IF NOT EXISTS portfolio_sources(ticker TEXT NOT NULL,source TEXT NOT NULL,last_attempt TEXT NOT NULL,last_success TEXT,error TEXT,coverage TEXT NOT NULL,PRIMARY KEY(ticker,source))",
      "CREATE TABLE IF NOT EXISTS portfolio_jobs(id TEXT PRIMARY KEY,ticker TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,available_at TEXT NOT NULL,lease_until TEXT,error TEXT,finished_at TEXT,payload TEXT)",
      "CREATE INDEX IF NOT EXISTS portfolio_jobs_claim ON portfolio_jobs(status,available_at)",
      "CREATE TABLE IF NOT EXISTS portfolio_locks(name TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS portfolio_rules(owner TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS portfolio_alerts(owner TEXT NOT NULL,trigger_key TEXT NOT NULL,ticker TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,PRIMARY KEY(owner,trigger_key))",
      "CREATE TABLE IF NOT EXISTS portfolio_analysis(owner TEXT NOT NULL,filing_id TEXT NOT NULL,content_hash TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,filing_id))",
      "CREATE TABLE IF NOT EXISTS portfolio_oauth(state_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,transaction_data TEXT NOT NULL,expires_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS portfolio_accounts(owner TEXT PRIMARY KEY,subject TEXT NOT NULL,credentials TEXT NOT NULL,expires_at TEXT NOT NULL,scopes TEXT NOT NULL,updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS portfolio_model_leases(owner TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL)",
    ])await db.prepare(sql).run();
  })().catch(e=>{ready=undefined;throw e;});
  return ready;
}
export async function sourceState(ticker:string,source:string,success:boolean,coverage:string,error?:string){
  const now=new Date().toISOString();
  await database().prepare("INSERT INTO portfolio_sources(ticker,source,last_attempt,last_success,error,coverage) VALUES(?,?,?,?,?,?) ON CONFLICT(ticker,source) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=COALESCE(excluded.last_success,portfolio_sources.last_success),error=excluded.error,coverage=excluded.coverage").bind(ticker,source,now,success?now:null,error?.slice(0,240)||null,coverage).run();
}
