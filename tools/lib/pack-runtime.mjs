/**
 * A self-contained runtime harness for the built pack: it evaluates lib/client.js
 * exactly as the browser module loader does, applies the plugin against a stub
 * locale registry, and checks the registrations and the ru -> en lookup.
 *
 * No copy of DeepSeek Harness is required; the stub implements the slice of the
 * `locale` service the pack uses (`addLanguage`, `register`) plus the documented
 * fallback behaviour.
 */
import vm from 'node:vm';

/** Evaluate one served bundle and return its plugin surface. */
function evaluate(bundle, packageName) {
  let loaded;
  const sandbox = {
    console,
    __ModuleLoader__: { load(entry) { loaded = entry; } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(bundle, vm.createContext(sandbox), { filename: `${packageName}/lib/client.js` });
  if (loaded === undefined) throw new Error('the bundle never called window.__ModuleLoader__.load');
  return { id: loaded.id, plugin: loaded.factory(() => { throw new Error('the pack must not require() anything'); }) };
}

/**
 * Apply the pack and probe the resulting registry.
 * @param bundle - lib/client.js source.
 * @param options.en - extracted English dictionaries.
 * @param options.ru - Russian translations.
 * @param options.packageName - the id the bundle must declare.
 * @returns failures plus a short summary of what was registered.
 */
export function testPack(bundle, { en, ru, packageName }) {
  const failures = [];
  const samples = [];
  const catalog = new Map([['en', { id: 'en', label: 'English' }], ['zh', { id: 'zh', label: '中文', fallback: 'en' }]]);
  const dicts = new Map();
  let registrations = 0;

  const locale = {
    addLanguage(input) {
      if (catalog.has(input.id)) { failures.push(`language ${input.id} is already registered`); return () => {}; }
      if (!catalog.has(input.fallback)) failures.push(`fallback ${input.fallback} is not registered`);
      catalog.set(input.id, input);
      return () => catalog.delete(input.id);
    },
    register(ns, id, dict) {
      const key = `${ns}\0${id}`;
      if (dicts.has(key)) { failures.push(`namespace ${ns} already has a ${id} dictionary`); return () => {}; }
      dicts.set(key, dict);
      registrations++;
      return () => dicts.delete(key);
    },
    /** The documented lookup: active language, then its fallback chain, then common, then the key. */
    translate(ns, key) {
      const chain = [active];
      for (let next = catalog.get(active)?.fallback; next !== undefined; next = catalog.get(next)?.fallback) chain.push(next);
      const lookup = (target, name) => dicts.get(`${target}\0${active === target ? active : 'en'}`)?.[name];
      for (const target of chain) {
        const value = dicts.get(`${ns}\0${target}`)?.[key];
        if (value !== undefined) return value;
        void lookup;
      }
      for (const target of chain) {
        const value = dicts.get(`common\0${target}`)?.[key];
        if (value !== undefined) return value;
      }
      return key;
    },
  };

  let active = 'en';
  let entry;
  try {
    entry = evaluate(bundle, packageName);
  } catch (error) {
    return { failures: [error.message], language: '—', registrations: 0, samples };
  }
  if (entry.id !== packageName) failures.push(`bundle id is ${entry.id}, expected ${packageName}`);
  if (entry.plugin === undefined || typeof entry.plugin.apply !== 'function') {
    return { failures: [...failures, 'the bundle exports no apply()'], language: '—', registrations: 0, samples };
  }
  if (!Array.isArray(entry.plugin.inject) || !entry.plugin.inject.includes('locale')) failures.push('the plugin does not declare inject: [\'locale\']');

  let disposer;
  const ctx = {
    locale,
    effect(callback) {
      const result = callback();
      if (typeof result !== 'function') failures.push('the plugin effect returned no disposer');
      return result ?? (() => {});
    },
  };
  // the pack registers through one effect; keep its disposer for the disposal probe
  const originalEffect = ctx.effect;
  ctx.effect = (callback) => { disposer = originalEffect(callback); return disposer; };
  try {
    entry.plugin.apply(ctx);
  } catch (error) {
    failures.push(`apply threw: ${error.message}`);
  }

  const language = catalog.get('ru');
  if (language === undefined) failures.push('the pack registered no ru language');
  else {
    if (language.label !== 'Русский') failures.push(`ru label is ${JSON.stringify(language.label)}`);
    if (language.fallback !== 'en') failures.push(`ru fallback is ${JSON.stringify(language.fallback)}`);
  }

  // every source namespace must arrive with every key
  let covered = 0;
  for (const [ns, dictsOfNs] of Object.entries(en)) {
    const expectedKeys = Object.keys(dictsOfNs.en ?? {});
    if (expectedKeys.length === 0) continue;
    const registered = dicts.get(`${ns}\0ru`);
    if (registered === undefined) { failures.push(`namespace ${ns} was not registered`); continue; }
    const missing = expectedKeys.filter((key) => typeof registered[key] !== 'string');
    if (missing.length) failures.push(`namespace ${ns} misses ${missing.length} keys (e.g. ${missing[0]})`);
    else covered += expectedKeys.length;
  }

  active = 'ru';
  const identical = [];
  for (const [ns, dictsOfNs] of Object.entries(en)) {
    for (const [key, english] of Object.entries(dictsOfNs.en ?? {})) {
      if (english.trim() === '' || english.includes('{')) continue;
      const value = locale.translate(ns, key);
      if (value === key) { failures.push(`${ns}.${key} resolved to the raw key`); continue; }
      if (value === english) {
        // Product names, protocol names and single tokens (OK, px, JSON…) are
        // legitimately identical in Russian; they are reported, not failed.
        identical.push(`${ns}.${key} = ${JSON.stringify(english)}`);
        continue;
      }
      if (samples.length < 3) samples.push(`${ns}.${key} → ${value}`);
    }
  }

  // English fallback for a key the pack does not carry
  dicts.set('chat\0en', { ...(dicts.get('chat\0en') ?? {}), 'probe.onlyEnglish': 'English only' });
  if (locale.translate('chat', 'probe.onlyEnglish') !== 'English only') failures.push('English fallback is broken');

  // disabling the pack must remove the language and every dictionary
  if (typeof disposer === 'function') {
    disposer();
    if (catalog.has('ru')) failures.push('disposal left the ru language registered');
    if ([...dicts.keys()].some((key) => key.endsWith('\0ru'))) failures.push('disposal left ru dictionaries registered');
  } else {
    failures.push('no disposer was captured');
  }

  void covered;
  void ru;
  return {
    failures,
    language: language === undefined ? '—' : `${language.id} (${language.label})`,
    registrations,
    samples,
    identical,
  };
}
