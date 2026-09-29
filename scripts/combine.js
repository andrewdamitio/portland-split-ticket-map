#!/usr/bin/env node
// Step 2: combine data/extracted/<county>.csv into one statewide file with map precinct ids, canonical
// candidate names and parties.
//
//   node scripts/combine.js
//
// Output: data/full_vote_counts_2024.csv, one row per precinct x contest x item:
//   county, precinct (map id), precinct_label (as printed in the county report), office, district,
//   type (candidate | writein | total_votes | overvotes | undervotes | ballots_cast | registered),
//   candidate, party, votes
// Lane County suppresses counts under 10 in its report; those cells are "<10" (the county's own notation).
const fs = require('fs'), path = require('path');
const csv = require('./lib/csv');
const cand = require('./lib/candidates');
const { loader } = require('./lib/precincts');

const ROOT = path.resolve(__dirname, '..');
const MAP_PRECINCTS = path.join(ROOT, 'data/map_precincts.csv');
const resolve = loader(MAP_PRECINCTS, path.join(ROOT, 'data/config/precinct_aliases.json'));
const problems = [];

const groups = new Map(); // county|precinct|office|district -> {label, rows:[]}
for (const f of fs.readdirSync(path.join(ROOT, 'data/extracted')).filter(f => f.endsWith('.csv')).sort()) {
  for (const r of csv.read(path.join(ROOT, 'data/extracted', f))) {
    const ct = cand.contestOf(r.contest);
    if (!ct) { problems.push(`${r.county}: contest not recognised: ${r.contest}`); continue; }
    const id = resolve(r.county, r.precinct_label);
    if (id === null) { problems.push(`${r.county}: precinct "${r.precinct_label}" is not on the map`); continue; }
    let c = null;
    if (r.type === 'candidate') {
      c = cand.identify(ct.office, ct.district, r.choice);
      if (!c) { problems.push(`${r.county} ${r.precinct_label}: "${r.choice}" is not a known ${ct.office} ${ct.district} candidate`); continue; }
    }
    const k = [r.county, id, ct.office, ct.district].join('|');
    if (!groups.has(k)) groups.set(k, { labels: new Set(), rows: new Map() });
    const g = groups.get(k); g.labels.add(r.precinct_label);
    const rk = r.type + '|' + (c ? c.candidate : '');
    const v = r.votes === '<10' ? '<10' : +r.votes;
    if (g.rows.has(rk) && g.rows.get(rk).v !== v) problems.push(`${k}: two different values for ${rk} (${g.rows.get(rk).v}, ${v})`);
    g.rows.set(rk, { type: r.type, c, v });
  }
}

const TYPES = ['candidate', 'writein', 'total_votes', 'overvotes', 'undervotes', 'ballots_cast', 'registered'];
const out = [];
for (const [k, g] of groups) {
  const [county, id, office, district] = k.split('|');
  if (g.labels.size > 1) problems.push(`${county} ${id}: several report precincts map to one map precinct: ${[...g.labels].join(', ')}`);
  const rows = [...g.rows.values()];
  const num = t => { const r = rows.find(x => x.type === t); return r && typeof r.v === 'number' ? r.v : undefined; };
  const votes = rows.filter(r => r.type === 'candidate' || r.type === 'writein').map(r => r.v);
  // fill the totals a report may not print, from the identities every report satisfies
  if (num('total_votes') === undefined && !votes.includes('<10')) rows.push({ type: 'total_votes', v: votes.reduce((a, b) => a + b, 0) });
  if (num('ballots_cast') === undefined && num('overvotes') !== undefined && num('undervotes') !== undefined)
    rows.push({ type: 'ballots_cast', v: num('total_votes') + num('overvotes') + num('undervotes') });
  rows.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || (a.c && b.c ? cand.TABLE.indexOf(a.c) - cand.TABLE.indexOf(b.c) : 0));
  for (const r of rows) out.push([county, id, [...g.labels][0], office, district, r.type, r.c ? r.c.candidate : '', r.c ? r.c.party : '', r.v]);
}
out.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1], undefined, { numeric: true }) || ['President', 'State Senate', 'State House'].indexOf(a[3]) - ['President', 'State Senate', 'State House'].indexOf(b[3]));

// completeness: every precinct on the map must have a presidential result (unless it had no voters)
const have = new Set(out.filter(r => r[3] === 'President').map(r => r[0] + '|' + r[1]));
for (const p of csv.read(MAP_PRECINCTS)) if (!have.has(p.county + '|' + p.precinct)) problems.push(`${p.county} ${p.precinct}: map precinct has no presidential result in the county report`);

csv.write(path.join(ROOT, 'data/full_vote_counts_2024.csv'), ['county', 'precinct', 'precinct_label', 'office', 'district', 'type', 'candidate', 'party', 'votes'], out);
fs.writeFileSync(path.join(ROOT, 'data/full_vote_counts_2024.log'), problems.join('\n') + '\n');
console.log(`${out.length} rows, ${new Set(out.map(r => r[0] + '|' + r[1])).size} precincts, ${new Set(out.map(r => r[0])).size} counties -> data/full_vote_counts_2024.csv`);
console.log(problems.length ? `${problems.length} notes (data/full_vote_counts_2024.log):\n  ` + problems.slice(0, 40).join('\n  ') : 'no problems');
