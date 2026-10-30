import assert from "node:assert/strict";
import fs from "node:fs/promises";
const base=process.env.FINN_TEST_URL||"http://127.0.0.1:5173";
const post=async body=>{const r=await fetch(`${base}/api/plots`,{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json()};};
const catalogue=await fetch(`${base}/api/plots`,{signal:AbortSignal.timeout(10000)}).then(r=>r.json());assert.equal(catalogue.tool,"plot_verified_data");
for(const kind of ["performance","cash-quality","net-debt","segment-ebitda"]){const r=await post({kind});assert.equal(r.status,200);assert.equal(r.data.status,"ready");assert.ok(r.data.series.every(s=>s.points.every(p=>p.value==null||p.sources.length>0)));}
const q=await post({kind:"performance",frequency:"quarterly"});assert.equal(q.data.series[1].points[0].inputs[0].value,49100);
assert.equal((await post({kind:"performance",frequency:"quarterly",context:"research"})).data.status,"unavailable");
assert.equal((await post({kind:"cash-quality",from:"2030-01-01"})).data.status,"unavailable");
assert.equal((await post({kind:"performance",values:[1,2,3]})).status,400);
assert.equal((await post({kind:"performance",from:"2026-02-30"})).status,400);
assert.equal((await post({kind:"guidance"})).data.status,"unavailable");assert.equal((await post({kind:"candlestick"})).data.status,"unavailable");
const csv=await fetch(`${base}/api/plots/export?kind=cash-quality&format=csv`,{signal:AbortSignal.timeout(10000)});assert.equal(csv.status,200);assert.match(csv.headers.get("content-disposition"),/attachment/);const csvText=await csv.text();assert.match(csvText,/Original sources/);assert.match(csvText,/e-cashflow\.facts\.FY2026\.cfo/);assert.match(csvText,/192113/);
const svg=await fetch(`${base}/api/plots/export?kind=performance&format=svg`,{signal:AbortSignal.timeout(10000)});assert.equal(svg.status,200);assert.match(svg.headers.get("content-type"),/image\/svg\+xml/);const svgText=await svg.text();assert.match(svgText,/<metadata>/);assert.match(svgText,/1175919/);assert.match(svgText,/EBITDA \/ gross revenue/);assert.ok(!svgText.includes("NaN"));
await fs.mkdir(new URL("../.sites-runtime/",import.meta.url),{recursive:true});await fs.writeFile(new URL("../.sites-runtime/verified-plot.svg",import.meta.url),svgText);await fs.writeFile(new URL("../.sites-runtime/verified-plot.csv",import.meta.url),csvText);
assert.equal((await fetch(`${base}/api/plots/export?kind=candlestick&format=svg`,{signal:AbortSignal.timeout(10000)})).status,422);
console.log("PASS: plotting API catalogue, four verified recipes, quarter basis, corpus restrictions, missing periods, rejection of invented inputs, and downloadable CSV/SVG with full provenance.");
