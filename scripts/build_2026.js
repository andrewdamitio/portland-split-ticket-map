#!/usr/bin/env node
// PRELIMINARY 2026 legislative results and the 2024 -> 2026 swing, by district.
//
//   node scripts/build_2026.js
//
// Input:  data/sources/oregon-sos-2026-general-legislative-preliminary.csv — the Secretary of State's results
//         download (district totals only, unofficial, as of the timestamp in the file).
//         data/full_vote_counts_2024.csv — 2024 precinct results (summed to districts here).
// Output: data/legislative_2026_preliminary.csv     one row per 2026 candidate
//         data/legislative_swing_2024_2026.csv      one row per 2026 district: result, 2024 comparison, swing
//         the LEG2026 line in index.html             what the two 2026 map views show
//
// Rules:
//   * Party is by ballot line: the Democrat is the candidate nominated by the Democratic Party, the Republican the one
//     nominated by the Republican Party (in 2026 several candidates are cross-nominated, and the file does not list
//     their own party first consistently). A race is Democrat-vs-Republican only if different candidates hold the
//     two lines. 2024 candidates are classified by the party in data/config/candidates.csv.
//   * Two-party margin = (D - R) / (D + R). Swing = 2026 margin - 2024 margin, in points; positive = toward Democrats.
//   * House: each district is compared with its own 2024 race. Senate: the seats up in 2026 were not on the 2024
//     ballot, so each is compared with the 2024 House results of the two House districts it contains
//     (SD n = HD 2n-1 + HD 2n), and only when both of those 2024 House races were Democrat-vs-Republican.
const fs = require('fs'), path = require('path');
const csv = require('./lib/csv');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data/sources/oregon-sos-2026-general-legislative-preliminary.csv');
const HTML = path.join(ROOT, 'index.html');
const r1 = x => Math.round(x * 10) / 10;
const lastName = n => n.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/).filter(w => !/^(Jr|Sr|II|III)\.?$/i.test(w)).pop();

// ---- 2026 results
const rows = csv.read(SRC);
const asof = rows[0].CurrentDateTime;
const races = {}; // "HD 2" -> {chamber, district, cands:[...], writein}
for (const r of rows) {
  const m = r.AreaNum.match(/^(HD|SD)\s*0*(\d+)$/); if (!m) throw new Error('unexpected area ' + r.AreaNum);
  const key = m[1] + ' ' + m[2];
  const race = races[key] = races[key] || { chamber: m[1] === 'HD' ? 'House' : 'Senate', district: m[2], cands: [], writein: 0 };
  const votes = +r.CandidateVotes;
  if (r.CandidateName === 'Write-in') { race.writein += votes; continue; }
  const lines = r.NominatingParty.split(',').map(s => s.trim()).filter(Boolean);
  race.cands.push({ name: r.CandidateName, lines, votes });
}
const out26 = [], swingRows = [], house = {}, senate = {};

// ---- 2024 district totals from the precinct data (by own party)
const y24 = {}; // "House 18" -> {d, r, dName, rName}
for (const r of csv.read(path.join(ROOT, 'data/full_vote_counts_2024.csv'))) {
  if (r.type !== 'candidate' || r.office === 'President' || r.votes === '<10') continue;
  const k = (r.office === 'State House' ? 'House ' : 'Senate ') + r.district;
  const a = y24[k] = y24[k] || { d: 0, r: 0, dName: null, rName: null };
  if (r.party === 'DEM') { a.d += +r.votes; a.dName = lastName(r.candidate); }
  if (r.party === 'REP') { a.r += +r.votes; a.rName = lastName(r.candidate); }
}
const margin = (d, r) => (d + r) ? (d - r) / (d + r) * 100 : null;

for (const [key, race] of Object.entries(races).sort((a, b) => a[1].chamber.localeCompare(b[1].chamber) || a[1].district - b[1].district)) {
  const total = race.cands.reduce((a, c) => a + c.votes, 0) + race.writein;
  const dC = race.cands.filter(c => c.lines.includes('Democrat')), rC = race.cands.filter(c => c.lines.includes('Republican'));
  for (const c of race.cands) out26.push([race.chamber, race.district, c.name, c.lines.join(', '),
    c.lines.includes('Democrat') && c.lines.includes('Republican') ? 'DEM+REP' : c.lines.includes('Democrat') ? 'DEM' : c.lines.includes('Republican') ? 'REP' : 'OTHER', c.votes, r1(c.votes / total * 100)]);
  out26.push([race.chamber, race.district, 'Write-in', '', 'WRITEIN', race.writein, r1(race.writein / total * 100)]);

  const d = dC.length === 1 ? dC[0] : null, r = rC.length === 1 ? rC[0] : null;
  const rec = {
    cands: race.cands.map(c => ({ n: c.name, p: c.lines.join(', '), v: c.votes })), wi: race.writein,
    dem: d && d !== r ? lastName(d.name) : null, rep: r && r !== d ? lastName(r.name) : null,
  };
  let note = null;
  if (!d && !r) note = 'No Democratic or Republican nominee';
  else if (d && r && d === r) note = `${d.name} held both the Democratic and Republican nominations`;
  else if (!d) note = `No Democratic nominee`;
  else if (!r) note = `No Republican nominee`;
  // nominees whose first-listed party is not the line they hold (e.g. an Independent with the Democratic nomination)
  const flag = [d, r].filter(Boolean).filter(c => c !== (d && r && d === r ? null : undefined) && !/^(Democrat|Republican)$/.test(c.lines[0]))
    .map(c => `${c.name} was nominated by ${c.lines.join(', ')}`);
  if (!note) {
    rec.dv = d.votes; rec.rv = r.votes; rec.m = r1(margin(d.votes, r.votes)); rec.d2p = r1(d.votes / (d.votes + r.votes) * 100);
  }
  // 2024 comparison
  let basis = null, m24 = null;
  if (race.chamber === 'House') {
    const a = y24['House ' + race.district];
    if (a && a.d && a.r) { m24 = margin(a.d, a.r); basis = `2024 HD ${race.district} race (${a.dName} vs ${a.rName})`; }
    else rec.n24 = `HD ${race.district} had no Democrat-vs-Republican race in 2024`;
  } else {
    const h1 = 2 * race.district - 1, h2 = 2 * race.district, a = y24['House ' + h1], b = y24['House ' + h2];
    if (a && a.d && a.r && b && b.d && b.r) { m24 = margin(a.d + b.d, a.r + b.r); basis = `2024 House races in HD ${h1} and HD ${h2} combined`; }
    else rec.n24 = `SD ${race.district} was not on the 2024 ballot, and its House districts (HD ${h1}, HD ${h2}) did not both have Democrat-vs-Republican races in 2024`;
  }
  if (m24 !== null) { rec.m24 = r1(m24); rec.basis = basis; }
  if (rec.m !== undefined && m24 !== null) rec.swing = r1(rec.m - m24);
  if (note) rec.note = note;
  if (flag.length && !note) rec.flag = flag.join('; ');
  (race.chamber === 'House' ? house : senate)[race.district] = rec;
  swingRows.push([race.chamber, race.district, rec.dem || '', rec.rep || '', rec.dv ?? '', rec.rv ?? '',
    total - (rec.dv || 0) - (rec.rv || 0), rec.d2p ?? '', rec.m ?? '', rec.basis || '', rec.m24 ?? '', rec.swing ?? '', [note, rec.n24, rec.flag].filter(Boolean).join('; ')]);
}

// ---- Senate district shapes for the 2026 seats: SD n = HD 2n-1 + HD 2n. Outline = both House outlines minus the
// border they share (segments whose two ends are vertices of the other district).
const lines = fs.readFileSync(HTML, 'utf8').split('\n');
const lineOf = name => lines.findIndex(l => l.startsWith(`const ${name} = `));
const DISTRICTS = JSON.parse(lines[lineOf('DISTRICTS')].replace(/^const \w+ = /, '').replace(/;\s*\r?$/, ''));
const HD_LABELS = JSON.parse(lines[lineOf('DISTRICT_LABELS')].replace(/^const \w+ = /, '').replace(/;\s*\r?$/, ''));
const rings = f => f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
const k5 = p => p[0].toFixed(5) + ',' + p[1].toFixed(5);
const round = p => [Math.round(p[1] * 1e5) / 1e5, Math.round(p[0] * 1e5) / 1e5]; // [lat, lng]
const sdShapes = {};
for (const sd of Object.keys(senate)) {
  const fa = DISTRICTS.features.find(f => f.properties.hd === String(2 * sd - 1)), fb = DISTRICTS.features.find(f => f.properties.hd === String(2 * sd));
  if (!fa || !fb) throw new Error('missing House shape for SD ' + sd);
  const polylines = [];
  // a point is on the shared border if it lies within ~150 m of the other district's boundary (the two shapes do not
  // always share exact vertices); the other boundary's segments are bucketed in a grid for speed
  const EPS = 0.0015, CELL = 0.01;
  const near = (other, eps = EPS) => {
    const grid = new Map(), cell = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
    for (const ring of rings(other)) for (let i = 0; i < ring.length - 1; i++) {
      const [a, b] = [ring[i], ring[i + 1]];
      for (let x = Math.floor((Math.min(a[0], b[0]) - EPS) / CELL); x <= Math.floor((Math.max(a[0], b[0]) + EPS) / CELL); x++)
        for (let y = Math.floor((Math.min(a[1], b[1]) - EPS) / CELL); y <= Math.floor((Math.max(a[1], b[1]) + EPS) / CELL); y++) {
          const k = x + ',' + y; if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a, b]); }
    }
    return p => (grid.get(cell(p[0], p[1])) || []).some(([a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1]; return ex * ex + ey * ey < eps * eps; });
  };
  for (const [f, other] of [[fa, fb], [fb, fa]]) {
    const onOther = near(other), roughlyOnOther = near(other, 0.004);
    const start = polylines.length;
    for (const ring of rings(f)) {
      let cur = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const shared = onOther(ring[i]) && onOther(ring[i + 1]);
        if (shared) { if (cur.length > 1) polylines.push(cur); cur = []; }
        else { if (!cur.length) cur.push(round(ring[i])); cur.push(round(ring[i + 1])); }
      }
      if (cur.length > 1) polylines.push(cur);
    }
    // leftover slivers of the shared border (where the two shapes are misaligned): drop them
    for (let i = polylines.length - 1; i >= start; i--) if (polylines[i].every(p => roughlyOnOther([p[1], p[0]]))) polylines.splice(i, 1);
  }
  // thin the outline: drop vertices within ~30 m of the last kept one (invisible at district zoom, keeps the page small)
  for (let i = 0; i < polylines.length; i++) {
    const pl = polylines[i], kept = [pl[0]];
    for (let j = 1; j < pl.length - 1; j++) { const a = kept[kept.length - 1]; if (Math.abs(pl[j][0] - a[0]) + Math.abs(pl[j][1] - a[1]) > 0.0004) kept.push(pl[j]); }
    kept.push(pl[pl.length - 1]); polylines[i] = kept;
  }
  const area = f => { const b = rings(f)[0]; let a = 0; for (let i = 0; i < b.length - 1; i++) a += b[i][0] * b[i + 1][1] - b[i + 1][0] * b[i][1]; return Math.abs(a); };
  const big = area(fa) >= area(fb) ? fa : fb, lbl = HD_LABELS.find(l => l.hd === big.properties.hd);
  sdShapes[sd] = { hds: [String(2 * sd - 1), String(2 * sd)], outline: polylines, label: [lbl.lat, lbl.lng] };
  senate[sd].hds = sdShapes[sd].hds;
}

// ---- write
csv.write(path.join(ROOT, 'data/legislative_2026_preliminary.csv'), ['chamber', 'district', 'candidate', 'nominated_by', 'ballot_line', 'votes', 'pct_of_votes'], out26);
csv.write(path.join(ROOT, 'data/legislative_swing_2024_2026.csv'), ['chamber', 'district', 'dem_2026', 'rep_2026', 'dem_votes_2026', 'rep_votes_2026', 'other_votes_2026',
  'dem_2party_pct_2026', 'dem_margin_2026', 'compared_with', 'dem_margin_2024', 'swing_toward_dem', 'note'], swingRows);
const LEG2026 = { asof, house, senate, sdShapes };
const line = `const LEG2026 = ${JSON.stringify(LEG2026)};`;
const i = lineOf('LEG2026');
if (i >= 0) lines[i] = line; else lines.splice(lineOf('SEN_REP_NAMES') + 1, 0, line);
fs.writeFileSync(HTML, lines.join('\n'));
const cnt = o => Object.values(o).filter(x => x.swing !== undefined).length;
console.log(`2026 results as of ${asof}: ${Object.keys(house).length} House, ${Object.keys(senate).length} Senate districts`);
console.log(`swing computed for ${cnt(house)} House and ${cnt(senate)} Senate districts`);
