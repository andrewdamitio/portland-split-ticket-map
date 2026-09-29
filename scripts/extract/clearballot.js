// Parse a Clear Ballot XML export (Deschutes County): per-precinct counts are split across vote groups
// (election day / early / absentee) and summed here.
const fs=require('fs');
module.exports=function({xmlFile,county}){
  const X=fs.readFileSync(xmlFile,'utf8');
  const WANT=/^(united states president|state senator|state representative)/i;
  const attr=(tag,a)=>{ const i=tag.indexOf(' '+a+'="'); if(i<0) return undefined; const s=i+a.length+3; return tag.slice(s,tag.indexOf('"',s)); };
  const dec=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  const pname={}, preg={};
  for(const m of X.matchAll(/<Precinct [^>]*>/g)){ pname[attr(m[0],'id')]=attr(m[0],'name'); preg[attr(m[0],'id')]=+attr(m[0],'regVoters'); }
  const parties={}; for(const m of X.matchAll(/<Party [^>]*>/g)) parties[attr(m[0],'id')]=dec(attr(m[0],'abbrv')).replace(/,$/,'');
  const out=[],problems=[];
  for(const cm of X.matchAll(/<Contest [^>]*>[\s\S]*?<\/Contest>/g)){
    const head=cm[0].match(/<Contest [^>]*>/)[0], title=dec(attr(head,'title'));
    if(!WANT.test(title)) continue;
    const agg={}; // precinctId -> {ballots, over, under, total, writein}
    for(const g of cm[0].matchAll(/<ContestGroupVotes [^>]*>/g)){ const p=attr(g[0],'refPrecinctId'); const a=agg[p]=agg[p]||{ballots:0,over:0,under:0,total:0,writein:0};
      a.ballots+=+attr(g[0],'ballotsCast'); a.over+=+attr(g[0],'overVotes'); a.under+=+attr(g[0],'underVotes'); a.total+=+attr(g[0],'totalVotes'); a.writein+=+attr(g[0],'writeinVotes'); }
    const cands=[];
    for(const c of cm[0].matchAll(/<Candidate [^>]*>[\s\S]*?<\/Candidate>/g)){
      const ch=c[0].match(/<Candidate [^>]*>/)[0]; const party=parties[attr(ch,'partyId')];
      const v={}; for(const x of c[0].matchAll(/<Votes groupId="\d+" refPrecinctId="(\d+)">(\d+)<\/Votes>/g)) v[x[1]]=(v[x[1]]||0)+ +x[2];
      const sum=Object.values(v).reduce((a,b)=>a+b,0); if(sum!==+attr(ch,'votes')) problems.push(`${title} ${attr(ch,'name')}: precinct sum ${sum} != total ${attr(ch,'votes')}`);
      cands.push({name:dec(attr(ch,'name')),party:party&&party!=='NON'&&party!=='<UN>'?party:'',v});
    }
    // fusion candidates appear once per party line; merge them by name. "Write-in" is reported as a candidate
    // and also in the contest's writeinVotes, so it is dropped here to avoid counting it twice.
    const merged=[];
    for(const c of cands){ if(/^Write-?in$/i.test(c.name)) continue;
      let m=merged.find(x=>x.name===c.name); if(!m){ m={name:c.name,parties:[],v:{}}; merged.push(m); }
      if(c.party&&!m.parties.includes(c.party)) m.parties.push(c.party);
      for(const [p,x] of Object.entries(c.v)) m.v[p]=(m.v[p]||0)+x; }
    merged.forEach(m=>m.name+=m.parties.length?` (${m.parties.join('/')})`:'');
    cands.length=0; cands.push(...merged);
    for(const [p,a] of Object.entries(agg)){
      if(a.ballots===0) continue; // precinct not in this district
      const cs=cands.reduce((s,c)=>s+(c.v[p]||0),0);
      if(cs+a.writein!==a.total) problems.push(`${title} ${pname[p]}: cand+writein ${cs+a.writein} != total ${a.total}`);
      if(a.total+a.over+a.under!==a.ballots) problems.push(`${title} ${pname[p]}: total+over+under != ballots ${a.ballots}`);
      for(const c of cands) out.push([county,pname[p],title,'candidate',c.name,c.v[p]||0]);
      out.push([county,pname[p],title,'writein','',a.writein],[county,pname[p],title,'total_votes','',a.total],[county,pname[p],title,'overvotes','',a.over],[county,pname[p],title,'undervotes','',a.under],[county,pname[p],title,'ballots_cast','',a.ballots],[county,pname[p],title,'registered','',preg[p]]);
    }
  }
  return {rows:out,problems};
  };
