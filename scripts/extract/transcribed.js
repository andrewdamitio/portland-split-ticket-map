// Hand transcriptions of scanned results pages (data/manual/<county>.txt), used where OCR is unreliable.
// Format (one block per contest; '#' starts a comment):
//
//   contest: State Senator, 29th District          <- any title the candidate table recognises
//   source: page 2                                 <- optional note (which page the block came from)
//   cols: Wildbill | Nash | writein | overvotes | undervotes | ballots_cast
//   #1: 52 382 2 1 49 486                          <- "<precinct label>: values..." in column order
//   TOTAL: 126 864 4 1 162 1157                    <- the printed totals row ("TOTAL: n/a" if the source has none)
//
// Candidate columns may be any text containing the candidate's match key from data/config/candidates.csv.
// Other columns: writein, overvotes, undervotes, ballots_cast, registered, total_votes, skip.
// Checks: candidates + write-ins (+ over + under) must equal the printed total / ballots, and every column
// must sum to the TOTAL row, so a mistyped number cannot pass silently.
const fs = require('fs');
const cand = require('../lib/candidates');

module.exports = function ({ file, county }) {
  const out = [], problems = [];
  let contest = null, ct = null, cols = null, sums = null, rows = 0;
  const finish = () => { if (contest && !sums.checked) problems.push(`${contest}: no TOTAL row to check against`); };
  for (const [n, rawLine] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#(?!\d).*$/, '').replace(/\s+#\s.*$/, '').trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^contest:\s*(.+)$/i))) { finish(); contest = m[1]; ct = cand.contestOf(contest); cols = null; sums = null; rows = 0;
      if (!ct) problems.push(`line ${n + 1}: contest "${contest}" not recognised`); continue; }
    if (/^source:/i.test(line)) continue;
    if (/^TOTAL:\s*n\/a/i.test(line)) { if (sums) sums.checked = true; continue; } // source prints no totals row
    if ((m = line.match(/^cols:\s*(.+)$/i))) {
      cols = m[1].split('|').map(s => s.trim()).map(s => {
        if (/^(writein|overvotes|undervotes|ballots_cast|registered|total_votes|skip)$/.test(s)) return { type: s };
        const c = cand.identify(ct.office, ct.district, s);
        if (!c) problems.push(`line ${n + 1}: "${s}" is not a known candidate in ${contest}`);
        return { type: 'candidate', name: c ? c.candidate : s };
      });
      sums = cols.map(() => 0); continue;
    }
    if (!(m = line.match(/^(.+?):\s*([\d,\s]+)$/))) { problems.push(`line ${n + 1}: cannot read "${line}"`); continue; }
    const v = m[2].trim().split(/\s+/).map(x => +x.replace(/,/g, ''));
    if (!cols || v.length !== cols.length) { problems.push(`line ${n + 1}: ${v.length} values but ${cols ? cols.length : 0} columns`); continue; }
    if (m[1] === 'TOTAL') {
      const bad = cols.map((c, i) => [c, sums[i], v[i]]).filter(([c, s, t]) => c.type !== 'skip' && s !== t);
      if (bad.length) problems.push(`${contest}: column sums differ from TOTAL row: ${bad.map(([c, s, t]) => `${c.name || c.type} ${s} vs ${t}`).join('; ')}`);
      sums.checked = true; continue;
    }
    rows++;
    const rec = {}; let votes = 0;
    cols.forEach((c, i) => {
      sums[i] += v[i];
      if (c.type === 'skip') return;
      if (c.type === 'candidate') { votes += v[i]; out.push([county, m[1], contest, 'candidate', c.name, v[i]]); }
      else { rec[c.type] = v[i]; if (c.type === 'writein') votes += v[i]; out.push([county, m[1], contest, c.type, '', v[i]]); }
    });
    if (rec.total_votes !== undefined && votes !== rec.total_votes) problems.push(`${contest} ${m[1]}: candidates + write-ins ${votes} != total ${rec.total_votes}`);
    if (rec.total_votes === undefined) out.push([county, m[1], contest, 'total_votes', '', votes]);
    if (rec.ballots_cast !== undefined && rec.overvotes !== undefined && rec.undervotes !== undefined && votes + rec.overvotes + rec.undervotes !== rec.ballots_cast)
      problems.push(`${contest} ${m[1]}: votes + over + under ${votes + rec.overvotes + rec.undervotes} != ballots ${rec.ballots_cast}`);
  }
  finish();
  // every ballot carries every state contest for its precinct, so votes + over + under must match between the
  // State Senate and State House contests (only compared where the source prints no ballots column). President
  // is left out: federal-only ballots (e.g. some overseas voters) legitimately add a few presidential ballots.
  const bal = {};
  for (const [, p, c, type, , v] of out) if (!/president/i.test(c) && ['total_votes', 'overvotes', 'undervotes'].includes(type)) { const k = p + '|' + c; bal[k] = (bal[k] || 0) + v; }
  const byP = {}; for (const [k, v] of Object.entries(bal)) { const [p, c] = k.split('|'); (byP[p] = byP[p] || []).push([c, v]); }
  if (!out.some(r => r[3] === 'ballots_cast'))
    for (const [p, l] of Object.entries(byP)) if (new Set(l.map(x => x[1])).size > 1) problems.push(`${p}: votes+over+under differ between contests: ${l.map(x => x[0] + '=' + x[1]).join(', ')}`);
  return { rows: out, problems };
};
