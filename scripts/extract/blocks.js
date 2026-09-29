// Column-block reports ("Ballots Cast per Contest with Precincts", "Statement of Votes Cast by Contests,
// Geography by Choice"): each row is "Precinct N <base columns> <count pct%>... <over> <under>", and a wide
// contest is split across pages in column blocks. Used for Washington and Curry (OCR text) and Klamath (PDF text).
//
// Config (JSON):
//   _pages:  page source — "dir/prefix-%03d.txt" (one file per page; %0Nd = zero-padded page number)
//            or a single text file split on form feeds
//   _base:   leading columns repeated on every page, e.g. ["ballots_cast","registered","total_votes"] or ["total_votes"]
//   _rename: {"label@page": "precinct"} — precinct labels misread by OCR
//   _fixes:  {contest: {"precinct@page": [full corrected row values, without percentages]}} — each checked
//            against the page image
//   <contest>: [{pages:[..], cols:["cand:Name", "writein", "overvotes", "undervotes"]}, ...]
//
// OCR repairs (each logged as DERIVED/FIXED in data/extracted/_log.txt):
//   * a count that is unreadable but has a readable percentage is solved from the percentage;
//   * if a row does not balance and exactly one count disagrees with its printed percentage, that count is
//     replaced by the only whole number consistent with the percentage — only if the row then balances;
//   * a single remaining unreadable cell is solved from the row identities.
// Every block's column sums must also equal the printed "Total" row, which catches any lost or misread row.
const fs=require('fs'), path=require('path');
module.exports=function({CFG,county,root}){
const BASE=CFG._base||['ballots_cast','registered','total_votes'];
const NB=BASE.length, TV=BASE.indexOf('total_votes'), BC=BASE.indexOf('ballots_cast');
const pageFile=path.resolve(root,CFG._pages);
const pad=pageFile.match(/%0(\d)d/);
const pageText=pg=>pad
  ? fs.readFileSync(pageFile.replace(pad[0],String(pg).padStart(+pad[1],'0')),'utf8')
  : fs.readFileSync(pageFile,'utf8').split('\f')[pg-1];
// OCR clean-up of a count: zero look-alikes, trailing punctuation; anything else is unreadable (null)
const fixTok=t=>{ if(t===undefined) return null; t=t.replace(/^[.,]+/,'').replace(/_+$/,'').replace(/^§/,'5').replace(/[.°:;,'"‘’]+$/,'');
  if(/^([)\]}|]|0[)\]}]|[oOQ]|QO|0O|OO|\(\)|[a-z¢]{1,2}[)\]])$/.test(t)) return 0;
  const c=t.replace(/[.,](?=\d{3}\b)/g,''); return /^\d+$/.test(c)?+c:null; };
const isPct=t=>/%$/.test(t);
const pctVal=t=>{ let s=t.replace(/%$/,'').replace(',','.'); if(/^\d{3,}$/.test(s)) s=s.slice(0,-2)+'.'+s.slice(-2); return /^\d+(\.\d+)?$/.test(s)?+s:null; };
const isVoteCol=c=>c.startsWith('cand:')||c==='writein';
const out=[],problems=[],fixes=CFG._fixes||{};
for(const [contest,blocks] of Object.entries(CFG)){ if(contest.startsWith('_')) continue;
  const P={};
  for(const b of blocks) for(const pg of b.pages){
    for(const line of pageText(pg).split(/\r?\n/)){
      const m=line.match(/^\s*Precinct\s+(\S+)\s+(.*)$/); if(!m||!/\d/.test(m[1])) continue;
      const rn=(CFG._rename||{})[m[1]+'@'+pg]; if(rn){ problems.push(`RENAMED ${contest} p${pg}: ${m[1]} -> ${rn}`); m[1]=rn; }
      const toks=m[2].trim().split(/\s+/).filter(t=>!/^[-=—–_|~«»]+$/.test(t));
      const fx=(fixes[contest]||{})[m[1]+'@'+pg];
      let base, cells; // cells: {col, v, pct, tok}
      if(fx){ problems.push(`FIXED ${contest} ${m[1]} p${pg}: ${toks.join(' ')} -> ${fx.join(' ')}`);
        base=fx.slice(0,NB); cells=b.cols.map((c,i)=>({col:c,v:fx[NB+i]})); }
      else {
        // walk the tokens: base values, then per column either "count pct%" (vote columns) or a single count
        let k=0; base=[]; for(let i=0;i<NB;i++){ while(k<toks.length&&isPct(toks[k])) k++; base.push(fixTok(toks[k++])); }
        cells=[]; let ok=true;
        for(const c of b.cols){
          if(isVoteCol(c)){ let tok=toks[k], v=null, pct=null;
            if(tok!==undefined&&isPct(tok)){ pct=pctVal(tok); k++; }            // count missing, only the % survived
            else { v=fixTok(tok); k++; if(toks[k]!==undefined&&isPct(toks[k])) pct=pctVal(toks[k++]); }
            cells.push({col:c,v,pct,tok}); }
          else { while(k<toks.length&&isPct(toks[k])) k++; cells.push({col:c,v:fixTok(toks[k]),tok:toks[k]}); k++; }
        }
        if(k<toks.length||cells.length!==b.cols.length) ok=false;
        if(!ok||base.includes(null)){ problems.push(`${contest} ${m[1]} p${pg}: can't read [${toks.join(' ')}]`); continue; }
      }
      const o=P[m[1]]=P[m[1]]||{base:[],cells:{},pages:{}};
      o.base.push(base.join('/')); for(const c of cells){ o.cells[c.col]=c; o.pages[c.col]=pg; }
    }
  }
  const allCols=blocks.flatMap(b=>b.cols);
  for(const [p,o] of Object.entries(P)){
    const base=o.base[0].split('/').map(Number), total=base[TV];
    if(new Set(o.base).size>1) problems.push(`${contest} ${p}: base columns differ across pages ${[...new Set(o.base)]}`);
    const miss=allCols.filter(c=>!o.cells[c]); if(miss.length){ problems.push(`${contest} ${p}: missing ${miss}`); continue; }
    const cells=allCols.map(c=>o.cells[c]);
    const fitsPct=(v,pct)=>pct!==null&&pct!==undefined&&total>0&&Math.abs(v/total*100-pct)<=0.0051;
    const fromPct=pct=>{ if(pct===null||pct===undefined||!total) return null; const e=Math.round(pct*total/100); const ks=[e-1,e,e+1].filter(k=>k>=0&&fitsPct(k,pct)); return ks.length===1?ks[0]:null; };
    // 1. unreadable vote counts with a readable percentage
    for(const c of cells) if(isVoteCol(c.col)&&c.v===null){ const k=fromPct(c.pct); if(k!==null){ problems.push(`DERIVED ${contest} ${p} p${o.pages[c.col]} ${c.col}: OCR "${c.tok}" -> ${k} (${c.pct}% of ${total})`); c.v=k; } }
    const voteSum=()=>cells.filter(c=>isVoteCol(c.col)).reduce((a,c)=>a+(c.v||0),0);
    // 2. row does not balance: fix the single count that disagrees with its percentage, if that balances it
    if(!cells.some(c=>c.v===null)&&voteSum()!==total){
      const bad=cells.filter(c=>isVoteCol(c.col)&&c.pct!==null&&c.pct!==undefined&&!fitsPct(c.v,c.pct));
      if(bad.length===1){ const k=fromPct(bad[0].pct); if(k!==null&&voteSum()-bad[0].v+k===total){ problems.push(`FIXED ${contest} ${p} p${o.pages[bad[0].col]} ${bad[0].col}: OCR ${bad[0].v} -> ${k} (${bad[0].pct}% of ${total}; row now balances)`); bad[0].v=k; } }
    }
    // 3. one unreadable cell left: solve from the identities
    const unread=cells.filter(c=>c.v===null);
    if(unread.length===1){ const c=unread[0];
      if(isVoteCol(c.col)) c.v=total-voteSum();
      else if(BC>=0) c.v=base[BC]-total-(o.cells[c.col==='overvotes'?'undervotes':'overvotes'].v||0);
      if(c.v!==null&&c.v>=0) problems.push(`DERIVED ${contest} ${p} p${o.pages[c.col]} ${c.col}: OCR "${c.tok}" -> ${c.v}`); else c.v=null; }
    if(cells.some(c=>c.v===null)){ problems.push(`${contest} ${p}: unreadable cells ${cells.filter(c=>c.v===null).map(c=>c.col+'="'+c.tok+'"')}`); continue; }
    if(voteSum()!==total) problems.push(`${contest} ${p}: candidates+writein ${voteSum()} != total ${total}`);
    const over=o.cells.overvotes?o.cells.overvotes.v:0, under=o.cells.undervotes?o.cells.undervotes.v:0;
    const ballots=BC>=0?base[BC]:total+over+under;
    if(BC>=0&&total+over+under!==ballots) problems.push(`${contest} ${p}: total+over+under ${total+over+under} != ballots ${ballots}`);
    BASE.forEach((b,i)=>out.push([county,p,contest,b,'',base[i]]));
    if(BC<0&&o.cells.overvotes) out.push([county,p,contest,'ballots_cast','',ballots]);
    for(const c of cells) out.push([county,p,contest,c.col.startsWith('cand:')?'candidate':c.col,c.col.startsWith('cand:')?c.col.slice(5):'',c.v]);
    o.final=Object.fromEntries(cells.map(c=>[c.col,c.v]));
  }
  // completeness: each block's column sums must equal the printed "Total" row (catches rows lost to OCR)
  for(const b of blocks){
    let tot=null; for(const pg of b.pages) for(const line of pageText(pg).split(/\r?\n/)){ const m=line.match(/^\s*Total\s+(\d.*)$/); if(m&&!/Ballots Cast:/.test(line)) tot=m[1].trim().split(/\s+/).filter(t=>!isPct(t)&&!/^[-=—–_|~«»]+$/.test(t)).map(fixTok); }
    if(!tot||tot.length!==NB+b.cols.length){ problems.push(`${contest} p${b.pages}: Total row not readable`); continue; }
    const sums=Array(NB+b.cols.length).fill(0);
    for(const o of Object.values(P)){ if(!o.final) continue; o.base[0].split('/').map(Number).forEach((x,i)=>sums[i]+=x); b.cols.forEach((c,i)=>sums[NB+i]+=o.final[c]); }
    const bad=sums.map((s,i)=>[s,tot[i],i]).filter(([s,t])=>t!==null&&s!==t);
    if(bad.length) problems.push(`TOTALS ${contest} p${b.pages}: column sums differ from printed Total: ${bad.map(([s,t,i])=>(i<NB?BASE[i]:b.cols[i-NB])+' '+s+' vs '+t).join('; ')}`);
  }
}
return {rows:out,problems};
};
