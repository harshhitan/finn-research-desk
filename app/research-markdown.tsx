import {Fragment,type ReactNode} from 'react';

// Small, deliberately text-only Markdown renderer. React escapes all source
// strings; HTML, scripts, images and embedded frames are never interpreted.
function decode(text:string){return text.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi,(_,number,name)=>{if(number){const n=number[0].toLowerCase()==='x'?parseInt(number.slice(1),16):Number(number);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[name.toLowerCase()];});}
function inline(text:string):ReactNode[]{
  const parts=text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\*[^*\n]+\*)/g);
  return parts.map((part,i)=>{if(part.startsWith('**')&&part.endsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;if(part.startsWith('`')&&part.endsWith('`'))return <code key={i}>{part.slice(1,-1)}</code>;if(part.startsWith('*')&&part.endsWith('*'))return <em key={i}>{part.slice(1,-1)}</em>;const link=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);if(link)return /^https?:\/\//i.test(link[2])?<a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>:<Fragment key={i}>{link[1]}</Fragment>;return <Fragment key={i}>{part}</Fragment>;});
}
const cells=(line:string)=>line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
const divider=(line:string)=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
export default function ResearchMarkdown({text}:{text:string}){
  const lines=decode(text).replace(/\r\n/g,'\n').split('\n'),blocks:ReactNode[]=[];
  for(let i=0;i<lines.length;){
    const line=lines[i];if(!line.trim()){i++;continue;}
    if(i+1<lines.length&&line.includes('|')&&divider(lines[i+1])){
      const headers=cells(line),rows:string[][]=[];i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));
      blocks.push(<div className="rh-table-scroll" key={i} tabIndex={0} aria-label="Answer data table"><table><thead><tr>{headers.map((cell,j)=><th key={j}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row,j)=><tr key={j}>{headers.map((_,k)=><td key={k}>{inline(row[k]||'—')}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const heading=/^#{1,6}\s+(.+)$/.exec(line);if(heading){blocks.push(<h4 key={i}>{inline(heading[1])}</h4>);i++;continue;}
    if(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)){
      const ordered=/^\s*\d+[.)]/.test(line),items:ReactNode[]=[];
      while(i<lines.length&&/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[i])){items.push(<li key={i}>{inline(lines[i++].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/,''))}</li>);}
      blocks.push(ordered?<ol key={i}>{items}</ol>:<ul key={i}>{items}</ul>);continue;
    }
    if(/^>\s?/.test(line)){blocks.push(<blockquote key={i}>{inline(line.replace(/^>\s?/,''))}</blockquote>);i++;continue;}
    const paragraph=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|>\s|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])&&!(lines[i].includes('|')&&i+1<lines.length&&divider(lines[i+1])))paragraph.push(lines[i++]);
    blocks.push(<p key={i}>{inline(paragraph.join(' '))}</p>);
  }
  return <div className="rh-markdown">{blocks}</div>;
}
