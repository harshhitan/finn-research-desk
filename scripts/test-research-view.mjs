import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const scratch=new URL('../.sites-runtime/research-view/',import.meta.url);await fs.mkdir(scratch,{recursive:true});
for(const name of ['research-markdown','research-answer-details']){const source=await fs.readFile(new URL('../app/'+name+'.tsx',import.meta.url),'utf8');await fs.writeFile(new URL(name+'.mjs',scratch),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);}
const {default:Markdown}=await import(new URL('research-markdown.mjs',scratch));
const {AnswerCalculations,WorkflowProgress}=await import(new URL('research-answer-details.mjs',scratch));
const render=text=>renderToStaticMarkup(React.createElement(Markdown,{text}));
const html=render('### Growth\n\n**Revenue** improved.\n\n| Metric | Change |\n| --- | --- |\n| Revenue | 11.11% |\n\n- First finding\n- Second finding\n\n1. Read source\n2. Compare period');
for(const tag of ['<h4>Growth</h4>','<strong>Revenue</strong>','<table>','<th>Metric</th>','<td>11.11%</td>','<ul>','<ol>'])assert.ok(html.includes(tag),tag);
const unsafe=render('<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n&#x3c;img src=x onerror=alert(1)&#x3e;');assert.ok(!unsafe.includes('<script>'));assert.ok(!unsafe.includes('href="javascript:'));assert.ok(!unsafe.includes('<img'));assert.ok(unsafe.includes('&lt;script&gt;'));assert.ok(render('text&#x20;here').includes('text here'));
const calc={id:'calc-real',label:'Revenue · annual YoY',formula:'(current − base) / base × 100',values:[{label:'annual YoY',value:'11.1111',unit:'%'}],inputs:[{factId:'a',metric:'revenue_from_operations',value:'180000',unit:'crore',period:'FY2025',scope:'consolidated',sourceIds:['source']}],sourceIds:['source']};
const output=renderToStaticMarkup(React.createElement(AnswerCalculations,{calculations:[calc],context:[{id:'source',period:'FY2026',page:10}],onEvidence:()=>{}}));assert.ok(output.includes('11.1111'));assert.ok(output.includes('Inputs, formula &amp; sources'));assert.ok(output.includes('FY2026 · page 10'));assert.ok(output.includes('consolidated'));
assert.ok(renderToStaticMarkup(React.createElement(WorkflowProgress,{workflow:{stage:'Reviewing evidence',steps:[{tool:'compare_facts',detail:'Verified calculation completed'}],calculations:[calc]},running:true})).includes('Compare reporting periods'));
const hub=await fs.readFile(new URL('../app/research-hub.tsx',import.meta.url),'utf8');assert.ok(!hub.includes('ResearchFinancials'));assert.ok(hub.includes('ResearchMarkdown'));
console.log('PASS: Markdown headings/lists/tables, escaped HTML and unsafe links, calculation provenance, workflow status and removal of standalone calculator.');
