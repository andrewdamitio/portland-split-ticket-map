// Parse Lane County "Statement of Votes Cast" (pdftotext -raw). "(< 10)" suppressed cells are kept as the string "<10".
const fs=require('fs');
module.exports=function({file,county}){
  const WANT=/^(united states president|state senator|state representative)/i;
  const out=[], problems=[], hdrs={};
  // header words are one-per-line, so multi-word names that do not split evenly are given explicitly
  const OVERRIDE={
    "United States President and Vice President (Vote for 1)":["Robert F Kennedy Jr / Nicole Shanahan","Cornel West","Chase Oliver / Mike ter Maat","Randall Terry","Donald J Trump / JD Vance","Jill Stein / Rudolph Ware","Kamala D Harris / Tim Walz"],
    "State Representative, 9th District (Vote for 1)":["Boomer Wright","William (Mrk) Mrkvicka"],
    "State Representative, 13th District (Vote for 1)":["Nancy Nathanson","Timothy S Sutherland"]};
  for(const pg of fs.readFileSync(file,'utf8').split('\f')){
    const P=pg.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const ti=P.findIndex(s=>/\(Vote for \d+\)$/.test(s)); if(ti<0) continue;
    const contest=P[ti]; if(!WANT.test(contest)) continue;
    const pi=P.indexOf('Precinct Total',ti); if(pi<0) continue;
    let j=pi+1; const tok=[];
    while(j<P.length && !/^Precinct \S+ /.test(P[j])){ tok.push(P[j]); j++; }
    // header tokens: "Votes", candidate words..., optional "Write-in", "Over"/"Write-in Over", "Votes", "Under", "Votes"
    let h=tok.join(' ').replace(/^Votes\s*/,'');
    const tail=[]; 
    if(/Under Votes$/.test(h)){ h=h.replace(/\s*Over Votes Under Votes$/,'').replace(/\s*Write-in Over Votes Under Votes$/,' Write-in'); tail.push('overvotes','undervotes'); }
    let wi=false; if(/(^|\s)Write-in$/.test(h)){ wi=true; h=h.replace(/\s*Write-in$/,''); }
    const words=h?h.split(' '):[];
    const rows=P.slice(j).filter(s=>/^Precinct \S+ /.test(s));
    for(const r of rows){
      const m=r.match(/^Precinct (\S+) (.*)$/); const vals=m[2].replace(/\(< 10\)/g,'<10').split(' ').map(v=>v==='<10'?v:+v);
      const K=vals.length-1-(wi?1:0)-tail.length;
      const key=contest+'|'+K;
      if(!hdrs[key]){ // split words into K names
        let names;
        if(K===0) names=[];
        else if(OVERRIDE[contest]) names=OVERRIDE[contest];
        else if(words.join(' ').includes('/')){ names=words.join(' ').split(/(?<=\/ \S+(?: \S+)?) (?=[A-Z])/); }
        else if(words.length%K===0){ const n=words.length/K; names=[...Array(K)].map((_,i)=>words.slice(i*n,i*n+n).join(' ')); }
        if(!names||names.length!==K){ problems.push(`${contest}: can't split ${JSON.stringify(words)} into ${K}`); names=[...Array(K)].map((_,i)=>'cand'+(i+1)); }
        hdrs[key]=names;
      }
      const cols=[{type:'total_votes'},...hdrs[key].map(n=>({type:'candidate',name:n})),...(wi?[{type:'writein'}]:[]),...tail.map(t=>({type:t}))];
      cols.forEach((c,i)=>out.push([county,m[1],contest,c.type,c.name||'',vals[i]]));
      const nums=vals.slice(1,1+K+(wi?1:0));
      if(K>0 && !nums.includes('<10')){ const s=nums.reduce((a,b)=>a+b,0); if(s!==vals[0]) problems.push(`${contest} ${m[1]}: sum ${s} != total ${vals[0]}`); }
    }
  }
  return {rows:out,problems};
  };
