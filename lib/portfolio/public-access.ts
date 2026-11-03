import {env} from 'cloudflare:workers';
import {privateCodexConfig} from './private-config';
export const publicAIEnabled=()=>String((env as unknown as Record<string,string>).FINN_PUBLIC_AI)==='1';
export function portfolioAnalysisOwner(visitor:string){return publicAIEnabled()?privateCodexConfig()?.owner||visitor:visitor;}
