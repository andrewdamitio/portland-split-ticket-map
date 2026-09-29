// Parse Columbia County "Precinct Abstract Report" pages: two contests side by side, every column printed
// for every precinct (zeros where the precinct is outside the district). Titles come from the layout text.
const fs=require('fs');
module.exports=function({rawFile,layoutFile,county}){
  const WANT=/(President|State Senator|State Representative)/i;
  const PARTY=/^(WTP|PRO|LBT|CON|REP|PGP|DEM|IND|NAV|WFP|PAC|NON)$/;
  const TAIL=[['Write-in'],['OVER','VOTES'],['UNDER','VOTES'],['REGISTER','VOTERS'],['TOTAL','BALLOTS','CAST'],['BALLOTS','CAST','BLANK']];
  const TAILTYPE=['writein','overvotes','undervotes','registered','ballots_cast','skip'];
  const raw=fs.readFileSync(rawFile,'utf8').split('\f'), lay=fs.readFileSync(layoutFile,'utf8').split('\f');
  const out=[],problems=[];
  raw.forEach((pg,pi)=>{
    if(!/Precinct Abstract Report/.test(pg)) return;
    const L=pg.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const h=L.indexOf('PRECINCT NAME'); if(h<0) return;
    // header tokens (a STATISTICS block may precede PRECINCT NAME)
    const tok=[]; const pre=L.slice(L.indexOf('December 2, 2024')+1,h).join(' ').split(/\s+/).filter(t=>t&&t!=='STATISTICS');
    tok.push(...pre); let j=h+1; for(;j<L.length&&!/\d$/.test(L[j]);j++) tok.push(...L[j].split(/\s+/));
    const groups=[]; let cur={cols:[],cand:[]};
    for(let k=0;k<tok.length;){
      const t=TAIL.findIndex(seq=>seq.every((w,o)=>tok[k+o]===w));
      if(t>=0){ cur.cols.push(TAILTYPE[t]); k+=TAIL[t].length; continue; }
      if(cur.cols.some(c=>c!=='cand')){ groups.push(cur); cur={cols:[],cand:[]}; }
      if(PARTY.test(tok[k])){ cur.cols.push('cand'); cur.cand.push({party:tok[k++],name:''}); continue; }
      if(!cur.cand.length){ cur.cols.push('cand'); cur.cand.push({party:'',name:''}); }
      cur.cand[cur.cand.length-1].name=(cur.cand[cur.cand.length-1].name+' '+tok[k++]).trim();
    }
    if(cur.cols.length) groups.push(cur);
    // stats-only group (registered/ballots) belongs with the contest that follows it
    for(let g=0;g<groups.length-1;g++) if(!groups[g].cand.length){ groups[g+1].cols.unshift(...groups[g].cols); groups.splice(g,1); g--; }
    // titles from layout: text segments above the header, clustered by x position
    const LL=lay[pi].split(/\r?\n/); const segs=[];
    for(const line of LL){ if(/PRECINCT NAME/.test(line)) break;
      for(const m of line.matchAll(/\S+(?: \S+)*/g)){ const s=m[0]; if(/^(WTP|PRO|LBT|CON|REP|PGP|DEM|IND|NAV) |Write-in|OVER VOTES|UNDER VOTES|^UNDE|^OVER|STATISTICS|REGISTER|BALLOTS|VOTERS|^CAST|BLANK|November 5|Columbia County|Precinct Abstract|December 2|Certified Final Results/.test(s)) continue; segs.push({x:m.index,s}); } }
    const cl=[]; for(const s of segs){ const c=cl.find(c=>Math.abs(c.x-s.x)<25); if(c) c.s.push(s.s); else cl.push({x:s.x,s:[s.s]}); }
    cl.sort((a,b)=>a.x-b.x); const titles=cl.map(c=>c.s.join(' '));
    if(titles.length!==groups.length){ if(titles.some(t=>WANT.test(t))) problems.push(`p${pi+1}: ${titles.length} titles ${JSON.stringify(titles)} vs ${groups.length} groups`); return; }
    groups.forEach((g,i)=>g.title=titles[i]);
    if(!groups.some(g=>WANT.test(g.title))) return;
    const total=groups.reduce((a,g)=>a+g.cols.length,0);
    for(const line of L.slice(j)){
      const m=line.match(/^(.*?\D)\s+((?:\d+\s+)*\d+)$/); if(!m||/^COUNTY TOTALS|^Page|District$/.test(m[1])) continue;
      const v=m[2].split(/\s+/).map(Number);
      if(v.length!==total){ problems.push(`p${pi+1} ${m[1]}: ${v.length} values vs ${total}`); continue; }
      let o=0;
      for(const g of groups){ const vv=v.slice(o,o+g.cols.length); o+=g.cols.length;
        if(!WANT.test(g.title)) continue;
        const contest=g.title.replace(/^(State Representative|State Senator) (House|Senate) District (\d+)$/,(x,a,b,d)=>`${a}, ${d}${["th","st","nd","rd"][(d%100>10&&d%100<14)?0:(d%10<4?d%10:0)]} District`).replace(/ FEDERAL$/,'');
        const voteCols=g.cols.map((c,i)=>i).filter(i=>g.cols[i]!=='registered'&&g.cols[i]!=='ballots_cast'&&g.cols[i]!=='skip');
        if(voteCols.every(i=>vv[i]===0)) continue; // precinct not in this district
        let ci=0,sum=0,rec={};
        g.cols.forEach((c,i)=>{ if(c==='cand'){ const cd=g.cand[ci++]; out.push([county,m[1],contest,'candidate',`${cd.name}${cd.party?' ('+cd.party+')':''}`,vv[i]]); sum+=vv[i]; } else if(c!=='skip'){ rec[c]=vv[i]; out.push([county,m[1],contest,c,'',vv[i]]); } });
        sum+=rec.writein||0; out.push([county,m[1],contest,'total_votes','',sum]);
        if(rec.ballots_cast!==undefined && sum+rec.overvotes+rec.undervotes!==rec.ballots_cast) problems.push(`p${pi+1} ${m[1]} ${contest}: votes+over+under ${sum+rec.overvotes+rec.undervotes} != ballots ${rec.ballots_cast}`);
      }
    }
  });
  return {rows:out,problems};
  };
