// Minimal CSV helpers (no dependencies).
const fs = require('fs');

const esc = v => (v === null || v === undefined) ? '' :
  /[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Read a CSV with a header row into an array of objects.
function read(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.length);
  const head = parseLine(lines[0]);
  return lines.slice(1).map(l => { const r = parseLine(l); return Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])); });
}

// Write rows (arrays) with a header. eol defaults to CRLF to match the repo's existing CSVs.
function write(file, header, rows, eol = '\r\n') {
  fs.writeFileSync(file, [header, ...rows].map(r => r.map(esc).join(',')).join(eol) + eol);
}

module.exports = { esc, parseLine, read, write };
