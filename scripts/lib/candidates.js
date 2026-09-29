// Candidate table (data/config/candidates.csv): canonical name and party for every 2024 President,
// State Senate and State House candidate. Used to (1) recognise contests and candidates in county reports
// whatever their formatting, and (2) classify votes as Democratic, Republican or third-party.
const path = require('path');
const csv = require('./csv');

const TABLE = csv.read(path.join(__dirname, '../../data/config/candidates.csv'));
const norm = s => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

// "State Representative, 18th District - Vote for one" -> {office:'State House', district:'18'}
function contestOf(title) {
  if (/\b(US|U\.S\.|United States) Representative|Congress/i.test(title)) return null;
  if (/president/i.test(title)) return { office: 'President', district: '' };
  const d = (title.match(/(\d+)\s*(?:st|nd|rd|th)\b/i) || title.match(/District\s+(\d+)/i) || [])[1];
  if (/senator|senate/i.test(title)) return { office: 'State Senate', district: d };
  if (/representative|house/i.test(title)) return { office: 'State House', district: d };
  return null;
}

const listFor = (office, district) => TABLE.filter(c => c.office === office && (office === 'President' || c.district === String(+district)));

// Levenshtein distance, capped (small strings only)
function dist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Match a printed candidate name to the table entry for this contest (by its match key). OCR'd names may have a
// one-letter error ("Haris", "Breese-lverson"): keys of 5+ letters also match a word sequence one edit away.
function identify(office, district, printed) {
  const n = ' ' + norm(printed) + ' ';
  const list = listFor(office, district);
  let hits = list.filter(c => n.includes(' ' + norm(c.match) + ' '));
  if (!hits.length) {
    const words = norm(printed).split(' ');
    hits = list.filter(c => { const k = norm(c.match), kw = k.split(' ').length;
      return k.replace(/ /g, '').length >= 5 && words.some((_, i) => dist(words.slice(i, i + kw).join(' '), k) <= 1); });
    if (hits.length > 1) return null;
  }
  // prefer the longest key when one key contains another (e.g. "Kennedy-Smith" vs "Smith")
  hits.sort((a, b) => b.match.length - a.match.length);
  return hits[0] || null;
}

// Candidates of a contest in the order their names appear in a block of header text.
function orderInText(office, district, text) {
  const n = ' ' + norm(text) + ' ';
  return listFor(office, district)
    .map(c => ({ c, i: n.indexOf(' ' + norm(c.match) + ' ') }))
    .filter(x => x.i >= 0)
    // a key that is part of a longer key found at the same place (Smith in Kennedy-Smith) is not separate
    .filter((x, _, all) => !all.some(y => y !== x && y.c.match.length > x.c.match.length && norm(y.c.match).includes(norm(x.c.match)) && Math.abs(y.i - x.i) < y.c.match.length + 2))
    .sort((a, b) => a.i - b.i).map(x => x.c);
}

module.exports = { TABLE, contestOf, listFor, identify, orderInText };
