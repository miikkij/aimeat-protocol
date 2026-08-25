/**
 * @file src/services/data-map/data-map-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Summarise a data map for a list, and say what is still missing from it.
 *
 *   THIS FILE NEVER INVENTS A MAP. The node's whole job here is to read what somebody wrote, fold it
 *   into one line, and name the holes. The previous version derived a map from the app's permission
 *   words when the app said nothing, which produced the same confident row on 114 apps — `kansi.*`,
 *   "you named it", "nobody has said why this is here" — sitting exactly where the answer belonged
 *   and reading like one. A missing map now says it is missing.
 *
 *   PURE. No storage, no clock: the caller passes `at`, so the same map always yields the same
 *   summary and a unit test can assert it.
 * @structure summariseMap · checkMap · noMapStamp · FINDING_CODES
 * @usage import { summariseMap, checkMap } from './data-map-check.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — Replaces data-map-derive.ts and data-map-lint.ts.
 */
import {
  DATA_MAP_SPEC, appDataMapKey,
  type DataMap, type DataMapRow, type DataMapStamp, type DataMapGap, type DataLocation,
} from './data-map-types.js';

/** Findings, worst first. The order is the order a reader should care. */
export const FINDING_CODES = [
  'DATAMAP_MISSING',
  'DATAMAP_NO_PURPOSE',
  'DATAMAP_NO_ARRANGEMENT',
  'DATAMAP_FORM_UNSTATED',
  'DATAMAP_FORM_CONTRADICTED',
  'DATAMAP_ROW_NO_WHY',
  'DATAMAP_NO_ROWS',
] as const;

export type FindingCode = typeof FINDING_CODES[number];

/** Where a row lives, in the words the surfaces use. One place, so two renderers cannot drift. */
const PLACE_WORDS: Record<DataLocation, string> = {
  nowhere: 'nowhere',
  'browser-only': 'the browser only',
  'owner-memory-private': 'your own memory',
  'owner-memory-public': 'your own memory, readable by anyone',
  'someone-elses-memory': "someone else's memory",
  'organism-workspace': 'an organism workspace',
  'organism-shared': "an organism's shared area",
  'organism-meta': "an organism's registry",
  'extension-namespace': "an extension's own space",
  cortex: 'cortex',
  'file-storage': 'file storage',
  'app-published-record': "the app's own published record",
  'another-node': 'another node',
  'external-service': 'an outside service',
};

export const placeWords = (where: DataLocation): string => PLACE_WORDS[where] ?? String(where);

/**
 * One line for a list: where this app's data is.
 *
 * Built from the rows the author wrote, so it can only ever be as true as they are. An app with no
 * rows gets the sentence that says so rather than a blank.
 */
export function summariseMap(map: DataMap): string {
  if (map.source === 'none') return 'No data map yet.';
  if (map.held.length === 0 && map.elsewhere.length === 0) return 'Stores nothing.';

  // Group by place, biggest group first: "an organism workspace (9), your own memory (2)".
  const byPlace = new Map<DataLocation, number>();
  for (const row of map.held) byPlace.set(row.where, (byPlace.get(row.where) ?? 0) + 1);
  const places = [...byPlace.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([where, n]) => `${placeWords(where)} (${n})`);

  const parts = [places.join(', ')];
  if (map.machinery.length > 0) parts.push(`uses ${map.machinery.join(', ')}`);
  if (map.leaves.length === 1) parts.push('one thing leaves the house');
  else if (map.leaves.length > 1) parts.push(`${map.leaves.length} things leave the house`);
  return parts.join(' · ');
}

/** Rows the form implies but that are not there, and rows it forbids. */
function formContradiction(map: DataMap): string | null {
  const inWorkspace = map.held.some(r =>
    r.where === 'organism-workspace' || r.where === 'organism-shared' || r.where === 'organism-meta');
  const sharedForm = map.form === 'group' || map.form === 'organism-workspace'
    || map.form === 'shared-with-named';

  if (map.form === 'one-person' && inWorkspace) {
    return 'This says it is a one-person app, and it writes into an organism, which more than one person reads.';
  }
  if (sharedForm && !inWorkspace && map.held.length > 0
      && map.held.every(r => r.where === 'owner-memory-private')) {
    return 'This says several people share it, and every row lands in one person\'s own memory, where only they can read it.';
  }
  if (map.form === 'static' && map.held.length > 0) {
    return 'This says it is a static page, and it lists rows it stores.';
  }
  return null;
}

export interface MapCheck {
  /** Every finding, worst first, in words a person can act on. */
  findings: { code: FindingCode; message: string }[];
  /** The worst one, which is what a stamp carries. */
  gap: DataMapGap | null;
}

/** What is still missing from a map somebody wrote. Never blocks anything. */
export function checkMap(map: DataMap | null, at: string): MapCheck {
  const findings: { code: FindingCode; message: string }[] = [];

  if (!map || map.source === 'none') {
    findings.push({
      code: 'DATAMAP_MISSING',
      message: 'This app has no data map. Whoever builds or edits it next has to read the source to '
        + 'find out where its data goes, which is how data ends up wherever was easiest to reach.',
    });
    return { findings, gap: { code: 'DATAMAP_MISSING', message: findings[0].message, at } };
  }

  if (!map.what.trim() || !map.usedFor.trim()) {
    findings.push({
      code: 'DATAMAP_NO_PURPOSE',
      message: 'Nobody has said what this app is for. Without it the rows are a list of keys and '
        + 'there is no way to judge whether the data is in the right place.',
    });
  }
  if (!map.arrangement.trim()) {
    findings.push({
      code: 'DATAMAP_NO_ARRANGEMENT',
      message: 'Nobody has described how this app arranges its data.',
    });
  }
  if (map.form === 'unstated') {
    findings.push({
      code: 'DATAMAP_FORM_UNSTATED',
      message: 'Nobody has said whether this is a one-person app, a shared one, or a group one.',
    });
  }
  const contradiction = formContradiction(map);
  if (contradiction) {
    findings.push({ code: 'DATAMAP_FORM_CONTRADICTED', message: contradiction });
  }
  if (map.held.length === 0 && map.elsewhere.length === 0 && map.form !== 'static') {
    findings.push({
      code: 'DATAMAP_NO_ROWS',
      message: 'The map lists nothing. If the app really stores nothing, say so by declaring it static.',
    });
  }
  const noWhy = map.held.filter(r => !r.why.trim());
  if (noWhy.length > 0) {
    findings.push({
      code: 'DATAMAP_ROW_NO_WHY',
      message: `${noWhy.length} of ${map.held.length} rows do not say why the data is there rather `
        + 'than somewhere else. That sentence is read at the moment somebody is about to move it.',
    });
  }

  // Worst first, by the declared order.
  findings.sort((a, b) => FINDING_CODES.indexOf(a.code) - FINDING_CODES.indexOf(b.code));
  const worst = findings[0];
  return { findings, gap: worst ? { code: worst.code, message: worst.message, at } : null };
}

/** The stamp a list renders from, without reading the document. */
export function stampFor(map: DataMap | null, appId: string, at: string): DataMapStamp {
  const check = checkMap(map, at);
  const rows = map?.held ?? [];
  return {
    spec: DATA_MAP_SPEC,
    form: map?.form ?? 'unstated',
    summary: map ? summariseMap(map) : 'No data map yet.',
    heldRows: rows.length,
    rowsWithoutWhy: rows.filter((r: DataMapRow) => !r.why.trim()).length,
    missing: !map || map.source === 'none',
    docKey: appDataMapKey(appId),
    at,
    ...(check.gap ? { gap: check.gap } : {}),
  };
}
