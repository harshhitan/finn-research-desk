import {Pool} from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const connectionString=process.env.DATABASE_URL_UNPOOLED;
if(!connectionString)throw new Error('Set DATABASE_URL_UNPOOLED in the server environment; never pass it as a command argument');
if(new URL(connectionString).hostname.includes('-pooler'))throw new Error('Migrations require the direct, unpooled Neon connection');
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:15000});
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('finn-schema-migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS finn_schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const directory=new URL('../../db/neon/',import.meta.url);
  for(const name of (await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
    const sql=await readFile(new URL(name,directory),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
    const prior=await client.query('SELECT checksum FROM finn_schema_migrations WHERE name=$1',[name]);
    if(prior.rowCount){if(prior.rows[0].checksum!==checksum)throw new Error('Previously applied migration changed: '+name);continue;}
    await client.query(sql);
    await client.query('INSERT INTO finn_schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
    console.log('Applied '+name);
  }
  await client.query('COMMIT');
}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
