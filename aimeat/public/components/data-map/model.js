/**
 * @file public/components/data-map/model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map's vocabulary, as a pure module with no imports.
 *
 *   Two renderers draw this map — the Preact one in the profile and the esbuild one in the app
 *   catalogue, which has no Preact and no SSE — so the words and the ordering live here and the
 *   catalogue copies this file VERBATIM. test/unit/data-map-model.test.ts loads both copies and
 *   fails when they differ.
 *
 *   Every axis maps a stored value to an i18n key. A value the map carries that this file does not
 *   know is rendered as written rather than dropped: a map from a newer node must degrade to
 *   "unfamiliar word" and never to a blank cell.
 * @structure LABEL_KEYS · labelKeyFor · ROW_ORDER · orderRows · placeOf · summaryOf
 * @usage import { labelKeyFor, orderRows } from '/components/data-map/model.js';
 * @version-history
 *   v2.1.0 — 2026-08-26 — `organism-rows` in the where vocabulary and in the organism test. Kept
 *     byte-identical to src/static/app-catalog/js/data-map-model.js, which a unit test enforces.
 *   v2.0.0 — 2026-08-25 — Rewritten for aimeat.datamap/2 per docs/datakartta-maaritelma.md.
 */

/**
 * The spec this build understands. A stamp or a map carrying anything else was written by a version
 * with different rules — the previous one GUESSED a map when an app said nothing — so it is read as
 * "no map" rather than as a map. Both renderers check it, which is why it lives here.
 */
export const DATA_MAP_SPEC = 'aimeat.datamap/2';

/** Every axis, value → i18n key suffix. The key is `dataMap.<axis>.<value>`. */
export const AXES = ['form', 'where', 'kind', 'use', 'owner', 'readers', 'writer', 'shape', 'kept', 'loss'];

export const VALUES = {
  form: ['one-person', 'private', 'shared-with-named', 'group', 'organism-workspace',
    'public-service', 'static', 'mixed', 'unstated'],
  where: ['nowhere', 'browser-only', 'owner-memory-private', 'owner-memory-public',
    'someone-elses-memory', 'organism-workspace', 'organism-rows', 'organism-shared', 'organism-meta',
    'extension-namespace', 'cortex', 'file-storage', 'app-published-record', 'another-node',
    'external-service'],
  kind: ['settings', 'user-written', 'ai-generated', 'register', 'event-log', 'index',
    'computed-or-cache', 'fetched-copy', 'foreign-identifier', 'snapshot', 'metrics',
    'preferences', 'draft', 'outgoing-message', 'file', 'link-between-things', 'permissions',
    'secret'],
  use: ['app-cannot-run-without', 'user-returns-to-read', 'shown-as-a-list', 'search-and-filter',
    'calculation-and-reporting', 'app-resumes-where-it-left', 'to-share-with-others', 'to-send-out',
    'evidence-of-what-happened', 'speed-only', 'context-for-an-ai', 'backwards-compatibility'],
  owner: ['person', 'organism', 'extension', 'ecosystem-app', 'someone-else',
    'external-controller', 'nobody'],
  readers: ['owner-only', 'owner-and-their-agents', 'named-people', 'organism-members', 'anyone',
    'the-app-itself', 'a-recipient-elsewhere'],
  writer: ['person-in-the-ui', 'the-app-for-the-person', 'an-agent', 'a-schedule-unattended',
    'an-extension-server-side', 'install-seed', 'a-foreign-system'],
  shape: ['one-record', 'one-per-thing', 'collection-under-one-key', 'rolled-up-per-period',
    'index-plus-bodies', 'files', 'no-record'],
  kept: ['until-deleted', 'ttl', 'rolling-window', 'version-capped', 'append-only', 'session-only'],
  loss: ['only-copy', 'recoverable-from-source', 'recomputable', 'user-can-rewrite', 'may-vanish'],
};

/**
 * The i18n key for one axis value, or null when the map carries a word this build does not know.
 * A null tells the renderer to print the raw value: an unfamiliar word beats an empty cell.
 */
export function labelKeyFor(axis, value) {
  if (!value) return null;
  const known = VALUES[axis];
  if (!known || known.indexOf(value) < 0) return null;
  return 'dataMap.' + axis + '.' + value;
}

/**
 * Rows in the order a reader needs them.
 *
 * The rows that would cost the most if they were in the wrong place come first: the only copy of
 * something, then anything about a person, then the rest. A row nobody has explained sorts above an
 * explained one inside its group, because that is the row somebody has to finish.
 */
export function orderRows(rows) {
  const weight = (r) => {
    let w = 0;
    if (r.lossRisk === 'only-copy') w -= 4;
    if (r.personalData === 'yes') w -= 3;
    if (r.usedFor === 'to-share-with-others') w -= 2;
    if (!String(r.why || '').trim()) w -= 1;
    return w;
  };
  return rows.slice().sort((a, b) => weight(a) - weight(b));
}

/**
 * Does the arrangement contradict what the app says it is?
 *
 * The one check that pays for the whole map: an app for several people whose every row lands in one
 * person's own memory is the defect this exists to catch, and it is readable from two columns.
 */
export function contradictionOf(map) {
  if (!map || !map.held || map.held.length === 0) return null;
  const inOrganism = map.held.some(r => r.where === 'organism-workspace'
    || r.where === 'organism-rows' || r.where === 'organism-shared' || r.where === 'organism-meta');
  const allPrivate = map.held.every(r => r.where === 'owner-memory-private');
  const sharedForm = map.form === 'group' || map.form === 'organism-workspace'
    || map.form === 'shared-with-named';

  if (sharedForm && allPrivate) return 'dataMap.contradiction.sharedButPrivate';
  if (map.form === 'one-person' && inOrganism) return 'dataMap.contradiction.personalButShared';
  if (map.form === 'static') return 'dataMap.contradiction.staticButStores';
  return null;
}

/** Which places this map's rows land in, biggest group first: the one line a list shows. */
export function placesOf(map) {
  const counts = new Map();
  for (const row of (map && map.held) || []) {
    counts.set(row.where, (counts.get(row.where) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([where, n]) => ({ where, n }));
}

/** The four states a map can be in. The one a reader must not miss is `contradicted`. */
export function stateOf(map) {
  if (!map || map.spec !== DATA_MAP_SPEC || map.source === 'none') return 'missing';
  if (contradictionOf(map)) return 'contradicted';
  if ((map.held || []).some(r => !String(r.why || '').trim())) return 'unfinished';
  return 'stated';
}
