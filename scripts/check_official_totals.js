#!/usr/bin/env node
// Check: summing data/full_vote_counts_2024.csv over all precincts must reproduce the Oregon Secretary of
// State's certified totals (data/sources/oregon-sos-2024-general-official-results.pdf) for President and every
// State Senate and State House race, candidate by candidate, plus write-ins ("Miscellaneous").
//
//   node scripts/check_official_totals.js
//
// Lane County prints "<10" instead of small counts, so a sum that includes Lane is a range (each <10 = 0..9).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const csv = require('./lib/csv');
const cand = require('./lib/candidates');

const ROOT = path.resolve(__dirname, '..');
const pdf = path.join(ROOT, 'data/sources/oregon-sos-2024-general-official-results.pdf');
const txt = path.join(ROOT, 'data/.cache/text/oregon-sos.layout.txt');
if (!fs.existsSync(txt)) { fs.mkdirSync(path.dirname(txt), { recursive: true }); execFileSync(process.env.PDFTOTEXT || 'pdftotext', ['-layout', pdf, txt]); }

// parse the official totals: section headers, district headers, "Last, First (P)** 12,345" lines
const official = []; // {office, district, name, votes}
let office = null, district = '';
for (const raw of fs.readFileSync(txt, 'utf8').split(/\r?\n/)) {
  const s = raw.trim(); let m;
  if (/^United States President$/.test(s)) { office = 'President'; district = ''; continue; }
  if (/^(United States Vice President|United States Representative|Judge of|Secretary of State|State Treasurer|Attorney General)/.test(s)) { office = null; continue; }
  if (/^State Senator$/.test(s)) { office = 'State Senate'; continue; }
  if (/^State Representative$/.test(s)) { office = 'State House'; continue; }
  if (!office) continue;
  if ((m = s.match(/^(\d+)\s*(?:st|nd|rd|th)?\s*District$/))) { district = m[1]; continue; }
  if (/^District$/.test(s)) continue;
  if ((m = s.match(/^(.+?)\s+([\d,]+)$/)) && !/Total/.test(m[1])) official.push({ office, district, name: m[1].replace(/\*+$/, '').trim(), votes: +m[2].replace(/,/g, '') });
}
// "1 District" is printed with the ordinal on the line above ("st"); fix districts parsed as ''
for (const o of official) if (o.office !== 'President' && !o.district) o.district = '1';

// our sums
const sums = {}; // office|district|candidate-or-writein -> {lo, hi}
for (const r of csv.read(path.join(ROOT, 'data/full_vote_counts_2024.csv'))) {
  if (r.type !== 'candidate' && r.type !== 'writein') continue;
  const k = [r.office, r.district, r.type === 'writein' ? 'Miscellaneous' : r.candidate].join('|');
  const s = sums[k] = sums[k] || { lo: 0, hi: 0 };
  if (r.votes === '<10') s.hi += 9; else { s.lo += +r.votes; s.hi += +r.votes; }
}

// Differences between the counties' certified reports and the SoS compilation, each checked against the
// county's own printed totals (our sums equal those): the SoS figure is the odd one out.
const KNOWN = {
  'State Senate|5|Dick Anderson': 'counties total 42,336 (Benton 5,026 + Coos 12,190 + Douglas 2,033 + Lane 9,622 + Lincoln 13,465, each equal to the county\'s printed total); SoS prints 42,335',
  'State House|20|Kevin S Chambers': 'Marion prints 4,263 and Polk 10,675 = 14,938; SoS prints 14,398 (digits transposed)',
  'State House|25|Ben Bowman': 'HD 25 is entirely in Washington County, whose certified report prints 24,096 (and Niemeyer 11,473, which the SoS matches); SoS prints 24,798',
};
let ok = 0, bad = 0, range = 0, known = 0; const lines = [];
for (const o of official) {
  let key;
  if (o.name === 'Miscellaneous') key = 'Miscellaneous';
  else {
    const c = cand.identify(o.office, o.district, o.name.replace(/^(.*?),\s*(.*?)\s*\(.*$/, '$2 $1'));
    if (!c) { lines.push(`?? ${o.office} ${o.district}: official candidate "${o.name}" not in candidates.csv`); bad++; continue; }
    key = c.candidate;
  }
  const s = sums[[o.office, o.district, key].join('|')] || { lo: 0, hi: 0 };
  const label = `${o.office}${o.district ? ' ' + o.district : ''} ${key}`.padEnd(52);
  if (s.lo === o.votes && s.hi === o.votes) { ok++; continue; }
  if (s.lo <= o.votes && o.votes <= s.hi) { range++; lines.push(`~  ${label} official ${o.votes}, ours ${s.lo}..${s.hi} (includes Lane "<10" cells)`); continue; }
  const kn = KNOWN[[o.office, o.district, key].join('|')];
  if (kn) { known++; lines.push(`!  ${label} official ${o.votes}, ours ${s.lo} — known SoS discrepancy: ${kn}`); continue; }
  bad++; lines.push(`XX ${label} official ${o.votes}, ours ${s.lo === s.hi ? s.lo : s.lo + '..' + s.hi} (diff ${s.lo - o.votes})`);
}
console.log(`${official.length} official totals: ${ok} exact, ${range} consistent within Lane's suppressed cells, ${known} known SoS discrepancies, ${bad} unexplained differences`);
if (lines.length) console.log(lines.join('\n'));
process.exitCode = bad ? 1 : 0;
