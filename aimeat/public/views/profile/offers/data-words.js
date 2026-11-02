/**
 * @file public/views/profile/offers/data-words.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sentences a data package's own facts are said with in the page's language: the
 *   title, description and attribution in the reader's language (the package's `aimeat.i18n`, falling
 *   back to the base fields), the note of a version built by a data product (from its sources and
 *   counts, not the English `changes` the node keeps for an AI), the transformations of a build (from
 *   the node's fixed English forms, said again through t(); an unknown form passes as it is), and the
 *   licence: its name, its deed and one sentence of what a reader may and must do. Pure functions,
 *   so the public dataset page, the product page and the recipient page say the same thing.
 * @structure pageLang · wordsOf · versionNote · transformWords · purposeWords · licenceOf · shortLicence ·
 *   LICENCE_URLS
 * @usage const w = wordsOf(descriptor);   // { title, description, attribution }
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP10e A1-A3, B4).
 */
import { getLocale } from '/js/i18n.js';
import { num } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { d } from './data-model.js';

/** The page's language as a two-letter code. */
export const pageLang = () => String(getLocale() || 'en').slice(0, 2).toLowerCase();

/**
 * The words of a package in the reader's language: `i18n[lang]` field by field, else the base field.
 * `src` is a descriptor ({ title, description, aimeat: { i18n, attribution } }) or a flat object
 * ({ title, description, attribution, i18n }), as the recipient page's preview answers.
 */
export function wordsOf(src, lang = pageLang()) {
  const a = src?.aimeat || {};
  const i18n = src?.i18n || a.i18n || {};
  const own = i18n[lang] || {};
  return {
    title: own.title || src?.title || '',
    description: own.description || src?.description || '',
    attribution: own.attribution || src?.attribution || a.attribution || '',
  };
}

/** The deeds of the licences the wizard offers, as services/datapackage/licences.ts names them. */
export const LICENCE_URLS = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
const LICENCE_KEYS = { 'CC-BY-4.0': 'ccBy', 'CC0-1.0': 'cc0', proprietary: 'contract' };

/**
 * A package's licence for a reader: its id, its name in the page's language, its deed and the sentence
 * of what a reader may do and must do; null when it names none. A licence this page does not know keeps
 * the name the package gave it, and the address the package gave.
 */
export function licenceOf(descriptor) {
  const entry = descriptor?.licenses?.[0];
  const id = descriptor?.aimeat?.license || entry?.name || '';
  if (!id) return null;
  const key = LICENCE_KEYS[Object.keys(LICENCE_KEYS).find((k) => k.toLowerCase() === id.toLowerCase())];
  const url = entry?.path || LICENCE_URLS[Object.keys(LICENCE_URLS).find((k) => k.toLowerCase() === id.toLowerCase())]
    || (/^https?:\/\//.test(id) ? id : '');
  return {
    id,
    name: key ? d('licence.name.' + key) : (entry?.title || id),
    url,
    rule: key ? d('licence.rule.' + key) : '',
  };
}

/** A licence in a figure or a row: its short form ("CC BY 4.0"), or its name. */
export const shortLicence = (l) => (l ? (/\(([^)]+)\)\s*$/.exec(l.name)?.[1] || l.name) : '');

/** A source of a build in a few words: "A (file)". */
const sourceWords = (s) => `${s.id} (${d('kindShort.' + s.kind)})`;

/**
 * The note of one version in the page's language. A data product build is said from its facts (its
 * sources, rows and tables); a row that records the package coming back to earlier bytes says so, with
 * the number of the version it came back to; anything else keeps the producer's own words.
 * @param {object} v a row of GET /v1/datapackages/{owner}/{name}/versions
 * @param {Array} versions the whole list, newest first, for the number of an earlier row
 */
export function versionNote(v, versions = []) {
  if (v.returnedFrom) {
    const i = versions.findIndex((x) => x !== v && x.contentHash === v.contentHash && !x.returnedFrom);
    return d('note.returned', { version: i < 0 ? '?' : versions.length - i });
  }
  if (v.producer === 'dataproduct' && Array.isArray(v.sources) && v.sources.length) {
    return d('note.built', {
      sources: v.sources.map(sourceWords).join(', '),
      rows: d('note.rows', { n: num(v.rowCount || 0) }),
      tables: d('note.tables', { n: v.resources || 1 }),
    });
  }
  return v.changes || '';
}

/**
 * A share's purpose in the page's language. The node writes the purpose of a share an EXCHANGE purchase
 * made in English with the offering and the purchase ids (services/exchange-party-buy.ts); the page says
 * it from the share's contract. Any other purpose is the owner's own words.
 */
export function purposeWords(share) {
  const p = String(share?.purpose || '');
  if (share?.contract && /^Bought on EXCHANGE \(/.test(p)) return d('share.bought');
  return p;
}

const OP_WORDS =['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'];

/**
 * One transformation of a build in the page's language. The node writes them in fixed English forms
 * (services/dataproduct/combine.ts); each is read back to its facts and said through t(). A form this
 * page does not know is shown as the node wrote it.
 */
export function transformWords(what) {
  const s = String(what || '');
  let m = /^renamed (\S+) to (.+)$/.exec(s);
  if (m) return d('transform.renamed', { from: m[1], to: m[2] });
  m = /^kept the rows where (\S+) (eq|ne|gt|gte|lt|lte|contains|in) (.+)$/.exec(s);
  if (m && OP_WORDS.includes(m[2])) {
    let value = m[3];
    try { const v = JSON.parse(m[3]); value = Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? num(v) : String(v); }
    catch (err) { swallowed('data-words: the filter value is not JSON, shown as written', err); }
    return d('transform.kept', { column: m[1], op: m[2] === 'in' ? d('transform.opIn') : d('cols.op.' + m[2]), value });
  }
  m = /^left out (\S+), which the data map marks personal$/.exec(s);
  if (m) return d('transform.personalOut', { column: m[1] });
  m = /^union of (.+)$/.exec(s);
  if (m) return d('transform.union', { ids: m[1] });
  m = /^left join of (\S+) with (\S+) on (\S+) = (\S+)$/.exec(s);
  if (m) return d('transform.join', { left: m[1], right: m[2], key: `${m[3]} = ${m[4]}` });
  return s;
}
