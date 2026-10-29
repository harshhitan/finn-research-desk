import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";

const source=await fs.readFile(new URL("../lib/filing-content.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const modulePath=new URL("../.sites-runtime/filing-content-test.mjs",import.meta.url);
await fs.mkdir(new URL("../.sites-runtime/",import.meta.url),{recursive:true});await fs.writeFile(modulePath,compiled);
const {validateFilingUrl,downloadFiling,extractFiling}=await import(modulePath.href);
assert.equal(validateFilingUrl("https://www.ril.com/reports/source.pdf").hostname,"www.ril.com");
for(const url of ["http://www.ril.com/source.pdf","https://localhost/source.pdf","https://127.0.0.1/private","https://www.ril.com.evil.test/source.pdf","https://user:pass@www.ril.com/source.pdf"]){assert.throws(()=>validateFilingUrl(url));}
await assert.rejects(()=>downloadFiling("https://www.ril.com/source.pdf",async()=>new Response(null,{status:302,headers:{Location:"http://127.0.0.1/private"}})));
await assert.rejects(()=>downloadFiling("https://www.ril.com/source.pdf",async()=>new Response("html instead of PDF")),/readable PDF/);
await assert.rejects(()=>downloadFiling("https://www.ril.com/source.pdf",async()=>new Response(null,{status:200,headers:{"content-length":"999999999"}})),/too large/);
await assert.rejects(()=>downloadFiling("https://www.ril.com/source.pdf",async()=>new Response("blocked",{status:403})),/could not provide/);
const fixture=new URL("../.sites-runtime/clsa-filing.pdf",import.meta.url);
try{
  const bytes=new Uint8Array(await fs.readFile(fixture));const result=await extractFiling("test-clsa","https://rilstaticasset.akamaized.net/sites/default/files/2026-09/SE_23092026.pdf",bytes);
  assert.equal(result.status,"ready");assert.equal(result.pageCount,1);assert.match(result.pages[0].text,/CITIC CLSA/);assert.match(result.pages[0].text,/Hong Kong/);assert.match(result.pages[0].text,/September 22 & 23, 2026/);assert.match(result.pages[0].text,/no unpublished price sensitive information/);assert.equal(result.pages[0].page,1);assert.equal(result.contentHash.length,64);
  console.log("PASS: exact reported CLSA filing has extracted page text, dates, location and content hash.");
}catch(error){if(error.code!=="ENOENT")throw error;console.log("Real filing fixture absent: extraction is checked by the running API acceptance test.");}
console.log("PASS: filing-source allowlist, unsafe redirects, non-PDF responses, download limits and source errors.");
