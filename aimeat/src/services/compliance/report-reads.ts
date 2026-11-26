/**
 * @file src/services/compliance/report-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The store as one compliance report reads it: the records the report reads of every
 *   app are read ahead in a few statements, and a read that repeats is answered once.
 *
 *   WHAT GROWS. The node-wide report walks every app four times (the apps overview, the apps that use
 *   AI, the register drafts, the gap scan), and each walk read its records one app at a time: the
 *   app's data map four times, four compliance documents, the app's registration record and its
 *   count of registered people. Measured on 2026-11-26 with 373 apps: 3 376 single-record reads and
 *   373 counts for one report, and one more read of every data map for the register draft. The
 *   number of statements followed the number of apps.
 *
 *   HOW. The view answers `getMemory` from what was read ahead, and reads anything else from the
 *   store and keeps the answer. The batch reads apply the row test `getMemory` applies
 *   (getMemoryByKeys, getMemoryByKeysAnyOwner), so a record read ahead is the record a single read
 *   returns. A key this file does not name is a single read as before: reading ahead can make a
 *   report faster and cannot change what it says. `listApps` is answered once per set of options and
 *   a count of an app's registered people comes from one grouped count.
 *
 *   FOR A READ-ONLY COMPUTATION. The view keeps what it read for as long as it lives, so it is made
 *   for one report and dropped. Code that writes a memory record and reads it back takes the store.
 * @structure ReadAhead · reportReads(storage, config, ahead)
 * @usage
 *   const reads = await reportReads(storage, config, { docs: true, parties: true });
 *   const overview = await appsOverview({ storage: reads, config });
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { appDataMapKey } from '../data-map/data-map-types.js';
import { appDataMapId } from '../app/app-ref.js';
import { appPartiesKey } from '../app-parties/contract.js';
import { docKey } from './docs.js';
import { systemGhiiFor } from './register.js';

/** How many apps a report reads (apps-overview.ts, scope-gaps.ts, register-drafts.ts, draft.ts). */
const APP_SCAN = 1000;

/** How many keys one batch read names. */
const KEY_CHUNK = 500;

/** The documents the gap scan reads of every app (scope-gaps.ts scopeGaps). */
const APP_DOC_KINDS = ['registers', 'dpias', 'requests', 'breaches'] as const;

/** What to read ahead beside every app's data map. */
export interface ReadAhead {
  /** The four compliance documents of every app. */
  docs?: boolean;
  /** Every app's registration record and its count of registered people. */
  parties?: boolean;
}

const at = (ownerGaii: string, key: string): string => `${ownerGaii}\u0000${key}`;

/** The options of a listApps call as a cache key, whatever order they were written in. */
const optionsKey = (opts: unknown): string =>
  JSON.stringify(Object.entries((opts ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));

/** A view of `storage` for one report (see the file header). */
export async function reportReads(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, ahead: ReadAhead = {},
): Promise<Storage> {
  const memory = new Map<string, Promise<MemoryRecord | null>>();
  const appLists = new Map<string, ReturnType<Storage['listApps']>>();
  let partyCounts: Promise<Record<string, number>> | undefined;

  // Every caller gets a record of its own, as a read of the store gives: one that changes what it
  // read changes nothing for the next reader of the same key.
  const getMemory: Storage['getMemory'] = async (ownerGaii, key) => {
    const k = at(ownerGaii, key);
    let read = memory.get(k);
    if (!read) { read = storage.getMemory(ownerGaii, key); memory.set(k, read); }
    const record = await read;
    return record ? structuredClone(record) : null;
  };
  const listApps: Storage['listApps'] = (opts) => {
    const k = optionsKey(opts);
    let read = appLists.get(k);
    if (!read) { read = storage.listApps(opts); appLists.set(k, read); }
    return read;
  };
  const countAppParties: Storage['countAppParties'] = async (appId, rule) => {
    // A count under a rule is of the live places only; the grouped count is of every party.
    if (rule || !ahead.parties) return storage.countAppParties(appId, rule);
    partyCounts ??= storage.countAppPartiesByApp();
    return (await partyCounts)[appId] ?? 0;
  };
  const view = new Proxy(storage, {
    get(target, prop) {
      if (prop === 'getMemory') return getMemory;
      if (prop === 'listApps') return listApps;
      if (prop === 'countAppParties') return countAppParties;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

  // The keys the walks read of every app, by the names the walks build them with.
  const system = systemGhiiFor(config.nodeId);
  const owned: Array<{ ownerGaii: string; key: string }> = [];
  const docs: string[] = [];
  const { apps } = await view.listApps({ adminView: true, limit: APP_SCAN });
  for (const app of apps) {
    const owner = localAccountName(app.ownerName ?? app.ownerGaii ?? '');
    if (!owner) continue;
    const ownerGaii = `${owner}@${config.nodeId}`;
    owned.push({ ownerGaii, key: appDataMapKey(appDataMapId(app.filename)) });
    if (ahead.parties) owned.push({ ownerGaii, key: appPartiesKey(`${owner}/${app.filename}`) });
    if (ahead.docs) {
      for (const kind of APP_DOC_KINDS) {
        const key = docKey(kind, { kind: 'app', ownerName: owner, app: app.filename });
        if (key) docs.push(key);
      }
    }
  }

  // A key that the batch did not return has no record: the single read would answer null too.
  const keep = (asked: Array<{ ownerGaii: string; key: string }>, rows: MemoryRecord[]): void => {
    const found = new Map(rows.map(r => [at(r.ownerGaii, r.key), r]));
    for (const a of asked) memory.set(at(a.ownerGaii, a.key), Promise.resolve(found.get(at(a.ownerGaii, a.key)) ?? null));
  };
  for (let i = 0; i < owned.length; i += KEY_CHUNK) {
    const asked = owned.slice(i, i + KEY_CHUNK);
    keep(asked, await storage.getMemoryByKeysAnyOwner([...new Set(asked.map(a => a.key))]));
  }
  const docKeys = [...new Set(docs)];
  for (let i = 0; i < docKeys.length; i += KEY_CHUNK) {
    const keys = docKeys.slice(i, i + KEY_CHUNK);
    keep(keys.map(key => ({ ownerGaii: system, key })), await storage.getMemoryByKeys(system, keys));
  }
  return view;
}
