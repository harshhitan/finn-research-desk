import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";

const source=await fs.readFile(new URL("../lib/plots.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {buildPlot,plotCsv}=await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const c=JSON.parse(await fs.readFile(new URL("../data/reliance.json",import.meta.url),"utf8"));
const clone=()=>structuredClone(c);
const annual=buildPlot(c,{kind:"performance"});assert.equal(annual.status,"ready");assert.equal(annual.series[0].points.length,3);
const rev=annual.series[0].points.at(-1);const ratio=annual.series[1].points.at(-1);assert.equal(rev.value,1175919);assert.equal(ratio.kind,"calculated");assert.ok(Math.abs(ratio.value-100*207911/1175919)<1e-12);assert.equal(ratio.inputs.length,2);
for(const s of annual.series)for(const p of s.points){if(p.value==null)continue;assert.ok(p.sources.length);for(const ref of p.sources){assert.ok(ref.url.startsWith("https://"));assert.ok(ref.factPath);assert.ok(c.evidence.some(e=>e.id===ref.evidenceId));}}
const cash=buildPlot(c,{kind:"cash-quality"});assert.equal(cash.series[1].points[0].value,null);assert.equal(cash.series[1].points[0].sources.length,0);assert.equal(cash.series[1].points.at(-1).value,192113);
const modified=clone();modified.annual.at(-1).grossRevenue=999;assert.equal(buildPlot(modified,{kind:"performance"}).series[0].points.at(-1).value,null);assert.equal(buildPlot(modified,{kind:"performance"}).series[1].points.at(-1).value,null);
const conflict=clone();conflict.evidence.find(e=>e.id==="e-income").facts.FY2026.grossRevenue=123;assert.equal(buildPlot(conflict,{kind:"performance"}).series[0].points.at(-1).value,null);
const missing=clone();missing.evidence=missing.evidence.filter(e=>e.id!=="e-debt");assert.equal(buildPlot(missing,{kind:"net-debt"}).status,"unavailable");
const wrongUnit=clone();wrongUnit.unit="million";assert.equal(buildPlot(wrongUnit,{kind:"cash-quality"}).status,"unavailable");
const q=buildPlot(c,{kind:"performance",frequency:"quarterly"});assert.equal(q.status,"ready");assert.equal(q.series[1].points[0].inputs[0].value,49100);assert.ok(q.notes.some(n=>n.includes("8,924")));assert.equal(q.series[0].points[0].date,"2025-06-30");assert.equal(q.series[0].points[1].date,"2026-03-31");
assert.equal(buildPlot(c,{kind:"performance",frequency:"quarterly",context:"research"}).status,"unavailable");
const segment=buildPlot(c,{kind:"segment-ebitda"});assert.equal(segment.status,"ready");assert.equal(segment.series[0].points.length,5);assert.equal(segment.series[0].points.find(p=>p.label==="Digital Services").value,76560);
assert.equal(buildPlot(c,{kind:"segment-ebitda",from:"2025-01-01",to:"2025-12-31"}).status,"unavailable");
assert.equal(buildPlot(c,{kind:"guidance"}).status,"unavailable");assert.equal(buildPlot(c,{kind:"candlestick"}).status,"unavailable");assert.equal(buildPlot(c,{kind:"price-volume"}).status,"unavailable");
assert.equal(buildPlot(c,{kind:"performance",from:"2030-01-01"}).status,"unavailable");assert.equal(buildPlot(c,{kind:"performance",from:"2026-12-31",to:"2024-01-01"}).status,"unavailable");assert.equal(buildPlot(c,{kind:"performance",ticker:"TCS"}).status,"unavailable");
const market={status:"available",provider:"Test provider fixture",fetchedAt:"2026-10-29T12:00:00Z",history:[{date:"2026-10-28",close:100,volume:120},{date:"2026-10-29",close:105,volume:170}]};
const price=buildPlot(c,{kind:"price-volume"},market);assert.equal(price.series[0].points[0].value,100);assert.equal(price.series[1].unit,"shares");assert.equal(price.series[1].axis,"right");assert.ok(price.series.every(s=>s.points.every(p=>p.sources[0].retrievedAt===market.fetchedAt)));
assert.equal(buildPlot(c,{kind:"price-volume"},{...market,history:[market.history[0],market.history[0]]}).status,"unavailable");
const csv=plotCsv(cash);assert.match(csv,/Original sources/);assert.match(csv,/e-cashflow\.facts\.FY2026\.cfo/);assert.match(csv,/"FY2024","2024-03-31","","₹ crore"/);assert.ok(!csv.includes("NaN"));
console.log("PASS: plot provenance, calculated inputs, missing gaps, tampered/conflicting facts, units, scope, quarterly basis, segment period, unavailable guidance/OHLC, provider references and CSV citations.");
