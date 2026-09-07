/**
 * @file onto/index.js
 * @description The aimeat-onto library. Exposes AIMEAT.onto: what a record MEANS, beside the
 *   schema that says what shape it is.
 *
 *   TWO HALVES, AND THEY ARE INDEPENDENT. The first is types: a record carries an annotation
 *   saying what it IS (`schema:Person`, `aimeat:Task`), so an agent that has never seen your app
 *   knows what it found. The second is vocabularies: a SKOS concept scheme kept in ONE memory
 *   record, so "lintuharrastus", "birdwatching" and "ornitologia" are one concept with three
 *   labels rather than three strings that never match.
 *
 *   A VOCABULARY IS ONE KEY, NOT ONE KEY PER CONCEPT. `vocab.<id>` holds the whole scheme. Two
 *   thousand concepts fit in the 1024 kB a value gets, and the alternative crosses the 1000-key
 *   ceiling on the first serious import. If you are about to write a key per term, you have the
 *   shape wrong.
 *
 *   THE PREFIXES ARE THE NODE'S, NOT YOURS. Eight resolve without being declared, and the node
 *   REFUSES an annotation naming any other prefix that its own `@context` does not define — so an
 *   annotation this library builds is one the node will accept. Read them from `AIMEAT.onto.PREFIXES`
 *   or, with the definitions, from `GET /v1/ns`.
 *
 *   THIS LIBRARY KNOWS NO VOCABULARY SOURCE. Fetching from Finto, Wikidata or anywhere else is an
 *   extension's job, reached through cortex. Here a vocabulary is a record you loaded, wherever it
 *   came from.
 * @structure imports authFetch (session), attach (namespace);
 *   onto.PREFIXES · context() · expand() · describe() · typeOf() · isTyped()
 *   · scheme() · concept() · saveVocab() · vocab() → { get, search, label, broader, narrower,
 *     ancestors, isDeprecated, replacedBy, all, size }
 *   · core() · suggest()
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-onto.js"></script>
 *   const rec = AIMEAT.onto.describe({ name: 'Anna' }, 'schema:Person', { 'schema:knowsAbout': ['birds'] });
 *   const v = await AIMEAT.onto.vocab('hobbies');
 *   v.search('lintu', 'fi');   // → [{ id, prefLabel, … }]
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: types, the SKOS record shape, and reading a vocabulary.
 */
import { NODE_URL } from '../_core/config.js';
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-onto.js');
import { attach } from '../_core/namespace.js';

/**
 * The prefixes this node resolves without an annotation declaring them.
 *
 * MIRRORS `DEFAULT_CONTEXT` in src/utils/onto-context.ts, which is the authority; a unit test
 * (test/unit/onto-sdk-context.test.ts) fails when the two drift, because a library that promises a
 * prefix the node refuses is worse than one that promises nothing.
 * @type {Readonly<Record<string, string>>}
 */
const PREFIXES = Object.freeze({
  aimeat: 'https://aimeat.io/ns/',
  schema: 'https://schema.org/',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  qudt: 'http://qudt.org/schema/qudt/',
  saref: 'https://saref.etsi.org/core/',
});

/** A fresh copy of the default context, safe to spread into your own. */
function context(extra) {
  return Object.assign({}, PREFIXES, extra || {});
}

/**
 * 'schema:Person' → 'https://schema.org/Person'.
 * A bare term, an absolute IRI, or a prefix nobody declared comes back unchanged.
 * @param {string} term
 * @param {Record<string,string>} [ctx]
 * @returns {string}
 */
function expand(term, ctx) {
  const t = String(term || '');
  if (/^https?:\/\//i.test(t) || t.indexOf('urn:') === 0 || t.indexOf('did:') === 0) return t;
  const i = t.indexOf(':');
  if (i <= 0) return t;
  const base = (ctx || PREFIXES)[t.slice(0, i)];
  return base ? base + t.slice(i + 1) : t;
}

/**
 * Attach a semantic annotation to a value, returning a NEW object.
 *
 * The `@context` is written out only when you use a prefix outside the default eight, because the
 * node resolves the eight on its own and a context repeating them is noise in every record.
 *
 * @param {Record<string, any>} value  Your record. Not mutated.
 * @param {string} type               `'schema:Person'`, `'aimeat:Task'`, or a bare schema.org type.
 * @param {Record<string, any>} [props]  Ontology properties, e.g. `{ 'schema:knowsAbout': [...] }`.
 * @param {Record<string, string>} [prefixes]  Extra prefix → IRI mappings you use in `props`.
 * @returns {Record<string, any>}
 */
function describe(value, type, props, prefixes) {
  const out = Object.assign({}, value || {});
  if (type) out['@type'] = type;
  if (props) Object.assign(out, props);
  if (prefixes && Object.keys(prefixes).length) out['@context'] = context(prefixes);
  return out;
}

/** The `@type` of a value, or null. Never throws on a non-object. */
function typeOf(value) {
  if (!value || typeof value !== 'object') return null;
  const t = /** @type {any} */ (value)['@type'];
  return typeof t === 'string' ? t : (Array.isArray(t) && typeof t[0] === 'string' ? t[0] : null);
}

/**
 * Is this value one of these types? Compares EXPANDED forms, so `'schema:Person'` matches a record
 * written as `'https://schema.org/Person'` and vice versa.
 * @param {any} value
 * @param {string|string[]} type
 * @returns {boolean}
 */
function isTyped(value, type) {
  const t = typeOf(value);
  if (!t) return false;
  const want = Array.isArray(type) ? type : [type];
  const ctx = context((value && value['@context']) || undefined);
  const have = expand(t, ctx);
  return want.some(function (w) { return expand(w, ctx) === have; });
}

// ── Vocabularies ──────────────────────────────────────────────────────────────

/** Lowercased, for matching. Kept in one place so search and get agree on what "same" means. */
function norm(s) { return String(s == null ? '' : s).toLowerCase().trim(); }

/** Every label a concept carries, in every language, as a flat array of strings. */
function labelsOf(c) {
  const out = [];
  const add = (v) => {
    if (!v) return;
    if (typeof v === 'string') { out.push(v); return; }
    if (Array.isArray(v)) { v.forEach(add); return; }
    if (typeof v === 'object') Object.keys(v).forEach((k) => add(v[k]));
  };
  add(c['skos:prefLabel']);
  add(c['skos:altLabel']);
  return out;
}

/**
 * One label in the language asked for, falling back through English to whatever exists.
 * @param {Record<string, any>} c
 * @param {string} [lang]
 * @returns {string}
 */
function labelOf(c, lang) {
  if (!c) return '';
  const p = c['skos:prefLabel'];
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') {
    if (lang && p[lang]) return p[lang];
    if (p.en) return p.en;
    const first = Object.keys(p)[0];
    if (first) return p[first];
  }
  return c['@id'] || '';
}

/**
 * Build a SKOS concept scheme in the shape this platform stores.
 *
 * The whole scheme is ONE record. `concepts` is an array rather than a map because order is how a
 * person reads a vocabulary, and a map loses it.
 *
 * @param {{ id: string, label: Record<string,string>|string, description?: string, concepts?: any[] }} spec
 * @returns {Record<string, any>}
 */
function scheme(spec) {
  const s = spec || /** @type {any} */ ({});
  return {
    '@context': context(),
    '@type': 'skos:ConceptScheme',
    '@id': 'vocab:' + (s.id || ''),
    'skos:prefLabel': typeof s.label === 'string' ? { en: s.label } : (s.label || {}),
    'dcterms:description': s.description || undefined,
    'dcterms:modified': new Date().toISOString(),
    concepts: Array.isArray(s.concepts) ? s.concepts : [],
  };
}

/**
 * Build one concept for a scheme.
 *
 * `exactMatch` is the field that makes a private vocabulary worth having: point your `birdwatching`
 * at the YSO or Wikidata URI for the same idea, and two systems that never agreed on anything can
 * still tell they mean the same thing.
 *
 * @param {{ id: string, label: Record<string,string>|string, broader?: string, narrower?: string[],
 *   related?: string[], exactMatch?: string|string[], altLabel?: Record<string,string[]>,
 *   deprecated?: boolean, replacedBy?: string }} spec
 * @returns {Record<string, any>}
 */
function concept(spec) {
  const s = spec || /** @type {any} */ ({});
  /** @type {Record<string, any>} */
  const c = {
    '@id': s.id,
    '@type': 'skos:Concept',
    'skos:prefLabel': typeof s.label === 'string' ? { en: s.label } : (s.label || {}),
  };
  if (s.altLabel) c['skos:altLabel'] = s.altLabel;
  if (s.broader) c['skos:broader'] = s.broader;
  if (s.narrower && s.narrower.length) c['skos:narrower'] = s.narrower;
  if (s.related && s.related.length) c['skos:related'] = s.related;
  if (s.exactMatch) c['skos:exactMatch'] = s.exactMatch;
  // A concept that stopped meaning anything stays, pointing at what replaced it. Deleting it
  // breaks every record that referenced it and tells the reader nothing about why.
  if (s.deprecated) c['owl:deprecated'] = true;
  if (s.replacedBy) c['dcterms:isReplacedBy'] = s.replacedBy;
  return c;
}

/** The read-only view a caller gets back from vocab(). */
function makeVocabulary(id, doc) {
  const concepts = Array.isArray(doc && doc.concepts) ? doc.concepts : [];
  const byId = new Map();
  concepts.forEach(function (c) { if (c && c['@id']) byId.set(c['@id'], c); });

  /** One concept by its id, or null. */
  function get(uri) { return byId.get(uri) || null; }

  /**
   * Concepts whose label contains this text, in any language or one you name.
   * Substring, case-insensitive, prefLabel before altLabel. A local read: no network.
   * @param {string} q
   * @param {string} [lang]  Restrict matching to one language's labels.
   * @param {number} [limit]
   */
  function search(q, lang, limit) {
    const needle = norm(q);
    if (!needle) return [];
    const cap = limit || 50;
    const exact = [], starts = [], contains = [];
    for (const c of concepts) {
      const labels = lang
        ? [(c['skos:prefLabel'] || {})[lang], ...((c['skos:altLabel'] || {})[lang] || [])].filter(Boolean)
        : labelsOf(c);
      let best = -1;
      for (const l of labels) {
        const n = norm(l);
        if (!n) continue;
        if (n === needle) { best = 0; break; }
        if (n.indexOf(needle) === 0) { best = best < 0 || best > 1 ? 1 : best; }
        else if (n.indexOf(needle) > 0 && best < 0) { best = 2; }
      }
      if (best === 0) exact.push(c);
      else if (best === 1) starts.push(c);
      else if (best === 2) contains.push(c);
    }
    return exact.concat(starts, contains).slice(0, cap);
  }

  /** The concept one step up, or null. */
  function broader(uri) {
    const c = get(uri);
    return c && c['skos:broader'] ? get(c['skos:broader']) : null;
  }

  /**
   * The concepts one step down. Reads `skos:narrower` when the scheme declares it and otherwise
   * derives it from everyone's `skos:broader`, so a scheme that only wrote one direction still works.
   */
  function narrower(uri) {
    const c = get(uri);
    const declared = c && Array.isArray(c['skos:narrower']) ? c['skos:narrower'].map(get).filter(Boolean) : [];
    if (declared.length) return declared;
    return concepts.filter(function (k) { return k['skos:broader'] === uri; });
  }

  /**
   * Every concept above this one, nearest first. Cycle-safe: a scheme whose `broader` chain loops
   * stops at the repeat rather than hanging the page.
   */
  function ancestors(uri) {
    const out = [], seen = new Set([uri]);
    let cur = broader(uri);
    while (cur && !seen.has(cur['@id'])) { out.push(cur); seen.add(cur['@id']); cur = broader(cur['@id']); }
    return out;
  }

  function isDeprecated(uri) { const c = get(uri); return !!(c && c['owl:deprecated']); }

  /** What took this concept's place, when it was deprecated in favour of another. */
  function replacedBy(uri) {
    const c = get(uri);
    return c && c['dcterms:isReplacedBy'] ? get(c['dcterms:isReplacedBy']) : null;
  }

  return {
    id: id,
    doc: doc,
    label: function (uri, lang) { return labelOf(get(uri), lang); },
    schemeLabel: function (lang) { return labelOf(doc, lang); },
    get: get,
    search: search,
    broader: broader,
    narrower: narrower,
    ancestors: ancestors,
    isDeprecated: isDeprecated,
    replacedBy: replacedBy,
    all: function () { return concepts.slice(); },
    size: concepts.length,
  };
}

/**
 * Load a vocabulary. `vocab.<id>` from your own memory, or from another owner's public record when
 * you pass `owner`.
 *
 * @param {string} id
 * @param {{ owner?: string }} [opts]  `owner`: a GHII whose PUBLIC `vocab.<id>` to read instead.
 * @returns {Promise<ReturnType<typeof makeVocabulary>>}
 */
async function vocab(id, opts) {
  const key = 'vocab.' + String(id);
  const o = opts || {};
  let env;
  if (o.owner) {
    // The public read: no session at all, so a signed-out visitor can render a shared vocabulary.
    const res = await fetch(NODE_URL + '/v1/memory/' + encodeURIComponent(o.owner) + '/' + encodeURIComponent(key) + '?soft=1');
    env = await res.json();
  } else {
    env = await authFetch('/v1/memory/' + encodeURIComponent(key) + '?soft=1');
  }
  const doc = env && env.ok && env.data ? env.data.value : null;
  if (!doc) throw new Error('No vocabulary at ' + key + (o.owner ? ' for ' + o.owner : ''));
  return makeVocabulary(id, doc);
}

/**
 * Write a vocabulary back. Takes what `scheme()` builds, or a whole document you edited.
 * Public by default: a vocabulary nobody else can read is a vocabulary that shares nothing.
 * @param {string} id
 * @param {Record<string, any>} doc
 * @param {{ visibility?: 'public'|'private' }} [opts]
 */
async function saveVocab(id, doc, opts) {
  const body = {
    key: 'vocab.' + String(id),
    value: Object.assign({}, doc, { 'dcterms:modified': new Date().toISOString() }),
    visibility: (opts && opts.visibility) || 'public',
  };
  return authFetch('/v1/memory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

// ── The node's own core ───────────────────────────────────────────────────────

let _core = null;

/**
 * The AIMEAT core ontology: the classes and relations `aimeat:` names, each with its definition.
 * Fetched once and kept. Public, so it works signed out.
 * @returns {Promise<Record<string, any>>}
 */
async function core() {
  if (_core) return _core;
  const res = await fetch(NODE_URL + '/v1/ns', { headers: { Accept: 'application/ld+json' } });
  if (!res.ok) throw new Error('Could not read the core ontology (' + res.status + ')');
  _core = await res.json();
  return _core;
}

/**
 * Ask the model which concepts of a vocabulary a piece of text is about.
 *
 * The vocabulary is the harness: the model picks FROM it and does not invent, and anything it
 * returns that is not in the scheme is dropped here rather than trusted. Needs aimeat-ai.js and the
 * `ai:use` grant, and it spends the owner's AI budget like any other completion.
 *
 * @param {string} text
 * @param {string|ReturnType<typeof makeVocabulary>} vocabulary  A vocabulary id, or a loaded one.
 * @param {{ lang?: string, max?: number }} [opts]
 * @returns {Promise<Array<Record<string, any>>>}  The concepts it picked, in the scheme's own shape.
 */
async function suggest(text, vocabulary, opts) {
  const ai = window.AIMEAT && window.AIMEAT.ai;
  if (!ai) throw new Error('AIMEAT.ai is required. Include aimeat-ai.js before calling suggest().');
  const v = typeof vocabulary === 'string' ? await vocab(vocabulary) : vocabulary;
  const o = opts || {};
  const lang = o.lang || 'en';
  const max = o.max || 5;

  // The whole vocabulary goes into the prompt, labelled, so the model chooses rather than invents.
  const list = v.all().map(function (c) { return c['@id'] + ' = ' + labelOf(c, lang); }).join('\n');
  const prompt = 'Here is a vocabulary of concepts, one per line as "id = label":\n\n' + list
    + '\n\nHere is a piece of text:\n\n' + String(text)
    + '\n\nWhich of those concepts is the text about? Answer with at most ' + max
    + ' ids from the list above, one per line, and nothing else. If none of them fit, answer with the single word NONE.';

  const answer = await ai.complete(prompt);
  const said = String(answer && answer.text ? answer.text : answer || '');
  if (/^\s*NONE\s*$/i.test(said)) return [];

  const picked = [];
  said.split('\n').forEach(function (line) {
    const id = line.replace(/^[-*\d.\s]+/, '').split('=')[0].trim();
    // Anything the model returned that is not in the scheme is dropped: the vocabulary is the
    // constraint, and a plausible-looking invented id is exactly what it exists to prevent.
    const c = id && v.get(id);
    if (c && picked.indexOf(c) < 0) picked.push(c);
  });
  return picked.slice(0, max);
}

const onto = {
  PREFIXES: PREFIXES,
  context: context,
  expand: expand,
  describe: describe,
  typeOf: typeOf,
  isTyped: isTyped,
  scheme: scheme,
  concept: concept,
  vocab: vocab,
  saveVocab: saveVocab,
  core: core,
  suggest: suggest,
};

attach('onto', onto);
