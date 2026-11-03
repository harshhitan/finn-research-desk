// Adapt the application's bounded SQL contract to PostgreSQL. Values remain
// bound parameters throughout; source text and user input never become SQL.
export function postgresSql(input){
  let parameter=0;
  function expression(sql,jsonValue=false){
    let out='';
    for(let i=0;i<sql.length;){
      if(sql[i]==="'"){let end=i+1;while(end<sql.length){if(sql[end++]==="'"){if(sql[end]==="'"){end++;continue;}break;}}out+=sql.slice(i,end);i=end;continue;}
      if(sql[i]==='?'){out+='$'+(++parameter);i++;continue;}
      const name=sql.slice(i).match(/^([A-Za-z_][A-Za-z_0-9]*)\s*\(/);
      if(!name){out+=sql[i++];continue;}
      const start=i+name[0].length,args=[];let depth=1,quoted=false,last=start,end=start;
      for(;end<sql.length;end++){
        const c=sql[end];if(c==="'"){if(quoted&&sql[end+1]==="'"){end++;continue;}quoted=!quoted;continue;}if(quoted)continue;
        if(c==='(')depth++;if(c===')'&&!--depth&&c===')'){args.push(sql.slice(last,end));break;}
        if(c===','&&depth===1){args.push(sql.slice(last,end));last=end+1;}
      }
      if(depth!==0)throw new Error('Unbalanced SQL expression');
      const asJson=jsonValue&&!sql.slice(0,i).trim()&&!sql.slice(end+1).trim();
      const fn=name[1].toLowerCase(),path=value=>{const m=value.trim().match(/^'\$\.([A-Za-z0-9_.]+)'$/);if(!m)throw new Error('Unsupported JSON path');return "ARRAY["+m[1].split('.').map(p=>"'"+p+"'").join(',')+"]::text[]";};
      let rendered;
      if(fn==='json_extract'){
        const source=expression(args[0]),p=path(args[1]);rendered=`((${source})::jsonb ${asJson?'#>':'#>>'} ${p})`;
        if(!asJson&&/\.(count|durationMonths)'$/.test(args[1].trim()))rendered=`(${rendered})::numeric`;
      }else if(fn==='json_set'){
        if(args.length<3||args.length%2!==1)throw new Error('Invalid JSON update');rendered=`COALESCE((${expression(args[0])})::jsonb,'{}'::jsonb)`;
        for(let n=1;n<args.length;n+=2){const value=expression(args[n+1]),numeric=/\.count'$/.test(args[n].trim());const json=/^null$/i.test(value.trim())?"'null'::jsonb":`COALESCE(to_jsonb((${value})::${numeric?'numeric':'text'}),'null'::jsonb)`;rendered=`jsonb_set(${rendered},${path(args[n])},${json},true)`;}rendered=`(${rendered})::text`;
      }else if(fn==='json_object')rendered=`jsonb_build_object(${args.map((a,n)=>n%2?expression(a,true):expression(a)+'::text').join(',')})${asJson?'':'::text'}`;
      else if(fn==='json_group_array')rendered=`COALESCE(jsonb_agg(${expression(args[0],true)}),'[]'::jsonb)${asJson?'':'::text'}`;
      else if(fn==='json')rendered=`(${expression(args[0])})::jsonb`;
      else if(fn==='json_array_length')rendered=`jsonb_array_length(${args.length>1?`((${expression(args[0])})::jsonb #> ${path(args[1])})`:`(${expression(args[0])})::jsonb`})`;
      else if(fn==='json_each')rendered=`jsonb_array_elements(COALESCE((${expression(args[0])})::jsonb #> ${path(args[1])},'[]'::jsonb))`;
      else if(fn==='substr'&&args.length===2&&/^-[1-9][0-9]*$/.test(args[1].trim()))rendered=`RIGHT(${expression(args[0])},${args[1].trim().slice(1)})`;
      else rendered=(['max','min'].includes(fn)&&args.length>1?(fn==='max'?'GREATEST':'LEAST'):name[1])+'('+args.map(a=>expression(a)).join(',')+')';
      out+=rendered;i=end+1;
    }return out;
  }
  let sql=expression(input).replace(/\bIS NOT\s+('(?:[^']|'')*')/gi,'IS DISTINCT FROM $1').replace(/\$(\d+)\s+IS NULL/gi,'$$$1::text IS NULL').replace(/LIMIT -1\b/gi,'LIMIT ALL');
  sql=sql.replace(/\bd\.period GLOB 'FY20\[0-9\]\[0-9\]'/g,()=>"d.period ~ '^FY20[0-9][0-9]$'");
  if(/^\s*INSERT OR IGNORE\b/i.test(sql)){sql=sql.replace(/INSERT OR IGNORE/i,'INSERT');if(!/\bON CONFLICT\b/i.test(sql))sql=sql.replace(/\s+RETURNING\b/i,' ON CONFLICT DO NOTHING RETURNING');if(!/\bON CONFLICT\b/i.test(sql))sql+=' ON CONFLICT DO NOTHING';}
  let searchParameter=null;
  if(sql.includes('research_chunk_fts MATCH')){
    sql=sql.replace(/research_chunk_fts MATCH \$(\d+)/,(match,n)=>{searchParameter=Number(n)-1;return `to_tsvector('simple',f.heading || ' ' || f.text) @@ to_tsquery('simple',$${n})`;});
    sql=sql.replace(/bm25\(research_chunk_fts\)/g,`ts_rank(to_tsvector('simple',f.heading || ' ' || f.text),to_tsquery('simple',$${searchParameter+1})) DESC`);
  }
  return {text:sql,searchParameter,parameters:parameter};
}

export function postgresValues(compiled,values){
  if(compiled.parameters!==values.length)throw new Error('SQL parameter count mismatch');
  return values.map((v,i)=>i===compiled.searchParameter?String(v).replace(/"([a-zA-Z0-9]+)"/g,"'$1'").replace(/\bOR\b/g,'|').replace(/\bAND\b/g,'&'):v);
}
