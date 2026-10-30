// FINN's independent OpenAI adapter. It does not read Codex auth.json, import
// Hermes, reuse another application's client ID, or proxy a personal login.
import {env} from "cloudflare:workers";
import {database} from "../repository";
import {boundedText,digest} from "./sources";
export type AuthConfig={clientId:string;clientSecret?:string;redirectUri:string;scopes:string[];model:string;encryptionKey:string;tokenAuth:"none"|"client_secret_basic"};
export function authConfig():AuthConfig|null{
  const e=env as unknown as Record<string,string|undefined>;
  if(e.FINN_CHATGPT_HOSTED_APPROVED!=="true"||!e.FINN_CHATGPT_CLIENT_ID?.startsWith("oaiapp_")||!e.FINN_CHATGPT_REDIRECT_URI||!e.FINN_CHATGPT_ENCRYPTION_KEY||!e.FINN_CHATGPT_MODEL||!e.FINN_CHATGPT_SCOPES)return null;
  let redirect:URL;try{redirect=new URL(e.FINN_CHATGPT_REDIRECT_URI);}catch{return null;}
  if(redirect.protocol!=="https:"||redirect.pathname!=="/api/portfolio/chatgpt/callback"||redirect.search||redirect.hash||redirect.username||redirect.password||redirect.port||!/^[A-Za-z0-9_-]{43}$/.test(e.FINN_CHATGPT_ENCRYPTION_KEY)||!["none","client_secret_basic"].includes(e.FINN_CHATGPT_TOKEN_AUTH||""))return null;
  const scopes=e.FINN_CHATGPT_SCOPES.split(/\s+/).filter(Boolean);
  // Hosted scopes must come from the approved registration, not the OSS client
  // registration contract. An identity-only client never enables inference.
  if(!scopes.includes("openid")||!scopes.includes("offline_access")||!scopes.some(s=>s!=="openid"&&s!=="email"&&s!=="profile"&&s!=="offline_access"))return null;
  if(e.FINN_CHATGPT_TOKEN_AUTH==="client_secret_basic"&&!e.FINN_CHATGPT_CLIENT_SECRET)return null;
  return {clientId:e.FINN_CHATGPT_CLIENT_ID,clientSecret:e.FINN_CHATGPT_CLIENT_SECRET,redirectUri:redirect.href,scopes,model:e.FINN_CHATGPT_MODEL,encryptionKey:e.FINN_CHATGPT_ENCRYPTION_KEY,tokenAuth:e.FINN_CHATGPT_TOKEN_AUTH==="client_secret_basic"?"client_secret_basic":"none"};
}
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const unb64=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
export const randomSecret=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export async function pkceChallenge(value:string){return b64(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));}
async function key(config:AuthConfig){const bytes=unb64(config.encryptionKey);if(bytes.length!==32)throw new Error("Credential encryption is not configured");return crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);}
export async function seal(value:unknown,owner:string,config:AuthConfig){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(owner)},await key(config),new TextEncoder().encode(JSON.stringify(value)));return `${b64(iv)}.${b64(new Uint8Array(data))}`;}
export async function unseal(value:string,owner:string,config:AuthConfig){const [iv,data]=value.split(".");const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(iv),additionalData:new TextEncoder().encode(owner)},await key(config),unb64(data));return JSON.parse(new TextDecoder().decode(plain));}
type Discovery={issuer:string;authorization_endpoint:string;token_endpoint:string;jwks_uri:string};
let discoveryCache:{value:Discovery;at:number}|undefined;
export async function discovery():Promise<Discovery>{
  if(discoveryCache&&Date.now()-discoveryCache.at<3600000)return discoveryCache.value;
  const value=JSON.parse(await boundedText(await fetch("https://auth.openai.com/.well-known/openid-configuration",{signal:AbortSignal.timeout(10000),redirect:"error"}),100000));
  if(value.issuer!=="https://auth.openai.com")throw new Error("Unexpected OpenAI identity issuer");
  for(const name of ["authorization_endpoint","token_endpoint","jwks_uri"]){const u=new URL(value[name]);if(u.origin!==value.issuer||u.username||u.password||u.hash)throw new Error("Unexpected OpenAI authorization endpoint");}
  discoveryCache={value,at:Date.now()};return value;
}
export async function verifyIdToken(token:string,nonce:string,config:AuthConfig,keys?:JsonWebKey[]){
  const parts=token.split(".");if(parts.length!==3)throw new Error("Invalid identity token");const header=JSON.parse(new TextDecoder().decode(unb64(parts[0]))),claims=JSON.parse(new TextDecoder().decode(unb64(parts[1])));
  if(header.alg!=="RS256"||typeof header.kid!=="string")throw new Error("Unsupported identity signature");
  if(!keys){const d=await discovery();const jwks=JSON.parse(await boundedText(await fetch(d.jwks_uri,{signal:AbortSignal.timeout(10000),redirect:"error"}),100000));keys=jwks.keys;}
  const jwk=keys?.find((k:any)=>k.kid===header.kid&&k.kty==="RSA"&&(!k.use||k.use==="sig")&&(!k.alg||k.alg==="RS256"));if(!jwk)throw new Error("Identity signing key not found");
  const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  if(!await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,unb64(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))throw new Error("Identity signature invalid");
  const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud],now=Date.now()/1000;
  if(claims.iss!=="https://auth.openai.com"||!audience.includes(config.clientId)||audience.length>1&&claims.azp!==config.clientId||claims.azp!==undefined&&claims.azp!==config.clientId||typeof claims.exp!=="number"||claims.exp<now-5||typeof claims.iat!=="number"||claims.iat>now+5||claims.nbf&&claims.nbf>now+5||claims.nonce!==nonce||typeof claims.sub!=="string"||!claims.sub)throw new Error("Identity claims invalid");
  return claims;
}
async function tokenRequest(body:URLSearchParams,config:AuthConfig){
  const d=await discovery(),headers:Record<string,string>={"Content-Type":"application/x-www-form-urlencoded","Accept":"application/json"};
  if(config.tokenAuth==="client_secret_basic"){const form=(s:string)=>new URLSearchParams({v:s}).toString().slice(2);headers.Authorization=`Basic ${btoa(`${form(config.clientId)}:${form(config.clientSecret!)}`)}`;}
  const response=await fetch(d.token_endpoint,{method:"POST",headers,body,redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error("ChatGPT authorization failed. Reconnect your account.");}
  const result=JSON.parse(await boundedText(response,200000));if(typeof result.access_token!=="string"||result.token_type?.toLowerCase()!=="bearer"||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw new Error("Invalid authorization response");return result;
}
export async function subscriptionStatus(owner:string){const config=authConfig();const row=await database().prepare("SELECT updated_at,expires_at FROM portfolio_accounts WHERE owner=?").bind(owner).first<{updated_at:string;expires_at:string}>();return {configured:!!config,connected:!!config&&!!row,model:config?.model||null,connectedAt:row?.updated_at||null,reason:config?null:"Hosted ChatGPT-plan access needs FINN's approved client registration, authorized inference scopes and server-side configuration. Existing Site sign-in establishes identity only."};}
export async function startSubscription(owner:string,request:Request){
  const config=authConfig();if(!config)throw new Error("Hosted ChatGPT-plan authorization is not configured");if(new URL(request.url).origin!==new URL(config.redirectUri).origin)throw new Error("Authorization must start on the registered Site origin");
  const state=randomSecret(),nonce=randomSecret(),verifier=randomSecret(),stateHash=await digest(state);const transaction={nonce,verifier,redirectUri:config.redirectUri};
  await database().prepare("DELETE FROM portfolio_oauth WHERE expires_at<?").bind(new Date().toISOString()).run();
  await database().prepare("INSERT INTO portfolio_oauth(state_hash,owner,transaction_data,expires_at) VALUES(?,?,?,?)").bind(stateHash,owner,await seal(transaction,owner,config),new Date(Date.now()+600000).toISOString()).run();
  const d=await discovery(),url=new URL(d.authorization_endpoint);url.search=new URLSearchParams({client_id:config.clientId,response_type:"code",redirect_uri:config.redirectUri,scope:config.scopes.join(" "),resource:"https://api.openai.com/v1",state,nonce,code_challenge:await pkceChallenge(verifier),code_challenge_method:"S256"}).toString();
  return {url:url.href,cookie:`finn_chatgpt_oauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/portfolio/chatgpt; Max-Age=600`};
}
export async function finishSubscription(owner:string,request:Request){
  const config=authConfig();if(!config)throw new Error("Hosted ChatGPT-plan authorization is not configured");const url=new URL(request.url),state=url.searchParams.get("state");
  const cookie=request.headers.get("cookie")?.match(/(?:^|;\s*)finn_chatgpt_oauth=([A-Za-z0-9_-]+)/)?.[1];if(!state||state!==cookie||state.length>100||url.origin!==new URL(config.redirectUri).origin)throw new Error("Authorization transaction did not match");
  const transaction=await database().prepare("DELETE FROM portfolio_oauth WHERE state_hash=? AND owner=? AND expires_at>? RETURNING transaction_data").bind(await digest(state),owner,new Date().toISOString()).first<{transaction_data:string}>();if(!transaction||url.searchParams.has("error"))throw new Error("Authorization expired, was declined or was already used");
  const data=await unseal(transaction.transaction_data,owner,config),code=url.searchParams.get("code");if(!code||code.length>8000)throw new Error("Missing authorization code");
  const tokens=await tokenRequest(new URLSearchParams({grant_type:"authorization_code",client_id:config.clientId,code,code_verifier:data.verifier,redirect_uri:data.redirectUri}),config);
  const claims=await verifyIdToken(tokens.id_token,data.nonce,config);const scopes=String(tokens.scope||"").split(/\s+/);if(config.scopes.some(s=>!scopes.includes(s)))throw new Error("ChatGPT plan permissions were not granted");
  const credentials=await seal({accessToken:tokens.access_token,refreshToken:tokens.refresh_token},owner,config);
  await database().prepare("INSERT INTO portfolio_accounts(owner,subject,credentials,expires_at,scopes,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET subject=excluded.subject,credentials=excluded.credentials,expires_at=excluded.expires_at,scopes=excluded.scopes,updated_at=excluded.updated_at").bind(owner,claims.sub,credentials,new Date(Date.now()+tokens.expires_in*1000).toISOString(),JSON.stringify(scopes),new Date().toISOString()).run();
}
// Call only while holding this owner's model lease: refresh tokens may rotate.
export async function subscriptionAccess(owner:string){
  const config=authConfig();if(!config)throw new Error("Hosted ChatGPT-plan authorization is not configured");const db=database();const row=await db.prepare("SELECT credentials,expires_at FROM portfolio_accounts WHERE owner=?").bind(owner).first<{credentials:string;expires_at:string}>();if(!row)throw new Error("Connect ChatGPT before requesting model analysis");
  const credentials=await unseal(row.credentials,owner,config);if(Date.parse(row.expires_at)>Date.now()+60000)return {token:credentials.accessToken,model:config.model};
  if(!credentials.refreshToken)throw new Error("ChatGPT connection expired. Reconnect your account.");
  const result=await tokenRequest(new URLSearchParams({grant_type:"refresh_token",client_id:config.clientId,refresh_token:credentials.refreshToken}),config);
  await db.prepare("UPDATE portfolio_accounts SET credentials=?,expires_at=? WHERE owner=? AND credentials=?").bind(await seal({accessToken:result.access_token,refreshToken:result.refresh_token||credentials.refreshToken},owner,config),new Date(Date.now()+result.expires_in*1000).toISOString(),owner,row.credentials).run();return {token:result.access_token,model:config.model};
}
export async function disconnectSubscription(owner:string){const db=database();await db.batch([db.prepare("DELETE FROM portfolio_accounts WHERE owner=?").bind(owner),db.prepare("DELETE FROM portfolio_oauth WHERE owner=?").bind(owner),db.prepare("UPDATE portfolio_jobs SET status='cancelled',error='Account disconnected' WHERE kind='analyse' AND status IN ('queued','retry') AND json_extract(payload,'$.owner')=?").bind(owner)]);}
