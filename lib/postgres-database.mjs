import {Pool,types} from 'pg';
import {postgresSql,postgresValues} from './postgres-sql.mjs';

// Application counts use numbers, matching the previous D1 interface.
types.setTypeParser(20,value=>Number(value));
types.setTypeParser(1700,value=>Number(value));
export function postgresDatabase(connectionString){
  if(!connectionString)throw new Error('DATABASE_URL is not configured');
  const pool=new Pool({connectionString,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:15000});
  const result=r=>({results:r.rows,success:true,meta:{changes:r.rowCount||0}});
  async function transaction(run){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('finn-application-writes'))");const value=await run(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  const binding={
    prepare(source){
      const compiled=postgresSql(source),write=!/^\s*SELECT\b/i.test(source);
      const make=(values=[])=>({
        bind(...parameters){return make(parameters);},
        async _execute(client){return result(await client.query(compiled.text,postgresValues(compiled,values)));},
        async all(){return write?transaction(client=>this._execute(client)):this._execute(pool);},
        async run(){return this.all();},
        async first(column){const rows=(await this.all()).results;return rows.length?(column?rows[0][column]:rows[0]):null;},
      });return make();
    },
    async batch(statements){return transaction(async client=>{const results=[];for(const statement of statements)results.push(await statement._execute(client));return results;});},
    async close(){await pool.end();},
  };return binding;
}
