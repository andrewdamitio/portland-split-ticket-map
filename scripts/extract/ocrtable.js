// Parse Tesseract text of "Precinct NN  n n n ..." table rows using a per-page layout config.
// config: [{page:"data/ocr/benton/benton-01.txt" (relative to root), county, left:{contest,cols:[...]}, right:{...}|null, split:85}]
// side.fix: {precinct:{col:value}} manual corrections, each checked against the page image
// col spec: "cand:Name" | "writein" | "total_votes" | "overvotes" | "undervotes" | "ballots_cast" | "registered" | "skip"
const fs=require('fs'), path=require('path');
module.exports=function({cfg,root}){
const out=[],problems=[];
const fixTok=t=>{ if(/^[)\]}|]$|^0[)\]}]$|^[oO]$|^\(?0\)?$/.test(t)) return 0; if(/^\d{1,3}(,\d{3})*$|^\d+$/.test(t)) return +t.replace(/,/g,''); return null; };
for(const pg of cfg){
  const lines=fs.readFileSync(path.resolve(root,pg.page),'utf8').split(/\r?\n/);
  for(const line of lines){
    const m=line.match(/^\s*Precinct\s+(\S+)(\s+.*)$/); if(!m) continue;
    const pre=line.indexOf(m[1])+m[1].length;
    const toks=[...m[2].matchAll(/\S+/g)].map(x=>({t:x[0],pos:pre+x.index}));
    const vals=toks.map(x=>fixTok(x.t));
    if(vals.includes(null)){ problems.push(`${pg.page} ${m[1]}: unreadable token(s) ${toks.filter((x,i)=>vals[i]===null).map(x=>x.t)}`); continue; }
    const sides=[pg.left,pg.right].filter(Boolean);
    let groups;
    if(sides.length===1){ groups=[[sides[0],vals]]; }
    else { const nL=pg.left.cols.length,nR=pg.right.cols.length;
      if(vals.length===nL+nR) groups=[[pg.left,vals.slice(0,nL)],[pg.right,vals.slice(nL)]];
      else if(vals.length===nL||vals.length===nR){ const right= vals.length!==nL ? true : vals.length!==nR ? false : toks[0].pos>(pg.split||85); groups=[[right?pg.right:pg.left,vals]]; }
      else { problems.push(`${pg.page} ${m[1]}: ${vals.length} values fits neither side`); continue; } }
    for(const [side,v] of groups){
      if(!side.contest) continue; // side we don't need (e.g. Attorney General)
      if(v.length!==side.cols.length){ problems.push(`${pg.page} ${m[1]} ${side.contest}: ${v.length} values vs ${side.cols.length} cols`); continue; }
      const fx=(side.fix||{})[m[1]]||{}; for(const c in fx){ const i=side.cols.findIndex(x=>x===c||x==="cand:"+c); problems.push(`FIXED ${pg.page} ${m[1]} ${c}: ${v[i]} -> ${fx[c]}`); v[i]=fx[c]; }
      const rec={}; let sum=0;
      side.cols.forEach((c,i)=>{ if(c==='skip') return; if(c.startsWith('cand:')){ out.push([pg.county,m[1],side.contest,'candidate',c.slice(5),v[i]]); sum+=v[i]; } else { out.push([pg.county,m[1],side.contest,c,'',v[i]]); rec[c]=v[i]; if(c==='writein') sum+=v[i]; } });
      if(rec.total_votes!==undefined && sum!==rec.total_votes) problems.push(`${pg.page} ${m[1]} ${side.contest}: candidates+writein ${sum} != total ${rec.total_votes}`);
      if(rec.ballots_cast!==undefined && rec.total_votes!==undefined && rec.undervotes!==undefined && rec.total_votes+rec.undervotes+(rec.overvotes||0)!==rec.ballots_cast) problems.push(`${pg.page} ${m[1]} ${side.contest}: total+under+over != ballots ${rec.ballots_cast}`);
    }
  }
}
return {rows:out,problems};
};
