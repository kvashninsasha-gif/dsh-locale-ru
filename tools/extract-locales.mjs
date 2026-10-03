#!/usr/bin/env node
/**
 * Extract every locale dictionary a client plugin registers, by executing the
 * built bundle inside a VM with a stubbed `window.__ModuleLoader__` + `require`
 * and a recording client context.
 *
 * Usage: node tools/extract-locales.mjs <node_modules/@deepseek-ai dir> <out.json>
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

const root = process.argv[2];
const outFile = process.argv[3] ?? 'locales-extract.json';

function makeAny(label = 'any') {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString') return () => `[${label}]`;
      if (prop === 'valueOf') return () => 0;
      if (prop === Symbol.iterator) return undefined;
      if (prop === Symbol.asyncIterator) return undefined;
      if (prop === '$$typeof') return Symbol.for('react.element');
      if (prop === 'nodeType') return 1;
      if (prop === 'length') return 0;
      if (prop === 'name') return label;
      if (prop === 'displayName') return label;
      if (prop === 'props') return {};
      if (prop === 'children') return [];
      return makeAny(`${label}.${String(prop)}`);
    },
    set() { return true; },
    apply() { return makeAny(`${label}()`); },
    construct() { return makeAny(`new ${label}`); },
    has() { return true; },
  });
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  process: { env: {}, platform: 'darwin' },
  navigator: makeAny('navigator'),
  location: makeAny('location'),
  history: makeAny('history'),
  localStorage: makeAny('localStorage'),
  sessionStorage: makeAny('sessionStorage'),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  matchMedia: () => makeAny('mediaQueryList'),
  getComputedStyle: () => makeAny('style'),
  document: makeAny('document'),
  TextEncoder,
  TextDecoder,
  crypto: webcrypto,
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  Event,
  EventTarget,
  CustomEvent: class CustomEvent extends Event {},
  MessageChannel,
  MessageEvent: class MessageEvent extends Event {},
  DOMException,
  performance,
  structuredClone,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  fetch: () => Promise.resolve(makeAny('response')),
  __DSH_LOCALE__: undefined,
  HTMLElement: class HTMLElement {},
  Element: class Element {},
  Node: class Node {},
  MutationObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
};

let loaded = null;
sandbox.__ModuleLoader__ = { load(entry) { loaded = entry; } };
const windowProxy = new Proxy(sandbox, {
  get(t, prop) { return prop in t ? t[prop] : makeAny(`window.${String(prop)}`); },
  set(t, prop, value) { t[prop] = value; return true; },
});
sandbox.window = windowProxy;
sandbox.self = windowProxy;
sandbox.globalThis = windowProxy;

const packagesDir = root;
const results = {};
const failures = [];

const pkgs = fs.readdirSync(packagesDir)
  .filter((name) => fs.existsSync(path.join(packagesDir, name, 'lib', 'client.js')));

for (const pkgName of pkgs) {
  const file = path.join(packagesDir, pkgName, 'lib', 'client.js');
  const code = fs.readFileSync(file, 'utf8');
  loaded = null;
  const context = vm.createContext(sandbox);
  const registrations = [];
  try {
    vm.runInContext(code, context, { filename: file, timeout: 30000 });
    if (!loaded) { failures.push([pkgName, 'no __ModuleLoader__.load call']); continue; }
    const exportsObj = loaded.factory((id) => makeAny(`require(${id})`));
    if (typeof exportsObj?.apply !== 'function') continue;

    const locale = {
      register(ns, a, b) {
        if (typeof a === 'string') registrations.push({ ns, dicts: { [a]: b } });
        else registrations.push({ ns, dicts: a });
        return () => {};
      },
      bind: () => (key) => key,
      resolveText: (text) => (typeof text === 'string' ? text : text?.en ?? text),
      addLanguage: (input) => { registrations.push({ ns: '__language__', dicts: { language: input } }); return () => {}; },
      getSnapshot: () => ({ active: 'en', locales: [{ id: 'en', label: 'English' }], revision: 0 }),
      subscribe: () => () => {},
    };
    const ctx = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'locale') return locale;
        if (prop === 'effect') return (fn) => { try { const d = fn?.(); return typeof d === 'function' ? d : () => {}; } catch { return () => {}; } };
        if (prop === 'inject') return (deps, cb) => {
          if (typeof deps === 'function') { try { deps(makeAny('scope')); } catch {} }
          else if (typeof cb === 'function') { try { cb(makeAny('scope')); } catch {} }
          else if (typeof deps === 'function') { try { deps(); } catch {} }
        };
        if (prop === 'provide') return () => {};
        if (prop === 'on') return () => () => {};
        if (prop === 'fiber') return { uid: 1 };
        if (prop === 'configForms') return makeAny('configForms');
        return makeAny(`ctx.${String(prop)}`);
      },
    });
    try {
      const maybe = exportsObj.apply(ctx);
      if (maybe && typeof maybe.then === 'function') maybe.catch(() => {});
    } catch (error) {
      failures.push([pkgName, `apply threw: ${error?.message}`]);
    }
    if (registrations.length) results[pkgName] = registrations;
  } catch (error) {
    failures.push([pkgName, `load failed: ${error?.message}`]);
  }
}

fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
let keys = 0;
let nsCount = 0;
for (const regs of Object.values(results)) {
  for (const reg of regs) {
    nsCount++;
    keys += Object.keys(reg.dicts.en ?? {}).length;
  }
}
console.log(`packages with dictionaries: ${Object.keys(results).length}/${pkgs.length}`);
console.log(`registrations: ${nsCount}, english keys: ${keys}`);
const missing = pkgs.filter((p) => !results[p]);
console.log(`packages without captured dicts (${missing.length}):`);
for (const m of missing) console.log('  -', m);
if (failures.length) {
  console.log(`failures (${failures.length}):`);
  for (const [pkg, msg] of failures) console.log('  -', pkg, msg);
}
