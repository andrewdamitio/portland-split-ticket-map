// Parse Electionware "Summary Results Report by Precinct" (Tillamook): each page is headed by the precinct name;
// contests list "PARTY Name count pct%", Write-In Totals, Total Votes Cast, Overvotes, Undervotes, Contest Totals.
const fs=require('fs');
module.exports=function({rawFile,county,countyLine}){
  const WANT=/^(united states president|state senator|state representative)/i;
  const L=fs.readFileSync(rawFile,'utf8').split(/\r?\n/).map(s=>s.trim());
  const out=[],problems=[],reg={}; let precinct=null,c=null;
  const n=s=>+s.replace(/,/g,'');
  function flush(){
    if(c&&WANT.test(c.title)){
      const sum=c.cand.reduce((a,x)=>a+x[1],0)+(c.writein||0);
      if(sum!==c.total) problems.push(`${precinct} ${c.title}: cand+writein ${sum} != total ${c.total}`);
      if(c.ballots!==undefined&&c.total+c.over+c.under!==c.ballots) problems.push(`${precinct} ${c.title}: total+over+under != contest total ${c.ballots}`);
      for(const [nm,v] of c.cand) out.push([county,precinct,c.title,'candidate',nm,v]);
      for(const [k,f] of [['writein','writein'],['total_votes','total'],['overvotes','over'],['undervotes','under'],['ballots_cast','ballots']]) if(c[f]!==undefined) out.push([county,precinct,c.title,k,'',c[f]]);
      if(reg[precinct]!==undefined) out.push([county,precinct,c.title,'registered','',reg[precinct]]);
    }
    c=null;
  }
  for(let i=0;i<L.length;i++){
    const s=L[i]; let m;
    if(s===countyLine&&L[i-1]==='OFFICIAL RESULTS'){ const p=L[i+1]; if(p!==precinct){ flush(); precinct=p; } i++; continue; }
    if(!precinct) continue;
    if((m=s.match(/^Registered Voters - Total ([\d,]+)$/))){ reg[precinct]=n(m[1]); continue; }
    if(s==='VOTE %'){ flush(); c={title:L[i-1].replace(/\s+(House|Senate) District \d+$/,'').replace(/\s+Federal$/,''),cand:[]}; continue; }
    if(!c) continue;
    if((m=s.match(/^Write-In Totals ([\d,]+) [\d.]+%$/))){ c.writein=n(m[1]); continue; }
    if((m=s.match(/^Total Votes Cast ([\d,]+)/))){ c.total=n(m[1]); continue; }
    if((m=s.match(/^Overvotes ([\d,]+)$/))){ c.over=n(m[1]); continue; }
    if((m=s.match(/^Undervotes ([\d,]+)$/))){ c.under=n(m[1]); continue; }
    if((m=s.match(/^Contest Totals ([\d,]+)$/))){ c.ballots=n(m[1]); flush(); continue; }
    if((m=s.match(/^(?:([A-Z]{3}) )?(.+?) ([\d,]+) ([\d.]+)%$/))){ c.cand.push([m[2]+(m[1]?` (${m[1]})`:''),n(m[3])]); continue; }
  }
  flush();
  return {rows:out,problems};
  };
