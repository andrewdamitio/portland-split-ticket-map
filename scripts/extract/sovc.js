// Multnomah SOVC2 statement of votes (one row per contest x choice x precinct) -> long format.
const fs=require('fs');
module.exports=function({file,county}){
  const WANT=/^(president|state senator|state representative)/i;
  const n=s=>+s.replace(/,/g,'');
  const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).slice(1);
  const g={}; // contest|precinct -> {ballots, under:Set, choices:[]}
  for(const l of lines){
    const r=l.match(/"([^"]*)"/g).map(x=>x.slice(1,-1));
    const contest=r[1].replace(/ \(VGNone\)/,''); if(!WANT.test(contest)) continue;
    const k=contest+'|'+r[5]; const o=g[k]=g[k]||{contest,precinct:r[5],ballots:n(r[6]),under:new Set(),ch:[]};
    o.under.add(n(r[9])); o.ch.push([r[4],n(r[7])]);
  }
  const out=[],problems=[];
  for(const o of Object.values(g)){
    if(o.under.size!==1) problems.push(`${o.contest} ${o.precinct}: undervote differs by choice ${[...o.under]}`);
    const under=[...o.under][0], sum=o.ch.reduce((a,c)=>a+c[1],0), over=o.ballots-sum-under;
    if(over<0) problems.push(`${o.contest} ${o.precinct}: negative overvotes ${over}`);
    for(const [c,v] of o.ch) out.push([county,o.precinct,o.contest,c==='Write-in'?'writein':'candidate',c==='Write-in'?'':c,v]);
    out.push([county,o.precinct,o.contest,'undervotes','',under],[county,o.precinct,o.contest,'overvotes','',over],[county,o.precinct,o.contest,'ballots_cast','',o.ballots]);
  }
  return {rows:out,problems};
  };
