#!/usr/bin/env node
/** Merge static + runtime dictionary extractions into one namespace map. */
import fs from 'node:fs';

const staticRegs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); // per-package registrations
const runtimeRegs = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const outFile = process.argv[4] ?? 'locales-merged.json';

const merged = { en: {}, zh: {}, sources: {} };

function absorb(pkg, regs, overwrite) {
  for (const reg of regs) {
    const ns = reg.ns;
    if (ns === '__language__') continue;
    merged.sources[ns] ??= new Set();
    merged.sources[ns].add(pkg);
    for (const [locale, entries] of Object.entries(reg.dicts ?? {})) {
      if (typeof entries !== 'object' || entries === null) continue;
      if (locale !== 'en' && locale !== 'zh') continue;
      merged[locale][ns] ??= {};
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value !== 'string') continue;
        if (overwrite || merged[locale][ns][key] === undefined) merged[locale][ns][key] = value;
      }
    }
  }
}

for (const [pkg, regs] of Object.entries(staticRegs)) absorb(pkg, regs, false);
for (const [pkg, regs] of Object.entries(runtimeRegs)) absorb(pkg, regs, false);

const summary = [];
for (const ns of Object.keys(merged.en).sort()) {
  const en = merged.en[ns] ?? {};
  const zh = merged.zh[ns] ?? {};
  const missingZh = Object.keys(en).filter((k) => !(k in zh));
  summary.push({ ns, keys: Object.keys(en).length, missingZh: missingZh.length, sources: [...(merged.sources[ns] ?? [])] });
}

const out = {};
for (const ns of Object.keys(merged.en)) {
  out[ns] = { en: merged.en[ns], zh: merged.zh[ns] ?? {} };
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
const totalKeys = summary.reduce((sum, row) => sum + row.keys, 0);
console.log(`namespaces: ${summary.length}, english keys: ${totalKeys}`);
for (const row of summary.sort((a, b) => b.keys - a.keys)) {
  console.log(`${String(row.keys).padStart(5)}  ${row.ns}${row.missingZh ? `  (no zh for ${row.missingZh})` : ''}`);
}
