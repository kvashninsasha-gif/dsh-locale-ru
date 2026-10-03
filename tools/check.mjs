#!/usr/bin/env node
/**
 * Verify the committed state of the language pack:
 *   1. every English source key has a Russian translation with intact placeholders;
 *   2. lib/client.js is exactly what the sources generate (no stale bundle);
 *   3. the bundle registers the language and every namespace when it is applied.
 *
 *   node tools/check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSources, repoRoot, renderClient, validate } from './lib/sources.mjs';
import { testPack } from './lib/pack-runtime.mjs';

const failures = [];
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const { en, ru } = loadSources();
const report = validate(en, ru);

if (report.missing.length) failures.push(`missing translations: ${report.missing.slice(0, 10).join(', ')}`);
if (report.unknown.length) failures.push(`unknown keys: ${report.unknown.slice(0, 10).join(', ')}`);
if (report.empty.length) failures.push(`empty translations: ${report.empty.slice(0, 10).join(', ')}`);
if (report.placeholders.length) failures.push(`placeholder mismatches: ${report.placeholders.slice(0, 5).join(' | ')}`);

const expected = renderClient(pkg.name, ru);
const committed = fs.readFileSync(path.join(repoRoot, 'lib', 'client.js'), 'utf8');
if (committed !== expected) failures.push('lib/client.js is stale — run `npm run build`');

if (pkg.dsh?.bundle?.patch === undefined) failures.push('package.json declares no dsh.bundle.patch');
if (pkg.dsh?.client?.platform !== 'web') failures.push('package.json declares no web client half');
if (pkg.private === true) failures.push('package.json is still private');
for (const file of ['cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE', 'lib/client.js', 'lib/index.js']) {
  if (!fs.existsSync(path.join(repoRoot, file))) failures.push(`missing file: ${file}`);
}

const runtime = testPack(committed, { en, ru, packageName: pkg.name });
failures.push(...runtime.failures);

const patch = fs.readFileSync(path.join(repoRoot, 'cordis.patch.yml'), 'utf8');
if (!patch.includes(`name: ${JSON.stringify(pkg.name)}`) && !patch.includes(`name: ${pkg.name}`)) {
  failures.push('cordis.patch.yml does not mount the package row under its own name');
}

console.log(`package:    ${pkg.name}@${pkg.version}`);
console.log(`strings:    ${report.total} (${Object.keys(ru).length} namespaces)`);
console.log(`bundled:    ${(Buffer.byteLength(committed) / 1024).toFixed(0)} KiB`);
console.log(`runtime:    language ${runtime.language}, ${runtime.registrations} namespaces registered`);
if (runtime.samples.length) console.log(`samples:    ${runtime.samples.join(' · ')}`);
if (runtime.identical?.length) console.log(`identical:  ${runtime.identical.length} single-token strings equal the English source (${runtime.identical.slice(0, 5).join(', ')})`);
if (failures.length) {
  console.error('FAILURES:');
  for (const failure of failures) console.error('  -', failure);
  process.exit(1);
}
console.log('CHECK OK');
