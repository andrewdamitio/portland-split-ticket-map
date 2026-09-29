// Resolve a precinct label from a county report to the precinct id used by the map (data/map_precincts.csv).
// Tries: an explicit alias (data/config/precinct_aliases.json), the exact label, the label's leading code
// ("101-UMATILLA, CITY OF" -> 101, "01 LG City" -> 1), then the name part ("101 - Astoria West" -> Astoria West).
const fs = require('fs');
const csv = require('./csv');
const norm = s => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const noZeros = s => s.replace(/^0+(?=\d)/, '');
const codeOf = s => (s.match(/^#?\s*(\d+[A-Z]?)\b/i) || [])[1];

function loader(mapCsv, aliasFile) {
  const ids = {};
  for (const r of csv.read(mapCsv)) (ids[r.county] = ids[r.county] || []).push(r.precinct);
  const ALIAS = aliasFile && fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : {};
  return function resolve(county, label) {
    const list = ids[county] || []; label = String(label).trim();
    const alias = (ALIAS[county] || {})[label]; if (alias !== undefined) return alias;
    if (list.includes(label)) return label;
    const n = norm(label); let hit = list.find(p => norm(p) === n); if (hit) return hit;
    const code = codeOf(label);
    if (code) {
      hit = list.find(p => p === code || noZeros(p) === noZeros(code) || norm(p) === norm(code)); if (hit) return hit;
      hit = list.find(p => { const pc = codeOf(p); return pc && noZeros(pc) === noZeros(code); }); if (hit) return hit;
    }
    const name = label.replace(/^#?\s*\d+[A-Z]?\s*[-–]?\s*/i, '');
    if (name) { hit = list.find(p => norm(p) === norm(name)); if (hit) return hit; }
    return null;
  };
}
module.exports = { loader };
