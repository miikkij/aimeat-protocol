/**
 * @file living/validate-lang.js
 * @description EVERY WAY A RECORD'S OWN WORDS CAN BE WRONG, NAMED BEFORE ANYTHING RENDERS. A living
 *   record carries its own words — any human-facing string may be `{ fi: …, en: … }` — and the whole
 *   point of that is a document nobody has to translate after mounting. The cost is a new class of
 *   mistake that is invisible on the screen you happen to be looking at: a language map with no
 *   language in it, an option whose label is an object, a sentence that reads `dew` in Finnish and
 *   not in English. The last of those is the reason this file exists as its own set of checks rather
 *   than as a shape test: the document says two different things depending on who opens it, and the
 *   missing half is exactly what nobody notices.
 *
 *   WHICH FIELDS ARE LOOKED AT IS describe()'s OWN ANSWER — `NODES[type].languages`, generated from
 *   each node module's `@languages` line — so a node type that later gains a translatable field is
 *   checked here without anybody remembering to come back and add it.
 *
 *   PURE EXTRACTION from index.js on 2026-09-06, when the hooks arrived and the front door came
 *   close to the 800-line ceiling. Nothing changed on the way: same functions, same words, same
 *   order of refusals.
 * @structure nodeLanguageRefusals · machineLanguageRefusals · templateLanguageRefusals ·
 *   propLanguageRefusals
 * @usage  import { nodeLanguageRefusals } from './validate-lang.js';
 * @version-history
 *   v0.6.0 — 2026-09-06 — Extracted verbatim from living/index.js (the 800-line ceiling).
 */
import { NODES } from './describe-data.js';
import { parseTemplate, symbolsOfTemplate } from './text.js';
import { TEXT_KEYS, isPlainObject, langKeysOf, langMapError } from './i18n.js';

/**
 * Every language map in one node, refused by name where it is not one.
 * @param {string} id @param {any} node @param {string[]} out
 */
export function nodeLanguageRefusals(id, node, out) {
  for (const field of ((NODES[String(node.type)] || {}).languages || [])) {
    // The machine's line names its assignments in words rather than as a field path; those are
    // walked below, where the states are.
    if (/[^A-Za-z0-9_[\].]/.test(field)) continue;
    const perItem = /^([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_]+)$/.exec(field);
    if (perItem) {
      const items = node[perItem[1]];
      if (!Array.isArray(items)) continue;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object') continue;
        const bad = langMapError(item[perItem[2]]);
        if (bad) out.push('Option ' + (i + 1) + ' of "' + id + '" has a ' + perItem[2] + ' that ' + bad + '.');
      }
      continue;
    }
    const bad = langMapError(node[field]);
    if (bad) out.push('Node "' + id + '" has a ' + field + ' that ' + bad + '.');
  }
}

/** The words a machine's entry and exit actions write, refused where a map has no language in it. */
export function machineLanguageRefusals(id, node, out) {
  const walk = (states, prefix) => {
    for (const name of Object.keys(states || {})) {
      const state = states[name] || {};
      const path = prefix ? prefix + '.' + name : name;
      for (const kind of ['entry', 'exit']) {
        for (const target of Object.keys(state[kind] || {})) {
          const bad = langMapError(state[kind][target]);
          if (bad) {
            out.push('The ' + kind + ' of "' + id + '" at ' + path + ' writes a ' + target
              + ' that ' + bad + '.');
          }
        }
      }
      if (state.states) walk(state.states, path);
    }
  };
  walk(node.states, '');
}

/**
 * A SENTENCE CARRIES THE SAME HOLES IN EVERY LANGUAGE IT IS WRITTEN IN. The Finnish and the
 * English are composed separately — that is the point — but if one of them reads `dew` and the
 * other does not, the document says two different things depending on who opens it, and the
 * missing half is exactly what nobody notices. So the symbols are compared by name and the
 * refusal says WHICH node and WHICH language.
 * @param {string} id @param {any} node @param {string[]} out
 */
export function templateLanguageRefusals(id, node, out) {
  const bad = langMapError(node.template);
  if (bad) { out.push('The sentence "' + id + '" has a template that ' + bad + '.'); return; }
  if (!isPlainObject(node.template)) return;
  const perLang = new Map();
  for (const lang of langKeysOf(node.template)) {
    const parts = parseTemplate(node.template[lang]);
    if (!Array.isArray(parts)) {
      out.push('The sentence "' + id + '" cannot be read in ' + lang + ': ' + parts.error);
      continue;
    }
    perLang.set(lang, symbolsOfTemplate(parts).map((s) => s.split('.')[0]));
  }
  const every = [];
  for (const [, list] of perLang) for (const s of list) if (every.indexOf(s) < 0) every.push(s);
  for (const [lang, list] of perLang) {
    for (const s of every) {
      if (list.indexOf(s) >= 0) continue;
      out.push('The sentence "' + id + '" reads "' + s + '" in one language and not in ' + lang
        + '. A sentence carries the same holes in every language it is written in.');
    }
  }
}

/** Every language map in a block's props, however deep, refused where it has no language in it. */
export function propLanguageRefusals(blockId, props, out, path) {
  if (Array.isArray(props)) {
    props.forEach((p, i) => propLanguageRefusals(blockId, p, out, path + '[' + i + ']'));
    return;
  }
  if (!isPlainObject(props)) return;
  for (const key of Object.keys(props)) {
    const at = props[key];
    const where = (path ? path + '.' : '') + key;
    if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(at)) {
      const bad = langMapError(at);
      if (bad) out.push('Block "' + blockId + '" has a ' + where + ' that ' + bad + '.');
      continue;
    }
    if (isPlainObject(at) || Array.isArray(at)) propLanguageRefusals(blockId, at, out, where);
  }
}
