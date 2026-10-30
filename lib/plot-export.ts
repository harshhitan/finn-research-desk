import type { PlotPoint, PlotSeries, PlotSpec } from "./plot-types";

const xml=(value:unknown)=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
const tick=(v:number)=>Math.abs(v)>=100000?`${(v/100000).toFixed(1)}L`:Math.abs(v)>=1000?`${(v/1000).toFixed(0)}k`:Number(v.toFixed(1)).toString();
export function plotSvg(spec:PlotSpec){
  const width=960,height=630,left=spec.kind==="segment-ebitda"?160:85,right=spec.series.some(s=>s.axis==="right")?80:50,top=125,bottom=420,plotW=width-left-right,plotH=bottom-top;
  const sources=[...new Map(spec.series.flatMap(s=>s.points.flatMap(p=>p.sources)).map(s=>[s.url,s])).values()];
  const points=spec.series[0]?.points||[];const dates=points.map(p=>Date.parse(p.date));const first=Math.min(...dates),last=Math.max(...dates);
  const x=(i:number)=>points.length<=1?left+plotW/2:left+20+(dates[i]-first)/(last-first||1)*(plotW-40);
  const domain=(axis:string)=>{const values=spec.series.filter(s=>s.axis===axis).flatMap(s=>s.points.filter(p=>p.value!=null).map(p=>p.value!));return {min:Math.min(0,...values)*1.12,max:Math.max(0,...values)*1.12||1}};
  const domains={left:domain("left"),right:domain("right")};const y=(v:number,axis:"left"|"right")=>bottom-(v-domains[axis].min)/(domains[axis].max-domains[axis].min||1)*plotH;
  const text=(px:number,py:number,value:unknown,size=12,fill="#617456",anchor="start")=>`<text x="${px}" y="${py}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${xml(value)}</text>`;
  const line=(x1:number,y1:number,x2:number,y2:number)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#e4e9df" stroke-dasharray="3 5"/>`;
  const markTitle=(p:PlotPoint,s:PlotSeries)=>`<title>${xml(`${p.label}: ${s.label} ${p.value} ${p.unit}; ${p.kind}; ${p.basis}`)}</title>`;
  let body=text(40,38,`${spec.company} | ${spec.title}`,24,"#234f40")+text(40,63,spec.description.slice(0,130),12)+spec.series.map((s,i)=>`<rect x="${40+i*365}" y="82" width="10" height="10" fill="${s.color}"/>${text(57+i*365,91,`${s.label} (${s.unit})`,11)}`).join("");
  if(spec.kind==="segment-ebitda"){
    body+=text(left,top-17,"₹ crore · segment EBITDA",11);
    for(const f of [0,.25,.5,.75,1])body+=line(left+plotW*f,top,left+plotW*f,bottom)+text(left+plotW*f,bottom+25,tick(domains.left.max*f),11,"#718267","middle");
    points.forEach((p,i)=>{const cy=top+24+i*(plotH/points.length);body+=text(left-12,cy+4,p.label,11,"#536847","end");if(p.value==null){body+=text(left+10,cy+4,"Unavailable — no verified fact",11,"#a38952");return}const barW=p.value/domains.left.max*plotW;body+=`<g>${markTitle(p,spec.series[0])}<rect x="${left}" y="${cy-13}" width="${barW}" height="27" rx="3" fill="${spec.series[0].color}"/>${text(left+barW+7,cy+5,p.value.toLocaleString("en-IN"),12)}</g>`;});
  }else{
    for(const axis of ["left","right"] as const){const series=spec.series.find(s=>s.axis===axis);if(!series)continue;body+=text(axis==="left"?left:width-right,top-17,series.unit,11,"#617456",axis==="left"?"start":"end");for(const f of [0,.25,.5,.75,1]){const d=domains[axis],v=d.min+(d.max-d.min)*f,yy=y(v,axis);if(axis==="left")body+=line(left,yy,width-right,yy);body+=text(axis==="left"?left-11:width-right+11,yy+4,tick(v),11,"#718267",axis==="left"?"end":"start");}}
    for(const s of [...spec.series].sort((a,b)=>Number(a.display==="line")-Number(b.display==="line"))){
      const bars=spec.series.filter(s=>s.display==="bar"),barIndex=bars.findIndex(v=>v.id===s.id),barWidth=Math.min(36,Math.max(2,plotW/Math.max(1,points.length)*.65/Math.max(1,bars.length))),offset=(barIndex-(bars.length-1)/2)*barWidth;
      if(s.display==="line"){let previous:PlotPoint|null=null;const path:string[]=[];for(let i=0;i<s.points.length;i++){const p=s.points[i];if(p.value==null){previous=null;continue}const gap=previous?(Date.parse(p.date)-Date.parse(previous.date))/86400000:Infinity;const limit=spec.frequency==="quarterly"?110:spec.frequency==="annual"?380:7;path.push(`${previous&&gap<=limit?"L":"M"}${x(i)},${y(p.value,s.axis)}`);previous=p;}body+=`<path d="${path.join(" ")}" fill="none" stroke="${s.color}" stroke-width="3"/>`;}
      s.points.forEach((p,i)=>{if(p.value==null){body+=text(x(i),bottom+18,"gap",10,"#a38952","middle");return}const yy=y(p.value,s.axis),zero=y(0,s.axis);body+=`<g>${markTitle(p,s)}${s.display==="bar"?`<rect x="${x(i)-barWidth/2+offset}" y="${Math.min(yy,zero)}" width="${barWidth*.88}" height="${Math.max(1,Math.abs(zero-yy))}" rx="2" fill="${s.color}" opacity="${s.axis==="right"?.4:.9}"/>`:`<circle cx="${x(i)}" cy="${yy}" r="${points.length>25?3:5}" fill="#fff" stroke="${s.color}" stroke-width="3"/>`}</g>`;});
    }
    points.forEach((p,i)=>{if(points.length<=5||i===0||i===points.length-1||i===Math.floor(points.length/2))body+=text(x(i),bottom+40,spec.frequency==="daily"?p.date:p.label,11,"#718267","middle")});
  }
  body+=text(40,490,"Observed values only. Gaps are not zero-filled. Ratios are calculated from the cited inputs.",11);
  body+=text(40,512,"Open Data & evidence in FINN or inspect this SVG's metadata for every value, basis, calculation and source path.",10,"#829077");
  sources.slice(0,4).forEach((s,i)=>{body+=`<a href="${xml(s.url)}">${text(40,538+i*19,`[${i+1}] ${s.title}${s.page?` · p. ${s.page}`:""} · ${s.section}`.slice(0,142),10,"#557a43")}</a>`;});
  body+=text(40,617,`FINN · ${spec.frequency} · generated ${spec.generatedAt} · Full provenance embedded below the SVG title`,9,"#8b987f");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><title>${xml(spec.title)}</title><desc>${xml(spec.description)}</desc><metadata>${xml(JSON.stringify(spec))}</metadata><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
}
