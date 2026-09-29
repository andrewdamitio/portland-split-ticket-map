#!/usr/bin/env node
// Step 1 of the pipeline: extract precinct-level vote counts from each county's official results file.
//
//   node scripts/extract_all.js [county ...]
//
// Writes data/extracted/<county>.csv (county, precinct_label, contest, type, choice, votes) and
// data/extracted/_log.txt (every check that failed, plus each OCR cell that was fixed or derived).
// Text PDFs are converted with Poppler's pdftotext (cached in data/.cache/text). Scanned PDFs were OCR'd
// once with Tesseract (scripts/ocr.sh); that text is committed in data/ocr so OCR is not needed to rebuild.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const csv = require('./lib/csv');

const ROOT = path.resolve(__dirname, '..');
const SRC = p => path.join(ROOT, 'data/sources', p);
const CACHE = path.join(ROOT, 'data/.cache/text');
const cfg = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config', f), 'utf8'));
const X = name => require('./extract/' + name);

// pdftotext -raw / -layout, cached. Set PDFTOTEXT to the binary if it is not on PATH.
function text(slug, mode) {
  const out = path.join(CACHE, `${slug}.${mode === 'raw' ? 'raw' : 'layout'}.txt`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(CACHE, { recursive: true });
    execFileSync(process.env.PDFTOTEXT || 'pdftotext', ['-' + mode, SRC(`${slug}-2024-general.pdf`), out]);
  }
  return out;
}
const raw = slug => text(slug, 'raw'), layout = slug => text(slug, 'layout');
// committed OCR pages of a scanned county, joined into one text (pages separated by form feeds)
function ocrText(slug) {
  const dir = path.join(ROOT, 'data/ocr', slug), out = path.join(CACHE, `${slug}.ocr.txt`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(out, fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join(''));
  return out;
}

// county -> how to extract it
const COUNTIES = {
  // ElectionWare "Canvass Results Report"
  Clackamas: () => X('canvass')({ file: raw('clackamas'), county: 'Clackamas' }),
  Marion: () => X('canvass')({ file: raw('marion'), county: 'Marion' }),
  Yamhill: () => X('canvass')({ file: raw('yamhill'), county: 'Yamhill' }),
  // "Statement of Votes Cast by Contests, Geography by Choice" with suppressed small cells
  Lane: () => X('lane')({ file: raw('lane'), county: 'Lane' }),
  // statement-of-votes CSV
  Multnomah: () => X('sovc')({ file: SRC('multnomah-2024-general.csv'), county: 'Multnomah' }),
  // scanned: OCR text (Benton) or transcription from page images (Polk), per-page layout config
  Benton: () => X('ocrtable')({ cfg: cfg('benton.json'), root: ROOT }),
  Polk: () => X('ocrtable')({ cfg: cfg('polk.json'), root: ROOT }),
  // column-block reports
  Washington: () => X('blocks')({ CFG: cfg('washington.json'), county: 'Washington', root: ROOT }),
  Klamath: () => (raw('klamath'), X('blocks')({ CFG: cfg('klamath.json'), county: 'Klamath', root: ROOT })),
  // "Custom/Countywide Table Report" canvass, possibly two contests per page
  Clatsop: () => X('tablereport')({ rawFile: raw('clatsop'), layoutFile: layout('clatsop'), county: 'Clatsop' }),
  Umatilla: () => X('tablereport')({ rawFile: raw('umatilla'), layoutFile: layout('umatilla'), county: 'Umatilla' }),
  Union: () => X('tablereport')({ rawFile: raw('union'), layoutFile: layout('union'), county: 'Union' }),
  // ES&S per-precinct abstract ("N ballots (...), M registered voters")
  Douglas: () => X('abstract')({ rawFile: raw('douglas'), county: 'Douglas' }),
  Jackson: () => X('abstract')({ rawFile: raw('jackson'), county: 'Jackson' }),
  'Hood River': () => X('abstract')({ rawFile: raw('hood-river'), county: 'Hood River' }),
  Linn: () => X('abstract')({ rawFile: raw('linn'), county: 'Linn' }),
  Josephine: () => X('abstract')({ rawFile: raw('josephine'), county: 'Josephine' }),
  // Wasco's page 1 is a scanned, signed page with no text layer: transcribed in data/manual/wasco-p1.txt
  Wasco: () => {
    const f = path.join(CACHE, 'wasco.full.raw.txt');
    fs.writeFileSync(f, fs.readFileSync(path.join(ROOT, 'data/manual/wasco-p1.txt'), 'utf8') + '\n' + fs.readFileSync(raw('wasco'), 'utf8'));
    return X('abstract')({ rawFile: f, county: 'Wasco' });
  },
  // scanned; OCR text (data/ocr/crook) in the same report format
  Crook: () => X('abstract')({ rawFile: ocrText('crook'), county: 'Crook', ocr: true }),
  Columbia: () => X('columbia')({ rawFile: raw('columbia'), layoutFile: layout('columbia'), county: 'Columbia' }),
  Tillamook: () => X('precinctsummary')({ rawFile: raw('tillamook'), county: 'Tillamook', countyLine: 'Tillamook' }),
  // Clear Ballot XML export from the county's results system
  Deschutes: () => X('clearballot')({ xmlFile: SRC('deschutes-2024-general.xml'), county: 'Deschutes' }),
};
// Small scanned counties: transcribed from the page images into data/manual/<county>.txt
for (const county of ['Gilliam', 'Grant', 'Harney', 'Morrow', 'Curry', 'Lake', 'Malheur', 'Coos', 'Baker', 'Lincoln', 'Sherman', 'Wheeler', 'Wallowa', 'Jefferson'])
  COUNTIES[county] = () => X('transcribed')({ file: path.join(ROOT, `data/manual/${county.toLowerCase().replace(/ /g, '-')}.txt`), county });

const want = process.argv.slice(2);
const slug = c => c.toLowerCase().replace(/ /g, '-');
fs.mkdirSync(path.join(ROOT, 'data/extracted'), { recursive: true });
const logFile = path.join(ROOT, 'data/extracted/_log.txt');
const log = want.length && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\n(?=## )/).filter(s => s.trim() && !want.includes(s.slice(3).split('\n')[0].trim())) : [];
for (const [county, run] of Object.entries(COUNTIES)) {
  if (want.length && !want.includes(county)) continue;
  const { rows, problems } = run();
  csv.write(path.join(ROOT, `data/extracted/${slug(county)}.csv`), ['county', 'precinct_label', 'contest', 'type', 'choice', 'votes'], rows, '\n');
  const notes = problems.filter(p => /^(FIXED|DERIVED|RENAMED)/.test(p)), errors = problems.filter(p => !/^(FIXED|DERIVED|RENAMED)/.test(p));
  log.push(`## ${county}\n${rows.length} rows, ${errors.length} failed checks, ${notes.length} corrected cells\n` + problems.map(p => '  ' + p).join('\n'));
  console.log(`${county.padEnd(11)} ${String(rows.length).padStart(6)} rows  ${errors.length ? errors.length + ' FAILED CHECKS' : 'all checks passed'}${notes.length ? `  (${notes.length} corrected cells)` : ''}`);
  for (const e of errors.slice(0, 5)) console.log('    ' + e);
}
fs.writeFileSync(logFile, log.sort().join('\n\n') + '\n');
