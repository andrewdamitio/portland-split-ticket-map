// Parse "Custom/Countywide Table Report" canvass PDFs (Clatsop, Umatilla, Union, ...).
// Uses raw text (-raw) for contest titles/column headers and layout text (-layout) for row values + x positions,
// so pages with two contests side by side can be split. Output: long-format rows.
const fs=require('fs');
module.exports=function({rawFile,layoutFile,county}){
  const WANT=/^(united states president|state senator|state representative)/i;
  const STARTERS=/(United States President|US Representative|Secretary of State|State Treasurer|Attorney General|State Senator|State Representative|Commissioner of|Judge of|Justice of|District Attorney|State Measure|County |City of|Mayor|Councilor|Council |Director|Sheriff|Clerk|Treasurer|Assessor|Surveyor|Soil and Water|Port of|Measure |[A-Z][a-z]+ County)/g;
  const PARTY=/^(WTP|PRO|LBT|CON|REP|PGP|DEM|IND|NAV|WFP|PAC|NON|DEM,?|REP,?)$/;
  const TAIL=[['Write-in','Totals'],['Write-in:','Not','Assigned'],['Total','Votes','Cast'],['Overvotes'],['Undervotes'],['Contest','Total']];
  const TAILTYPE=['writein','writein_unassigned','total_votes','overvotes','undervotes','ballots_cast'];
  const rawPages=fs.readFileSync(rawFile,'utf8').split('\f'), layPages=fs.readFileSync(layoutFile,'utf8').split('\f');
  const out=[],problems=[];
  const num=s=>+s.replace(/,/g,'');
  rawPages.forEach((pg,pi)=>{
    const L=pg.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const vi=L.findIndex(l=>/^VOTE FOR \d/i.test(l)); if(vi<1) return;
    const nContests=(L[vi].match(/VOTE FOR \d/gi)||[]).length;
    // titles: split the (merged) title line on known contest-title starters
    // title may wrap: take every line between the report header block and VOTE FOR
    let ti=vi-1; while(ti>0 && !/(Canvass Report|Canvass by Precinct|OFFICIAL RESULTS|Table Report|ABSTRACT REPORT|^Precinct Report)/i.test(L[ti-1])) ti--;
    let titleLine=L.slice(ti,vi).join(" "); const starts=[...titleLine.matchAll(STARTERS)].map(m=>m.index).filter((x,i,a)=>i===0||x>a[i-1]);
    let titles=[]; for(let i=0;i<starts.length;i++) titles.push(titleLine.slice(starts[i],starts[i+1]).trim());
    // merge fragments like "State Senator, 29th District Senate District 29" (second label repeats the district)
    titles=titles.filter((t,i)=>!(i>0&&/^(Senate|House) District \d+$/.test(t))).map(t=>t.replace(/\s+(Senate|House) District \d+$/,'').replace(/\s+(US Representative \d+\w* District|Federal|Statewide.*)$/,''));
    if(titles.length!==nContests){ if(titles.some(t=>WANT.test(t))) problems.push(`p${pi+1}: ${titles.length} titles vs ${nContests} contests: ${titleLine}`); return; }
    if(!titles.some(t=>WANT.test(t))) return;
    // headers: tokens after "Precincts Reporting" line(s) until the first data row
    let hi=vi+1; while(hi<L.length && /Precincts Reporting|^VOTE FOR/i.test(L[hi])) hi++;
    const tok=[]; for(let j=hi;j<L.length;j++){ if(/\d[\d,]*$/.test(L[j]) && /\s\d/.test(L[j])) break; tok.push(...L[j].split(/\s+/)); }
    const contests=[]; let cur={cols:[],cand:[]};
    for(let k=0;k<tok.length;){
      let t=TAIL.findIndex(seq=>seq.every((w,o)=>tok[k+o]===w));
      if(t>=0){ cur.cols.push(TAILTYPE[t]); k+=TAIL[t].length; continue; }
      if(cur.cols.some(c=>c!=='cand')){ contests.push(cur); cur={cols:[],cand:[]}; }
      if(PARTY.test(tok[k])){ let party=[]; while(k<tok.length&&PARTY.test(tok[k])) party.push(tok[k++].replace(/,$/,'')); cur.cols.push('cand'); cur.cand.push({party:party.join('/'),name:''}); continue; }
      if(!cur.cand.length){ cur.cols.push('cand'); cur.cand.push({party:'',name:''}); }
      const c=cur.cand[cur.cand.length-1]; c.name=(c.name+' '+tok[k]).trim(); k++;
    }
    if(cur.cols.length) contests.push(cur);
    if(contests.length!==nContests){ problems.push(`p${pi+1}: parsed ${contests.length} header groups vs ${nContests} contests`); return; }
    contests.forEach((c,i)=>{ c.title=titles[i]; c.n=c.cols.length; });
    // rows from layout text: label then numbers; keep x position of each number
    const lay=layPages[pi].split(/\r?\n/);
    // x split between contests: from rows that contain every contest, the start of contest i's first number
    const rows=[];
    for(const line of lay){
      const m=line.match(/^\s*(\S.*?\S)((?:\s+-?[\d,]+)+)\s*$/); if(!m) continue;
      const label=m[1].trim(); if(/^(Total|Page|Custom|Countywide|November|December)/i.test(label)||!/^\S*\d/.test(label)&&!/^[A-Z]/.test(label)) continue;
      const nums=[...m[2].matchAll(/-?[\d,]+/g)].map(x=>({v:num(x[0]),x:m.index+m[1].length+x.index+ (line.length-line.trimStart().length)*0}));
      const off=line.indexOf(m[2]); nums.forEach((n,i)=>{ n.x=off+[...m[2].matchAll(/-?[\d,]+/g)][i].index; });
      rows.push({label,nums});
    }
    const total=contests.reduce((a,c)=>a+c.n,0);
    const bounds=[]; // x where contest i (i>=1) begins
    for(let i=1;i<contests.length;i++){ const xs=rows.filter(r=>r.nums.length===total).map(r=>r.nums[contests.slice(0,i).reduce((a,c)=>a+c.n,0)].x); bounds.push(xs.length?Math.min(...xs)-2:null); }
    for(const r of rows){
      let assign=[];
      if(r.nums.length===total){ let o=0; for(const c of contests){ assign.push([c,r.nums.slice(o,o+c.n).map(x=>x.v)]); o+=c.n; } }
      else {
        // find contiguous subsets of contests whose column counts sum to the row length, using x positions
        const idx=contests.map((c,i)=>i).filter(i=>{ const lo=i===0?-1:bounds[i-1], hi=i<bounds.length?bounds[i]:1e9; return lo!==null&&hi!==null&&r.nums.some(n=>n.x>=lo&&n.x<hi); });
        const n=idx.reduce((a,i)=>a+contests[i].n,0);
        if(n!==r.nums.length){ if(r.nums.length>1) problems.push(`p${pi+1} ${r.label}: ${r.nums.length} values don't fit contests ${idx}`); continue; }
        let o=0; for(const i of idx){ assign.push([contests[i],r.nums.slice(o,o+contests[i].n).map(x=>x.v)]); o+=contests[i].n; }
      }
      for(const [c,v] of assign){
        if(!WANT.test(c.title)) continue;
        let ci=0, cand=0, rec={};
        c.cols.forEach((t,j)=>{ if(t==='cand'){ const cd=c.cand[ci++]; out.push([county,r.label,c.title,'candidate',(cd.name+(cd.party?' ('+cd.party+')':'')),v[j]]); cand+=v[j]; } else { rec[t]=v[j]; } });
        const wi=(rec.writein||0);
        if(rec.ballots_cast!==undefined && rec.total_votes+(rec.overvotes||0)+(rec.undervotes||0)!==rec.ballots_cast) problems.push(`p${pi+1} ${r.label} ${c.title}: total+over+under != contest total ${rec.ballots_cast}`); // "Write-in: Not Assigned" is a subset of Write-in Totals in these reports
        if(rec.total_votes!==undefined && cand+wi!==rec.total_votes) problems.push(`p${pi+1} ${r.label} ${c.title}: cand+writein ${cand+wi} != total ${rec.total_votes}`);
        for(const t of ['writein','total_votes','overvotes','undervotes','ballots_cast']) if(rec[t]!==undefined) out.push([county,r.label,c.title,t,'',rec[t]]);
      }
    }
  });
  return {rows:out,problems};
  };
