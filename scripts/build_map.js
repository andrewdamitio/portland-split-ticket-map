#!/usr/bin/env node
// Step 3: compute the map's precinct and district figures from data/full_vote_counts_2024.csv and write them
// into index.html (the precinct/district properties and the ranking tables) and data/split_ticket_data.csv.
//
//   node scripts/build_map.js
//
// Rules (applied the same way to every precinct and district):
//   * "Two-party" means Democrat vs. Republican only. A candidate's party is their own party from
//     data/config/candidates.csv (a Republican cross-nominated by Democrats counts as the Republican).
//     Third-party candidates and write-ins are reported separately as "other".
//   * A House/Senate race is compared with President only if it had both a Democrat and a Republican.
//   * A precinct gets a comparison (colour on the "vs. President" views) only if the race and the
//     presidential vote each have at least MIN_TWO_PARTY two-party votes; otherwise it is grey with a note.
//   * District figures are vote-weighted over all of the district's precincts.
//   * Lane County reports small counts as "<10": such a Dem/Rep count leaves that precinct without a
//     comparison; in "other" totals it is counted as 0 and the total is marked as a minimum (e.g. "7+").
const fs = require('fs'), path = require('path');
const csv = require('./lib/csv');
const cand = require('./lib/candidates');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const MIN_TWO_PARTY = 50;
const r2 = x => Math.round(x * 100) / 100, r1 = x => Math.round(x * 10) / 10;
// short display name: candidates.csv short_name (compound surnames), else the last word of the name
const last = c => c.short_name || c.candidate.split(' / ')[0].replace(/\s*\(.*?\)\s*/g, ' ').trim().split(' ').pop();

// "Todd Nash (Republican, also the Democratic nominee)" for notes about races without a D-vs-R contest
const PARTY = { DEM: 'Democrat', REP: 'Republican', LIB: 'Libertarian', PGP: 'Pacific Green', IND: 'Independent Party', NAV: 'nonaffiliated',
  CON: 'Constitution', WTP: 'We the People', PRO: 'Progressive', WFP: 'Working Families' };
const NOMINEE = { DEM: 'Democratic', REP: 'Republican', IND: 'Independent Party', WFP: 'Working Families' };
const describe = c => `${c.candidate} (${PARTY[c.party] || c.party}${c.also_nominated_by ? ', also the ' + c.also_nominated_by.split('/').map(p => NOMINEE[p] || p).join(' and ') + ' nominee' : ''})`;

// ---- load counts: county|precinct -> office|district -> {cands:[{c,v}], writein, ...}
const races = {};
for (const r of csv.read(path.join(ROOT, 'data/full_vote_counts_2024.csv'))) {
  const pk = r.county + '|' + r.precinct, rk = r.office + '|' + r.district;
  const race = ((races[pk] = races[pk] || {})[rk] = races[pk][rk] || { cands: [] });
  const v = r.votes === '<10' ? null : +r.votes;
  if (r.type === 'candidate') race.cands.push({ c: cand.TABLE.find(c => c.office === r.office && c.candidate === r.candidate && (r.office === 'President' || c.district === r.district)), v });
  else race[r.type] = v;
}

// Split a race into Democrat / Republican / other. Returns null if there is no such race.
function split(race) {
  if (!race) return null;
  const d = race.cands.find(x => x.c.party === 'DEM'), r = race.cands.find(x => x.c.party === 'REP');
  const others = race.cands.filter(x => x !== d && x !== r);
  let other = 0, otherMin = false;
  for (const x of [...others, { v: race.writein === undefined ? 0 : race.writein }]) { if (x.v === null) otherMin = true; else other += x.v; }
  return {
    dem: d ? d.v : undefined, rep: r ? r.v : undefined, demName: d ? last(d.c) : null, repName: r ? last(r.c) : null,
    other, otherMin, othersList: others.map(x => `${last(x.c)} (${x.c.party})`),
    demC: d && d.c, repC: r && r.c, otherCs: others.map(x => x.c),
  };
}

// ---- read index.html data lines
const lines = fs.readFileSync(HTML, 'utf8').split('\n');
const lineOf = name => lines.findIndex(l => l.startsWith(`const ${name} = `));
const load = name => JSON.parse(lines[lineOf(name)].replace(/^const \w+ = /, '').replace(/;\s*$/, ''));
const save = (name, value) => { lines[lineOf(name)] = `const ${name} = ${JSON.stringify(value)};`; };
const PRECINCTS = load('PRECINCTS'), DISTRICTS = load('DISTRICTS'), SENATE_DISTRICTS = load('SENATE_DISTRICTS');

// ---- precinct properties
const out = [], reassigned = [];
const dist = { hd: {}, sd: {} }; // district aggregates
// add one precinct's race to its district totals (only D-vs-R races with readable counts); the presidential vote
// is added only for the precinct's main district, so a split precinct's President vote is counted once
function addToDistrict(kind, id, s, county, P) {
  if (!s || typeof s.dem !== 'number' || typeof s.rep !== 'number') return;
  const a = (dist[kind][id] = dist[kind][id] || { d: 0, r: 0, h: 0, t: 0, counties: new Set(), dem: s.demName, rep: s.repName });
  a.d += s.dem; a.r += s.rep; a.counties.add(county);
  if (P) { a.h += P.pres_harris; a.t += P.pres_trump; }
}
for (const f of PRECINCTS.features) {
  const q = f.properties, pk = q.county + '|' + q.precinct, R = races[pk] || {};
  const P = { precinct: q.precinct, county: q.county, hd: q.hd, sd: q.sd || null };
  const pres = split(R['President|']);
  if (pres && pres.dem !== undefined && pres.rep !== undefined && pres.dem + pres.rep > 0) {
    Object.assign(P, { pres_harris: pres.dem, pres_trump: pres.rep, pres_other: pres.other, pres_other_min: pres.otherMin || undefined,
      pres_dem2p: r2(pres.dem / (pres.dem + pres.rep) * 100), pres_margin: r2((pres.dem - pres.rep) / (pres.dem + pres.rep) * 100) });
  } else P.note = 'no presidential votes in this precinct';
  const pn = P.pres_harris + P.pres_trump;

  for (const [kind, office, pre] of [['hd', 'State House', 'house'], ['sd', 'State Senate', 'sen']]) {
    const lab = kind === 'hd' ? 'HD' : 'SD', noteKey = kind === 'hd' ? 'note' : 'sen_note', X = k => pre + '_' + k;
    const nameKey = kind === 'hd' ? 'dem_name' : 'sen_dem_name', repKey = kind === 'hd' ? 'rep_name' : 'sen_rep_name';
    // the district comes from the official results (the map's own assignment is a fallback); a precinct split
    // between districts is shown with its larger part, and every part is counted in its district's totals
    const here = Object.keys(R).filter(k => k.startsWith(office + '|')).map(k => k.split('|')[1])
      .sort((a, b) => (R[office + '|' + b].ballots_cast || R[office + '|' + b].total_votes || 0) - (R[office + '|' + a].ballots_cast || R[office + '|' + a].total_votes || 0));
    for (const other of here.slice(1)) addToDistrict(kind, other, split(R[office + '|' + other]), q.county, null);
    const id = here[0] || q[kind] || null;
    if (here[0] && q[kind] && here[0] !== q[kind]) reassigned.push(`${q.county} ${q.precinct}: map ${lab} ${q[kind]} -> results ${lab} ${here[0]}`);
    P[kind] = id;
    if (here.length > 1) P[kind + '_split'] = here.join('/');
    const s = split(here[0] ? R[office + '|' + here[0]] : null);
    if (kind === 'sd') P.sen_up = !!s;
    if (!s) {
      if (kind === 'hd' && pn > 0) P[noteKey] = P[noteKey] || `No State House contest was reported for this precinct.`;
      // Senate seats are staggered: SD n is made up of HD 2n-1 and 2n, so the seat follows from the House district
      if (kind === 'sd' && P.hd) { P.sd = String(Math.ceil(+P.hd / 2)); P.sen_note = `SD ${P.sd} was not on the ballot in 2024. Oregon senators serve four-year terms; this seat is next up in 2026.`; }
      continue;
    }
    P[nameKey] = s.demName; P[repKey] = s.repName;
    P[X('dem')] = s.dem ?? null; P[X('rep')] = s.rep ?? null; P[X('other')] = s.other; if (s.otherMin) P[X('other_min')] = true;
    if (s.othersList.length) P[X('others')] = s.othersList.join(', ');
    const d = s.dem, r = s.rep;
    let why = null;
    const seat = `${lab} ${id}`, others = s.otherCs.map(describe).join(' and '), noPair = ' There was no Democrat-vs-Republican race, so it is left out of the two-party figures.';
    if (d === undefined && r === undefined) why = `${seat} had no Democratic or Republican candidate${others ? ': ' + others : ''}.` + noPair;
    else if (d === undefined) why = (others ? `${seat} had no Democratic candidate: ${describe(s.repC)} vs. ${others}.` : `${describe(s.repC)} ran unopposed in ${seat}.`) + noPair;
    else if (r === undefined) why = (others ? `${seat} had no Republican candidate: ${describe(s.demC)} vs. ${others}.` : `${describe(s.demC)} ran unopposed in ${seat}.`) + noPair;
    else if (d === null || r === null) why = `${seat}: the county reported the Democratic or Republican count here only as "under 10", so it cannot be compared.`;
    if (why) { P[noteKey] = why; continue; }
    // contested D vs R race
    const n = d + r;
    P[X('dem2p')] = n ? r2(d / n * 100) : null; P[X('margin')] = n ? r2((d - r) / n * 100) : null;
    if (pn > 0) P[X('undervote')] = r1((pn - n) / pn * 100);
    addToDistrict(kind, id, s, q.county, pn > 0 ? P : null);
    if (n < MIN_TWO_PARTY || !(pn >= MIN_TWO_PARTY)) { P[noteKey] = `too few votes to compare (${lab} two-party n=${n}, President n=${pn || 0}; minimum ${MIN_TWO_PARTY})`; continue; }
    P[kind === 'hd' ? 'delta' : 'sen_delta'] = r2(P[X('dem2p')] - P.pres_dem2p);
  }
  P.has_metric = P.delta !== undefined;
  f.properties = Object.fromEntries(Object.entries(P).filter(([, v]) => v !== undefined));
  out.push(f.properties);
}
save('PRECINCTS', PRECINCTS);

// ---- district rankings
const countiesLabel = set => { const c = [...set].sort(); return c.length > 2 ? c.map(x => x.slice(0, 4)).join('+') : c.join(', '); };
const ranking = kind => Object.entries(dist[kind]).map(([id, a]) => {
  const own = r1(a.d / (a.d + a.r) * 100), pres = r1(a.h / (a.h + a.t) * 100);
  return { [kind]: id, dem: a.dem, rep: a.rep, [kind === 'hd' ? 'house2p' : 'sen2p']: own, pres2p: pres, delta: r1(own - pres), counties: countiesLabel(a.counties), multi: a.counties.size > 1 };
}).sort((x, y) => y.delta - x.delta);
const RANKING = ranking('hd'), SENATE_RANKING = ranking('sd');
save('RANKING', RANKING); save('SENATE_RANKING', SENATE_RANKING);
save('SEN_REP_NAMES', Object.fromEntries(SENATE_RANKING.map(r => [r.sd, r.rep])));
// district outline labels carry the Democrat's name
const hdDem = Object.fromEntries(RANKING.map(r => [r.hd, r.dem]));
for (const f of DISTRICTS.features) if (hdDem[f.properties.hd]) f.properties.dem = hdDem[f.properties.hd];
save('DISTRICTS', DISTRICTS);
// the Senate views' subtitle lists the contested Senate districts
const sdList = SENATE_RANKING.map(r => +r.sd).sort((a, b) => a - b);
const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen'];
for (let i = 0; i < lines.length; i++) if (/sub:'\w+ contested State Senate districts \(SD /.test(lines[i]))
  lines[i] = lines[i].replace(/sub:'\w+ contested State Senate districts \(SD [^)]*\)/, `sub:'${words[sdList.length]} Democrat-vs-Republican State Senate districts (SD ${sdList.join(', ')})`);
fs.writeFileSync(HTML, lines.join('\n'));

// ---- flat CSV of the map figures
const COLS = ['county', 'precinct', 'hd', 'hd_split', 'sd', 'sd_split', 'pres_harris', 'pres_trump', 'pres_other', 'pres_dem2p', 'dem_name', 'rep_name', 'house_dem', 'house_rep', 'house_other', 'house_others', 'house_dem2p', 'delta', 'undervote', 'has_metric', 'note',
  'sen_up', 'sen_dem_name', 'sen_rep_name', 'sen_dem', 'sen_rep', 'sen_other', 'sen_others', 'sen_dem2p', 'sen_delta', 'sen_undervote', 'sen_note'];
csv.write(path.join(ROOT, 'data/split_ticket_data.csv'), COLS, out.map(p => COLS.map(c => p[c] ?? '')));
console.log(`${out.length} precincts; ${out.filter(p => p.has_metric).length} with a House comparison, ${out.filter(p => p.sen_delta !== undefined).length} with a Senate comparison`);
if (reassigned.length) console.log(`${reassigned.length} precincts take their district from the official results instead of the map:\n  ` + reassigned.join('\n  '));
console.log(`${RANKING.length} D-vs-R House districts, ${SENATE_RANKING.length} D-vs-R Senate districts (SD ${sdList.join(', ')})`);
