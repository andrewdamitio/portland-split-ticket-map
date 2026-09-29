// ES&S "Statement of Votes Cast by Geography" / "Abstract of Votes" reports (Douglas, Jackson, Hood River,
// Linn, Josephine, Wasco; and Crook from OCR text): one section per precinct ("Precinct NN"); each contest has
//   "N ballots (x over voted ballots, x overvotes, x undervotes), M registered voters, turnout ..."
//   "Name count pct%" ... "Write-in count pct%", "Total count", "Overvotes n", "Undervotes n".
// With ocr:true, OCR noise is handled: label misspellings are tolerated, an unreadable over/under count is taken
// from the ballots line (which states both), and a candidate count that disagrees with its printed percentage is
// replaced by the only whole number consistent with that percentage (logged as FIXED; the sums then re-check it).
const fs = require('fs');

module.exports = function ({ rawFile, county, ocr = false }) {
  const WANT = /^(united states president|us president|president|state senator|state representative)/i;
  const L = fs.readFileSync(rawFile, 'utf8').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim());
  const out = [], problems = []; let precinct = null, c = null;
  const n = s => +s.replace(/,/g, '');
  const zeroish = t => /^(0|[()\[\]{}|¢]+|0[)\]]|[oOQ]|[a-z]?[)\]])$/.test(t); // OCR renderings of a lone 0
  function fixByPct(entry, total, label) { // entry = [name, count, pct]
    const [name, count, pct] = entry;
    if (pct === undefined || !total) return;
    const ok = k => Math.abs(k / total * 100 - pct) <= 0.0051; // printed % is rounded to 2 places (ties either way)
    if (count !== null && ok(count)) return;
    const est = Math.round(pct * total / 100), cands = [est - 1, est, est + 1].filter(k => k >= 0 && ok(k));
    if (cands.length === 1) { problems.push(`${count === null ? 'DERIVED' : 'FIXED'} ${precinct} ${label} ${name}: OCR "${count === null ? entry[3] : count}" -> ${cands[0]} (${pct}% of ${total})`); entry[1] = cands[0]; }
    else problems.push(`${precinct} ${label} ${name}: count ${count} disagrees with ${pct}% of ${total}`);
  }
  function flush() {
    if (!c || !WANT.test(c.title)) { c = null; return; }
    const t = c.title.replace(/\s*\(VGNone\)|\s*\(\)/g, '').replace(/\s*\(Vote for \d+[)}\]]$/, '');
    if (ocr) { for (const e of c.cand) fixByPct(e, c.total, t); if (c.wi) fixByPct(c.wi, c.total, t); }
    if (c.wi) c.writein = c.wi[1];
    else if (ocr && c.total !== undefined) { // write-in line lost by OCR: it is the only remaining term of the total
      c.writein = c.total - c.cand.reduce((a, x) => a + x[1], 0);
      if (c.writein >= 0) problems.push(`DERIVED ${precinct} ${t} Write-in: line missing -> ${c.writein} (total minus candidates)`); }
    for (const k of ['over', 'under']) if (c[k] === null || c[k] === undefined) {
      if (c['b' + k] !== undefined) { if (c[k] === null) problems.push(`DERIVED ${precinct} ${t} ${k}votes: unreadable line -> ${c['b' + k]} (from ballots line)`); c[k] = c['b' + k]; }
    } else if (c['b' + k] !== undefined && c[k] !== c['b' + k]) {
      const other = k === 'over' ? c.under : c.over, fits = v => c.total + v + other === c.ballots;
      if (ocr && fits(c['b' + k]) && !fits(c[k])) { problems.push(`FIXED ${precinct} ${t} ${k}votes: OCR ${c[k]} -> ${c['b' + k]} (ballots line; balances ballots)`); c[k] = c['b' + k]; }
      else problems.push(`${precinct} ${t}: ${k}votes ${c[k]} but ballots line says ${c['b' + k]}`);
    }
    const cand = c.cand.reduce((a, x) => a + x[1], 0) + (c.writein || 0);
    if (c.total !== undefined && cand !== c.total) problems.push(`${precinct} ${t}: cand+writein ${cand} != total ${c.total}`);
    if (c.ballots !== undefined && c.total !== undefined && c.total + c.over + c.under !== c.ballots) problems.push(`${precinct} ${t}: total+over+under ${c.total + c.over + c.under} != ballots ${c.ballots}`);
    for (const [nm, v] of c.cand) out.push([county, precinct, t, 'candidate', nm, v]);
    for (const [k, f] of [['writein', 'writein'], ['total_votes', 'total'], ['overvotes', 'over'], ['undervotes', 'under'], ['ballots_cast', 'ballots'], ['registered', 'reg']])
      if (c[f] !== undefined && c[f] !== null) out.push([county, precinct, t, k, '', c[f]]);
    c = null;
  }
  for (const s of L) {
    let m;
    if ((m = s.match(/^Precinct\s+(.+)$/)) && !/Precincts|Total|Vote for|^Precinct Report$/i.test(s)) { flush(); precinct = m[1].trim(); continue; }
    if (/^All Precincts$/.test(s)) { flush(); precinct = null; continue; } // county-wide summary follows
    if (!precinct) continue;
    if (/\(Vote for \d+[)}\]]$/.test(s)) { flush(); c = { title: s, cand: [] }; continue; } // OCR may read ")" as "}"
    if (!c) continue;
    if ((m = s.match(/^([\d,]+) ballots \( ?(\d+) over voted ballots, ([\d,]+) overvotes, ([\d,]+) undervotes\),? ?(?:([\d,]+) registered voters)?/))) {
      c.ballots = n(m[1]); c.bover = n(m[3]); c.bunder = n(m[4]); if (m[5]) c.reg = n(m[5]); continue; }
    if ((m = s.match(/^Total ([\d,]+)(?: [\d.]+ ?%)?$/))) { c.total = n(m[1]); continue; }
    if ((m = s.match(ocr ? /^(Over|Under)\s?v\w*\s*(.*)$/i : /^(Over|Under)votes ([\d,]+)$/))) {
      const k = m[1].toLowerCase(), v = m[2].trim();
      c[k] = /^[\d,]+$/.test(v) ? n(v) : (ocr && zeroish(v)) ? 0 : null; continue; }
    if ((m = s.match(/^Write-? ?in ([\d,]+) ([\d.]+) ?%$/i))) { c.wi = ['Write-in', n(m[1]), +m[2]]; continue; }
    if ((m = s.match(/^(.+?) ([\d,]+) ([\d.]+) ?%$/))) { c.cand.push([m[1], n(m[2]), +m[3]]); continue; }
    // OCR: count unreadable but percentage readable -> solved from the percentage in flush()
    if (ocr && (m = s.match(/^([A-Z][A-Za-z .\/'-]+?) (\S{1,4}) ([\d.]+) ?%$/)) && !/^Total/.test(m[1])) {
      if (/^Write-? ?in$/i.test(m[1])) c.wi = ['Write-in', null, +m[3], m[2]]; else c.cand.push([m[1], null, +m[3], m[2]]); continue; }
  }
  flush();
  return { rows: out, problems };
};
