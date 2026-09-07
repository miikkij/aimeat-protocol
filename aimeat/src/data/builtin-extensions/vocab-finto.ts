/**
 * @file src/data/builtin-extensions/vocab-finto.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `vocab-finto`: the door to Finto, the National Library of Finland's vocabulary
 *   service, and through it to YSO — a general Finnish ontology of some 30 000 concepts in Finnish,
 *   Swedish and English, published under CC BY 4.0.
 *
 *   WHY AN EXTENSION AND NOT A ROUTE IN THE CORE. Three reasons, and the third decides it. A
 *   browser cannot call api.finto.fi at all: the node's own content policy stops the page. The core
 *   would need a config key, an entry in the admin dashboard and a decision about caching, every one
 *   of which the extension namespace already answers. And YSO is ONE vocabulary source among many:
 *   baked into the core, this node would be taking a position on Finnish library science, while as
 *   an extension it is honestly a choice an operator makes, and somebody installs a Wikidata source
 *   beside it without asking anyone.
 *
 *   IT FETCHES, IT DOES NOT DECIDE. This extension returns what Finto says. Which concepts a person
 *   keeps, and under what id, is `AIMEAT.onto.saveVocab` in their own memory — so the vocabulary an
 *   app reads is the owner's record, not a live dependency on someone else's uptime. `scheme` exists
 *   to make that one step: hand it the URIs somebody picked and it returns the SKOS document ready
 *   to save, with `skos:exactMatch` pointing back at YSO.
 *
 *   THE CACHE IS BOUNDED, ON PURPOSE. Two keys, never one per concept: `cache.concepts` holds up to
 *   400 concepts and `cache.searches` up to 200 queries, each trimmed oldest-first on write. The
 *   namespace carries the same budget as any principal (1024 kB a value, 1000 keys), and a key per
 *   lookup crosses it in a week of ordinary use. The cache is politeness towards a free public
 *   service and a way to keep working when it is down, not a copy of YSO.
 *
 *   NO HOST IS EVER TAKEN FROM THE CALLER. Every URL is built here from a fixed base. There is no
 *   allowlist to configure because there is nothing to allow: a caller supplies a query and a
 *   concept URI, never an address.
 * @structure
 *   - VOCAB_FINTO_VERSION · VOCAB_FINTO_MANIFEST · the three action scripts · VOCAB_FINTO
 * @usage
 *   import { VOCAB_FINTO } from '../data/builtin-extensions/index.js';
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: search, concept, scheme.
 */
import type { BuiltinExtension } from './living-hooks.js';

/** The version the node ships. The seeder compares this against what is installed. */
export const VOCAB_FINTO_VERSION = '1.0.0';

export const VOCAB_FINTO_MANIFEST = `extension: "1.0"

# Finto is the National Library of Finland's vocabulary service and it is free and open: YSO, the
# general Finnish ontology, is CC BY 4.0 and needs no key, no account and no quota agreement. So
# this extension has no config at all. What it does have is a ceiling on its own cache, because an
# ext: namespace has the same budget as anybody else.
#
# It calls exactly one host, built into the scripts. A caller passes a query or a concept URI and
# never an address.

metadata:
  name: "vocab-finto"
  version: "${VOCAB_FINTO_VERSION}"
  description: "Look up concepts in Finto, the National Library of Finland's vocabulary service. Finds a term in YSO (a general Finnish ontology of about 30 000 concepts in Finnish, Swedish and English, CC BY 4.0), reads what a concept means and what sits above and below it, and turns a set of concepts you picked into a vocabulary you can save as your own. Nothing is stored on your behalf: what you keep, you keep in your own memory."
  author: "AIMEAT"
  license: "MIT"

required_apis:
  - memory

limits:
  memory_mb: 64
  timeout_ms: 8000
  max_api_calls: 30

actions:
  - id: search
    description: "Find concepts whose label matches a word. Answers with the matches, each with its URI, its label and the language that label is in."
    method: POST
    path: "/v1/ext/vocab-finto/search"
    auth: required
    script: search.js
    input:
      query:
        type: string
        description: "The word to look for. A trailing wildcard is added for you, so 'lintu' finds 'lintuharrastus'."
      lang:
        type: string
        description: "Which language to search and answer in: fi, sv or en. Finnish when omitted."
      vocab:
        type: string
        description: "Which Finto vocabulary to search. yso when omitted."
      limit:
        type: integer
        description: "How many matches at most. 20 when omitted, 100 at the ceiling."
    output:
      results:
        type: array
        description: "The matches: uri, prefLabel, lang, vocab."
      cached:
        type: boolean
        description: "True when this answer came from the stored copy rather than from Finto."
      error:
        type: object
        description: "Present instead of results when the lookup was refused or Finto could not be reached."

  - id: concept
    description: "Read one concept: its label in every language you ask for, the words that also mean it, and the concepts directly above and below it."
    method: POST
    path: "/v1/ext/vocab-finto/concept"
    auth: required
    script: concept.js
    input:
      uri:
        type: string
        description: "The concept's URI, as it came back from search."
      langs:
        type: array
        description: "Which languages to read labels in. fi, sv and en when omitted."
      vocab:
        type: string
        description: "Which Finto vocabulary the concept belongs to. yso when omitted."
    output:
      concept:
        type: object
        description: "The concept: uri, prefLabel per language, altLabel per language, broader and narrower as uri+label pairs."
      cached:
        type: boolean
        description: "True when this came from the stored copy."
      error:
        type: object
        description: "Present instead of concept when the lookup was refused or Finto could not be reached."

  - id: scheme
    description: "Turn a set of concepts you picked into a vocabulary document you can save as your own with AIMEAT.onto.saveVocab. Each concept keeps a link back to the one in Finto, so two systems that never agreed on anything can still tell they mean the same thing."
    method: POST
    path: "/v1/ext/vocab-finto/scheme"
    auth: required
    script: scheme.js
    input:
      uris:
        type: array
        description: "The concept URIs to include, as they came back from search."
      id:
        type: string
        description: "The id the vocabulary will be saved under, e.g. 'hobbies'. Used to address its concepts."
      label:
        type: object
        description: "What to call the vocabulary, per language, e.g. { fi: 'Harrastukset', en: 'Hobbies' }."
      langs:
        type: array
        description: "Which languages to keep labels in. fi, sv and en when omitted."
      vocab:
        type: string
        description: "Which Finto vocabulary the concepts belong to. yso when omitted."
    output:
      scheme:
        type: object
        description: "A SKOS concept scheme, ready to hand to AIMEAT.onto.saveVocab."
      fetched:
        type: integer
        description: "How many of the concepts had to be read from Finto rather than the stored copy."
      error:
        type: object
        description: "Present instead of scheme when the request was refused."
`;

/**
 * The shared half, prepended to each action. A sandboxed script has no imports, so sharing code
 * between actions means shipping the same bytes into each one.
 *
 * Everything sits inside functions the actions call, and every action declares its own body inside
 * `export default`, which is the shape the sandbox accepts without argument.
 */
const VOCAB_FINTO_LIB_JS = `
// The one host this extension talks to. Built here, never taken from a caller: there is no
// parameter anywhere below that can put a different address into a URL.
var FINTO = 'https://api.finto.fi/rest/v1';

// The cache ceilings. An ext: namespace has the same budget as any principal — 1024 kB a value,
// 1000 keys — so the cache is TWO keys with a bound on each rather than a key per lookup, which
// would cross the key ceiling inside a week of ordinary use.
var MAX_CONCEPTS = 400;
var MAX_SEARCHES = 200;
// A search result is a ranking and rankings move; a concept's meaning does not. So searches expire
// in a day and concepts are kept until they are pushed out by newer ones.
var SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

function fintoRefuse(code, message) {
  return { error: { code: code, message: message } };
}

/** Only the three languages Finto's own YSO carries. Anything else is a silently empty answer. */
function fintoLang(v, fallback) {
  var l = String(v || '').toLowerCase();
  return (l === 'fi' || l === 'sv' || l === 'en') ? l : fallback;
}

/** A vocabulary id is a path segment in every URL below, so it is letters, digits and dashes only. */
function fintoVocab(v) {
  var s = String(v || 'yso').toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(s) ? s : 'yso';
}

/** A concept URI must be one, and must be http(s): the value goes into a query string we build. */
function fintoUri(v) {
  var s = String(v || '');
  return /^https?:\\/\\/[^\\s"'<>]{4,300}$/.test(s) ? s : null;
}

/** Read one Finto endpoint and parse it. Answers { ok, data } or { ok: false, code, message }. */
async function fintoGet(ctx, path) {
  var res;
  try {
    res = await ctx.fetch(FINTO + path, { headers: { Accept: 'application/json' } });
  } catch (e) {
    return { ok: false, code: 'FINTO_UNREACHABLE', message: 'Could not reach the vocabulary service: ' + String(e && e.message ? e.message : e) };
  }
  if (!res || res.status >= 400) {
    return { ok: false, code: 'FINTO_ERROR', message: 'The vocabulary service answered ' + (res ? res.status : 'nothing') + '.' };
  }
  try {
    return { ok: true, data: JSON.parse(res.text) };
  } catch (e) {
    return { ok: false, code: 'FINTO_UNREADABLE', message: 'The vocabulary service answered something that is not JSON.' };
  }
}

/** Read the whole cache record, or an empty one. One key, both halves. */
async function fintoCache(ctx) {
  var c = await ctx.memory.get('cache');
  if (!c || typeof c !== 'object') return { concepts: {}, searches: {} };
  return {
    concepts: (c.concepts && typeof c.concepts === 'object') ? c.concepts : {},
    searches: (c.searches && typeof c.searches === 'object') ? c.searches : {},
  };
}

/** Trim a map to its ceiling, oldest \`at\` first, and write the whole cache back. */
async function fintoSaveCache(ctx, cache) {
  cache.concepts = fintoTrim(cache.concepts, MAX_CONCEPTS);
  cache.searches = fintoTrim(cache.searches, MAX_SEARCHES);
  // PRIVATE, although an ext namespace is world-readable by default and YSO is a public
  // vocabulary. What is not public is WHICH terms the people on this node looked up.
  await ctx.memory.set('cache', cache, { visibility: 'private' });
}

function fintoTrim(map, max) {
  var keys = Object.keys(map);
  if (keys.length <= max) return map;
  keys.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
  var out = {};
  keys.slice(keys.length - max).forEach(function (k) { out[k] = map[k]; });
  return out;
}
`;

const SEARCH_ACTION_JS = `
export default async function (ctx, input) {
  var query = String((input && input.query) || '').trim();
  if (query.length < 2) return fintoRefuse('QUERY_TOO_SHORT', 'Give at least two characters to search for.');
  var lang = fintoLang(input && input.lang, 'fi');
  var vocab = fintoVocab(input && input.vocab);
  var limit = Math.min(100, Math.max(1, Number((input && input.limit) || 20) || 20));
  var now = ctx.now ? new Date(ctx.now()).getTime() : Date.now();

  var cacheKey = vocab + '|' + lang + '|' + query.toLowerCase();
  var cache = await fintoCache(ctx);
  var hit = cache.searches[cacheKey];
  if (hit && (now - (hit.at || 0)) < SEARCH_TTL_MS) {
    return { results: (hit.results || []).slice(0, limit), cached: true };
  }

  // The trailing star is Finto's own prefix wildcard. Added here rather than asked of the caller,
  // because a search for "lintu" that does not find "lintuharrastus" reads as a broken vocabulary.
  // Ask for more rows than the caller wants, because the dedupe below removes some: Finto counts
  // maxhits in LABELS and the caller counts in concepts. Three times, capped at Finto's own 100.
  var path = '/search?query=' + encodeURIComponent(query + '*')
    + '&vocab=' + encodeURIComponent(vocab)
    + '&lang=' + encodeURIComponent(lang)
    + '&maxhits=' + Math.min(100, limit * 3);
  var got = await fintoGet(ctx, path);
  if (!got.ok) {
    // A stale answer beats no answer when the service is down, and the caller is told which it got.
    if (hit) return { results: (hit.results || []).slice(0, limit), cached: true, stale: true };
    return fintoRefuse(got.code, got.message);
  }

  // DEDUPE BY URI. Finto answers with one row per matching LABEL, so a concept whose prefLabel and
  // altLabel both match the query comes back two or three times. Measured against the live service
  // on 2026-09-08: "lintu" returned five rows for three concepts. Left in, the repeats eat the
  // caller's limit and a person picking from the list sees the same thing twice. The first row for
  // a URI is kept, which is the highest-ranked one Finto gave.
  var seen = {};
  var results = [];
  (got.data && Array.isArray(got.data.results) ? got.data.results : []).forEach(function (r) {
    if (!r || !r.uri || seen[r.uri]) return;
    seen[r.uri] = true;
    results.push({ uri: r.uri, prefLabel: r.prefLabel, lang: r.lang || lang, vocab: r.vocab || vocab });
  });

  cache.searches[cacheKey] = { at: now, results: results };
  await fintoSaveCache(ctx, cache);
  return { results: results.slice(0, limit), cached: false };
}
`;

const CONCEPT_ACTION_JS = `
export default async function (ctx, input) {
  var uri = fintoUri(input && input.uri);
  if (!uri) return fintoRefuse('BAD_URI', 'Give the concept URI exactly as search returned it.');
  var vocab = fintoVocab(input && input.vocab);
  var wanted = Array.isArray(input && input.langs) && input.langs.length ? input.langs : ['fi', 'sv', 'en'];
  var langs = [];
  wanted.forEach(function (l) { var ok = fintoLang(l, null); if (ok && langs.indexOf(ok) < 0) langs.push(ok); });
  if (!langs.length) langs = ['fi'];
  var now = ctx.now ? new Date(ctx.now()).getTime() : Date.now();

  var cacheKey = vocab + '|' + uri + '|' + langs.join(',');
  var cache = await fintoCache(ctx);
  if (cache.concepts[cacheKey]) return { concept: cache.concepts[cacheKey].value, cached: true };

  var concept = { uri: uri, prefLabel: {}, altLabel: {}, broader: [], narrower: [] };

  // One call per language for the labels, then one each for the relations. A concept read is a few
  // calls and then it is cached; max_api_calls in the manifest is the ceiling that keeps it honest.
  for (var i = 0; i < langs.length; i++) {
    var l = langs[i];
    var lab = await fintoGet(ctx, '/' + vocab + '/label?uri=' + encodeURIComponent(uri) + '&lang=' + l);
    if (!lab.ok) { if (i === 0) return fintoRefuse(lab.code, lab.message); else continue; }
    if (lab.data && lab.data.prefLabel) concept.prefLabel[l] = lab.data.prefLabel;
    if (lab.data && lab.data.altLabel) {
      concept.altLabel[l] = Array.isArray(lab.data.altLabel) ? lab.data.altLabel : [lab.data.altLabel];
    }
  }

  var primary = langs[0];
  var up = await fintoGet(ctx, '/' + vocab + '/broader?uri=' + encodeURIComponent(uri) + '&lang=' + primary);
  if (up.ok && up.data && Array.isArray(up.data.broader)) {
    concept.broader = up.data.broader.map(function (b) { return { uri: b.uri, prefLabel: b.prefLabel }; });
  }
  var down = await fintoGet(ctx, '/' + vocab + '/narrower?uri=' + encodeURIComponent(uri) + '&lang=' + primary);
  if (down.ok && down.data && Array.isArray(down.data.narrower)) {
    concept.narrower = down.data.narrower.map(function (b) { return { uri: b.uri, prefLabel: b.prefLabel }; });
  }

  cache.concepts[cacheKey] = { at: now, value: concept };
  await fintoSaveCache(ctx, cache);
  return { concept: concept, cached: false };
}
`;

const SCHEME_ACTION_JS = `
export default async function (ctx, input) {
  var uris = Array.isArray(input && input.uris) ? input.uris : [];
  if (!uris.length) return fintoRefuse('NO_CONCEPTS', 'Name at least one concept URI to include.');
  if (uris.length > 200) return fintoRefuse('TOO_MANY', 'Take at most 200 concepts at a time.');
  var id = String((input && input.id) || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,60}$/.test(id)) {
    return fintoRefuse('BAD_ID', 'The vocabulary id is letters, digits, dots, dashes and underscores, e.g. "hobbies".');
  }
  var vocab = fintoVocab(input && input.vocab);
  var wanted = Array.isArray(input && input.langs) && input.langs.length ? input.langs : ['fi', 'sv', 'en'];
  var langs = [];
  wanted.forEach(function (l) { var ok = fintoLang(l, null); if (ok && langs.indexOf(ok) < 0) langs.push(ok); });
  if (!langs.length) langs = ['fi'];
  var now = ctx.now ? new Date(ctx.now()).getTime() : Date.now();

  var cache = await fintoCache(ctx);
  var concepts = [];
  var fetched = 0;
  var chosen = {};
  uris.forEach(function (u) { var v = fintoUri(u); if (v) chosen[v] = true; });

  for (var u in chosen) {
    var cacheKey = vocab + '|' + u + '|' + langs.join(',');
    var got = cache.concepts[cacheKey] ? cache.concepts[cacheKey].value : null;
    if (!got) {
      got = { uri: u, prefLabel: {}, altLabel: {}, broader: [], narrower: [] };
      for (var i = 0; i < langs.length; i++) {
        var lab = await fintoGet(ctx, '/' + vocab + '/label?uri=' + encodeURIComponent(u) + '&lang=' + langs[i]);
        if (!lab.ok) continue;
        if (lab.data && lab.data.prefLabel) got.prefLabel[langs[i]] = lab.data.prefLabel;
        if (lab.data && lab.data.altLabel) {
          got.altLabel[langs[i]] = Array.isArray(lab.data.altLabel) ? lab.data.altLabel : [lab.data.altLabel];
        }
      }
      var up = await fintoGet(ctx, '/' + vocab + '/broader?uri=' + encodeURIComponent(u) + '&lang=' + langs[0]);
      if (up.ok && up.data && Array.isArray(up.data.broader)) {
        got.broader = up.data.broader.map(function (b) { return { uri: b.uri, prefLabel: b.prefLabel }; });
      }
      cache.concepts[cacheKey] = { at: now, value: got };
      fetched++;
    }

    // The local id, not the YSO one. A vocabulary saved here is the owner's own, and the link back
    // to Finto is skos:exactMatch — which is the field that lets two systems that never agreed on
    // anything tell they mean the same thing, without either of them adopting the other's ids.
    var local = 'vocab:' + id + '/' + u.split('/').pop();
    var node = {
      '@id': local,
      '@type': 'skos:Concept',
      'skos:prefLabel': got.prefLabel,
      'skos:exactMatch': u,
    };
    if (got.altLabel && Object.keys(got.altLabel).length) node['skos:altLabel'] = got.altLabel;
    // A broader concept the caller ALSO picked becomes a local hierarchy; one they did not is left
    // out rather than pointing at an id this vocabulary does not contain.
    if (got.broader && got.broader.length) {
      for (var b = 0; b < got.broader.length; b++) {
        if (chosen[got.broader[b].uri]) {
          node['skos:broader'] = 'vocab:' + id + '/' + got.broader[b].uri.split('/').pop();
          break;
        }
      }
    }
    concepts.push(node);
  }

  if (fetched) await fintoSaveCache(ctx, cache);

  return {
    scheme: {
      '@context': {
        skos: 'http://www.w3.org/2004/02/skos/core#',
        dcterms: 'http://purl.org/dc/terms/',
        aimeat: 'https://aimeat.io/ns/',
      },
      '@type': 'skos:ConceptScheme',
      '@id': 'vocab:' + id,
      'skos:prefLabel': (input && input.label && typeof input.label === 'object') ? input.label : { en: id },
      // Attribution is a condition of the licence, not a courtesy. YSO is CC BY 4.0 and the
      // vocabulary this returns is a derivative of it, so the credit travels with the record.
      'dcterms:source': 'http://finto.fi/' + vocab + '/',
      'dcterms:rights': 'Concepts from ' + vocab.toUpperCase() + ' (Finto, National Library of Finland), CC BY 4.0',
      'dcterms:modified': new Date(now).toISOString(),
      concepts: concepts,
    },
    fetched: fetched,
  };
}
`;

export const VOCAB_FINTO: BuiltinExtension = {
  name: 'vocab-finto',
  version: VOCAB_FINTO_VERSION,
  manifest: VOCAB_FINTO_MANIFEST,
  scripts: {
    'search.js': `${VOCAB_FINTO_LIB_JS}\n${SEARCH_ACTION_JS}`,
    'concept.js': `${VOCAB_FINTO_LIB_JS}\n${CONCEPT_ACTION_JS}`,
    'scheme.js': `${VOCAB_FINTO_LIB_JS}\n${SCHEME_ACTION_JS}`,
  },
};
