// ElectionWare "Canvass Results Report" (Clackamas, Marion, Yamhill), from `pdftotext -raw`.
// Each page holds one contest: the title follows the run-time/run-date lines, then "Precinct", the column
// headers, and one row per precinct ("<precinct> n n n ... [turnout%]"). Column headers are matched as
// word sequences so the parser works whether pdftotext emits one word or one phrase per line; candidate
// names are identified from data/config/candidates.csv.
const fs = require('fs');
const cand = require('../lib/candidates');

const KNOWN = [ // header label (as words) -> column type; null = ignore
  ['Cast Votes', 'cast_votes'], ['Undervotes', 'undervotes'], ['Overvotes', 'overvotes'],
  ['Miscellaneous Write-In', 'writein'], ['Misc Write-in (W)', 'writein'], ['Write-in', 'writein'],
  ['Vote by Mail Ballots Cast', 'vbm_ballots'], ['Total Ballots Cast', 'ballots_cast'],
  ['Registered Voters', 'registered'], ['Turnout Percentage', null],
].map(([l, t]) => [l.toLowerCase().split(' '), t]);
const ROW = /^(\S+)\s+((?:[\d,]+\s+)*[\d,]+)(?:\s+[\d.]+%)?$/;

module.exports = function ({ file, county }) {
  const out = [], problems = [];
  for (const page of fs.readFileSync(file, 'utf8').split('\f')) {
    const L = page.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let title = null;
    for (let j = 2; j < L.length; j++) if (/^\d\d\/\d\d\/\d{4}$/.test(L[j - 1]) && /^\d{1,2}:\d\d [AP]M$/.test(L[j - 2])) { title = L[j]; break; }
    const ct = title && cand.contestOf(title);
    if (!ct) continue;
    // a page can hold a votes table and a separate turnout table, each starting with "Precinct"
    for (let i = 0; i < L.length; i++) {
      if (L[i] !== 'Precinct') continue;
      const tok = []; let j = i + 1;
      for (; j < L.length; j++) { const m = L[j].match(ROW); if (m && m[2].split(/\s+/).length >= 2) break; tok.push(...L[j].split(/\s+/)); }
      // split header tokens into candidate words and known columns
      const cols = []; const candWords = [];
      for (let k = 0; k < tok.length;) {
        const hit = KNOWN.find(([w]) => w.every((x, o) => (tok[k + o] || '').toLowerCase() === x));
        if (hit) { if (hit[1]) cols.push(hit[1]); k += hit[0].length; continue; } // turnout % is not a count column
        if (!cols.length) candWords.push(tok[k]); // candidate names come before the summary columns
        k++; // (words after the summary columns are page-header text; the row/column count check guards the layout)
      }
      const cands = cand.orderInText(ct.office, ct.district, candWords.join(' '));
      const layout = [...cands.map(c => ({ type: 'candidate', c })), ...cols.map(t => ({ type: t }))];
      for (; j < L.length && L[j] !== 'Precinct'; j++) {
        const m = L[j].match(ROW); if (!m) continue;
        const nums = m[2].split(/\s+/).map(x => +x.replace(/,/g, ''));
        if (nums.length < 2 || /^(totals?|countywide)$/i.test(m[1])) continue;
        if (nums.length !== layout.length) { problems.push(`${title} ${m[1]}: ${nums.length} values vs ${layout.length} columns (${cands.length} candidates found in "${candWords.join(' ')}")`); continue; }
        const rec = {};
        layout.forEach((c, x) => {
          if (c.type === 'candidate') out.push([county, m[1], title, 'candidate', c.c.candidate, nums[x]]);
          else if (c.type) { rec[c.type] = nums[x]; if (c.type !== 'cast_votes' && c.type !== 'vbm_ballots') out.push([county, m[1], title, c.type, '', nums[x]]); }
        });
        const tot = layout.reduce((a, c, x) => a + (['candidate', 'writein', 'undervotes', 'overvotes'].includes(c.type) ? nums[x] : 0), 0);
        if (rec.ballots_cast !== undefined && tot !== rec.ballots_cast) problems.push(`${title} ${m[1]}: cand+writein+under+over ${tot} != ballots ${rec.ballots_cast}`);
      }
      i = j - 1;
    }
  }
  return { rows: out, problems };
};
