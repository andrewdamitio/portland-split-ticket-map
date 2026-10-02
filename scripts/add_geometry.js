#!/usr/bin/env node
// Fill in precinct shapes that are missing from the map data inside index.html.
//
//   node scripts/add_geometry.js
//
// The precinct shapes live only in index.html (the PRECINCTS line); their original boundary files were not
// kept. Yamhill precinct 11 (Gaston Area) had no shape, so it is added here from the county's precinct file
// (data/geo/yamhill-precincts.geojson), where it is stored as several parts ("011 - Gaston Area.01", ...).
// The parts are combined into one MultiPolygon. Safe to re-run: precincts that already have a shape are skipped.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

const FIXES = [
  { county: 'Yamhill', precinct: '11', file: 'data/geo/yamhill-precincts.geojson', match: p => /^0*11 - /.test(p.PPartName || '') },
];

const lines = fs.readFileSync(HTML, 'utf8').split('\n');
const i = lines.findIndex(l => l.startsWith('const PRECINCTS = '));
const cr = lines[i].endsWith('\r') ? '\r' : '';
const PRECINCTS = JSON.parse(lines[i].replace(/^const PRECINCTS = /, '').replace(/;\s*$/, ''));
let changed = 0;
for (const fix of FIXES) {
  const f = PRECINCTS.features.find(x => x.properties.county === fix.county && x.properties.precinct === fix.precinct);
  if (!f) { console.log(`${fix.county} ${fix.precinct}: not in the map data`); continue; }
  if (f.geometry) { console.log(`${fix.county} ${fix.precinct}: already has a shape`); continue; }
  const parts = JSON.parse(fs.readFileSync(path.join(ROOT, fix.file), 'utf8')).features.filter(x => fix.match(x.properties));
  if (!parts.length) { console.log(`${fix.county} ${fix.precinct}: no matching shapes in ${fix.file}`); continue; }
  const polys = parts.flatMap(p => p.geometry.type === 'Polygon' ? [p.geometry.coordinates] : p.geometry.coordinates);
  f.geometry = { type: 'MultiPolygon', coordinates: polys };
  console.log(`${fix.county} ${fix.precinct}: added ${parts.length} part(s) from ${fix.file}`);
  changed++;
}
if (changed) { lines[i] = `const PRECINCTS = ${JSON.stringify(PRECINCTS)};` + cr; fs.writeFileSync(HTML, lines.join('\n')); }
