/**
 * Shared dictionary loading and validation for the Russian language pack.
 *
 * `source/en.json` is the extracted English (and Chinese) source: one entry per
 * namespace, `{ en: { key: text }, zh: { key: text } }`. `source/ru.json` holds
 * the Russian translations in the same namespace shape, one string per key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sourceDir = path.join(repoRoot, 'source');

/** Load the English source dictionaries and the Russian translations. */
export function loadSources() {
  const en = JSON.parse(fs.readFileSync(path.join(sourceDir, 'en.json'), 'utf8'));
  const ru = JSON.parse(fs.readFileSync(path.join(sourceDir, 'ru.json'), 'utf8'));
  return { en, ru };
}

/**
 * Compare the translation against the extracted source.
 * @param en - extracted English/Chinese dictionaries.
 * @param ru - Russian translations.
 * @returns lists of missing keys, unknown keys, empty values and placeholder mismatches.
 */
export function validate(en, ru) {
  const missing = [];
  const unknown = [];
  const empty = [];
  const placeholders = [];
  let total = 0;

  for (const [ns, dicts] of Object.entries(en)) {
    for (const [key, english] of Object.entries(dicts.en ?? {})) {
      total++;
      const value = ru[ns]?.[key];
      if (typeof value !== 'string') { missing.push(`${ns}.${key}`); continue; }
      // a separator constant may legitimately be empty or whitespace, but only
      // when the English source is empty too
      if (value.trim() === '' && english.trim() !== '') empty.push(`${ns}.${key}`);
      const expected = [...english.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      const actual = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      if (expected.join(',') !== actual.join(',')) {
        placeholders.push(`${ns}.${key}: expected {${expected.join('} {')}}, got {${actual.join('} {')}}`);
      }
    }
  }
  for (const [ns, dict] of Object.entries(ru)) {
    for (const key of Object.keys(dict)) {
      if (!(key in (en[ns]?.en ?? {}))) unknown.push(`${ns}.${key}`);
    }
  }
  return { total, missing, unknown, empty, placeholders };
}

/**
 * Render the browser half: one `ctx.locale.register(ns, 'ru', dict)` call per
 * namespace, behind the shipped module-loader contract.
 * @param packageName - the ModuleLoader id, which must equal the package name.
 * @param ru - Russian translations per namespace.
 * @returns the bundle source.
 */
export function renderClient(packageName, ru) {
  return `window.__ModuleLoader__.load({
	id: ${JSON.stringify(packageName)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region lib/language.js
		/** The language definition this pack registers. */
		const LANGUAGE = { id: "ru", label: "Русский", fallback: "en" };
		/** Russian dictionaries, keyed by namespace. */
		const DICTIONARIES = ${JSON.stringify(ru)};
		//#endregion
		//#region lib/index.js
		/** Required service: the locale registry. */
		const inject = ["locale"];
		/**
		* Register the Russian language and one Russian dictionary per namespace.
		* Lookup falls back ru -> en per key, so untranslated keys stay English.
		* @param ctx - client root context carrying the locale service.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const disposers = [ctx.locale.addLanguage(LANGUAGE)];
				for (const [ns, dict] of Object.entries(DICTIONARIES)) disposers.push(ctx.locale.register(ns, LANGUAGE.id, dict));
				return () => {
					for (const dispose of disposers.reverse()) dispose();
				};
			}, "locale-ru: language and dictionaries");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
`;
}
