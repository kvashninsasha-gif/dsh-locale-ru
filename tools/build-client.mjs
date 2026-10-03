#!/usr/bin/env node
/**
 * Regenerate lib/client.js from source/en.json + source/ru.json.
 *
 *   node tools/build-client.mjs
 *
 * Fails loudly (and writes nothing) when the translation is incomplete, when a
 * key is unknown, or when an ICU placeholder no longer matches the English
 * source. The ModuleLoader id is taken from package.json's name, because the
 * host matches a served bundle to its package by that id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSources, repoRoot, renderClient, validate } from './lib/sources.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const { en, ru } = loadSources();
const report = validate(en, ru);

const namespaces = Object.keys(ru).length;
console.log(`namespaces: ${namespaces}`);
console.log(`strings:    ${report.total - report.missing.length}/${report.total}`);

const problems = [];
if (report.missing.length) problems.push(`missing translations (${report.missing.length}): ${report.missing.slice(0, 10).join(', ')}`);
if (report.unknown.length) problems.push(`keys absent from the English source (${report.unknown.length}): ${report.unknown.slice(0, 10).join(', ')}`);
if (report.empty.length) problems.push(`empty translations (${report.empty.length}): ${report.empty.slice(0, 10).join(', ')}`);
if (report.placeholders.length) problems.push(`placeholder mismatches (${report.placeholders.length}): ${report.placeholders.slice(0, 5).join(' | ')}`);
if (problems.length) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}

const bundle = renderClient(pkg.name, ru);
fs.writeFileSync(path.join(repoRoot, 'lib', 'client.js'), bundle);
console.log(`wrote lib/client.js (${(Buffer.byteLength(bundle) / 1024).toFixed(0)} KiB) for ${pkg.name}`);
