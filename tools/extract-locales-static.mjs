#!/usr/bin/env node
/**
 * Statically extract the locale dictionaries registered by built client bundles:
 * resolves `ctx.locale.register(<ns>, { zh, en })` (and the per-locale form) by
 * brace-matching the object literals bound to the identifiers it references.
 *
 * Usage: node tools/extract-locales-static.mjs <node_modules/@deepseek-ai dir> <out.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.argv[2];
const outFile = process.argv[3] ?? 'locales-static.json';

/** Return the source text of the balanced `{...}` block starting at `start` (index of `{`). */
function matchBraces(text, start) {
  let depth = 0;
  let inString = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inTemplate = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++; } continue; }
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Evaluate an object literal that only contains strings/numbers/booleans. */
function evalLiteral(source) {
  const context = vm.createContext({});
  return vm.runInContext(`(${source})`, context, { timeout: 5000 });
}

const packagesDir = root;
const results = {};
const problems = [];

const pkgs = fs.readdirSync(packagesDir)
  .filter((name) => fs.existsSync(path.join(packagesDir, name, 'lib', 'client.js')));

for (const pkgName of pkgs) {
  const file = path.join(packagesDir, pkgName, 'lib', 'client.js');
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('locale.register')) continue;

  // identifier -> object literal (resolved iteratively so spreads of sibling
  // literals, e.g. `{ ...zoomEn, title: "..." }`, also evaluate)
  const rawLiterals = new Map();
  const objRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = objRe.exec(text))) {
    const braceStart = m.index + m[0].length - 1;
    const literal = matchBraces(text, braceStart);
    if (literal) rawLiterals.set(m[1], literal);
  }
  // identifier -> string/number/boolean literal (dictionary values may reference these)
  const strings = new Map();
  const strRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)\s*;/g;
  while ((m = strRe.exec(text))) {
    try { strings.set(m[1], evalLiteral(m[2])); } catch { /* ignore */ }
  }

  const objects = new Map();
  for (let pass = 0; pass < 12; pass++) {
    let progressed = false;
    for (const [name, literal] of rawLiterals) {
      if (objects.has(name)) continue;
      const context = vm.createContext({ ...Object.fromEntries(strings), ...Object.fromEntries(objects) });
      try {
        const value = vm.runInContext(`(${literal})`, context, { timeout: 5000 });
        if (value && typeof value === 'object' && !Array.isArray(value)) { objects.set(name, value); progressed = true; }
      } catch { /* unresolved reference or not a plain literal */ }
    }
    if (!progressed) break;
  }

  const regs = [];
  const regRe = /locale\.register\s*\(/g;
  while ((m = regRe.exec(text))) {
    let i = m.index + m[0].length;
    // first argument up to the first top-level comma
    let depth = 0;
    let start = i;
    let first = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') { if (depth === 0) break; depth--; }
      else if (ch === ',' && depth === 0) { first = text.slice(start, i); break; }
    }
    if (first === null) continue;
    i++; // past comma
    while (i < text.length && /\s/.test(text[i])) i++;
    let second = null;
    let third = null;
    if (text[i] === '"' || text[i] === "'") {
      // per-locale form: register(ns, 'ru', {...})
      const quote = text[i];
      const end = text.indexOf(quote, i + 1);
      second = text.slice(i + 1, end);
      i = end + 1;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === ',') { i++; while (i < text.length && /\s/.test(text[i])) i++; }
      if (text[i] === '{') third = matchBraces(text, i);
    } else if (text[i] === '{') {
      second = matchBraces(text, i);
    } else {
      // identifier object (e.g. dictionaries const)
      const idMatch = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
      if (idMatch) second = `__ref__${idMatch[0]}`;
    }
    if (second === null) continue;

    const resolveName = (raw) => {
      const trimmed = raw.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
        try { return evalLiteral(trimmed); } catch { return null; }
      }
      return strings.get(trimmed) ?? strings.get(trimmed.replace(/\$\d+$/, '')) ?? null;
    };
    const ns = resolveName(first);
    if (!ns) { problems.push([pkgName, `unresolved namespace: ${first.trim()}`]); continue; }

    let dicts = {};
    if (third !== null) {
      dicts[second] = evalLiteral(third);
    } else if (second.startsWith('__ref__')) {
      const value = objects.get(second.slice(7));
      if (value) dicts = value;
    } else {
      // object of identifier references: { zh: zh$1, en: en$1 }
      const body = second.slice(1, -1);
      for (const part of body.split(',')) {
        const trimmed = part.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (trimmed === '') continue;
        const kv = /^([\w$]+)\s*(?::\s*([\w$]+))?$/.exec(trimmed);
        if (!kv) continue;
        const value = objects.get(kv[2] ?? kv[1]);
        if (value) dicts[kv[1]] = value;
      }
    }
    regs.push({ ns, dicts });
  }
  if (regs.length) results[pkgName] = regs;
}

// merge registrations per namespace, preferring whichever has more keys
const merged = {};
for (const [pkg, regs] of Object.entries(results)) {
  for (const reg of regs) {
    merged[reg.ns] ??= { en: {}, zh: {}, sources: [] };
    merged[reg.ns].sources.push(pkg);
    for (const [locale, entries] of Object.entries(reg.dicts)) {
      if (typeof entries !== 'object' || entries === null) continue;
      merged[reg.ns][locale] ??= {};
      Object.assign(merged[reg.ns][locale], entries);
    }
  }
}

fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
const mergedFile = outFile.replace(/\.json$/, '-merged.json');
fs.writeFileSync(mergedFile, JSON.stringify(merged, null, 2));

let keys = 0;
for (const ns of Object.keys(merged)) keys += Object.keys(merged[ns].en).length;
console.log(`packages: ${Object.keys(results).length}`);
console.log(`namespaces: ${Object.keys(merged).length}`);
console.log(`english keys: ${keys}`);
console.log(`problems: ${problems.length}`);
for (const [pkg, msg] of problems.slice(0, 20)) console.log('  -', pkg, msg);
