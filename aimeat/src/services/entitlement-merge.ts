/**
 * @file src/services/entitlement-merge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one-off migration for rights minted before they were keyed to the owner who pays.
 *
 *   Only a human holds a balance — `debitBalance` resolves every agent to its owner — so a right keyed
 *   on the exact caller left one person holding several contracts for one product, all drawing on the
 *   one wallet. Once the key moved to the owner, those caller-keyed rows stop resolving: nothing will
 *   ever look them up again, and their history would simply stop being found. This carries it across.
 *
 *   TWO THINGS IT GOT WRONG THE FIRST TIME, both measured on production:
 *
 *   It recomputed each record's key from its contents in order to delete it. But these rows exist
 *   BECAUSE the key function changed, so every recomputed key came back as the survivor's own, the
 *   "do not delete what you just wrote" guard matched, and no source was removed — leaving their calls
 *   counted twice in the provider's totals. A record does not know where it lives; the scan does, so
 *   the key travels with the value now.
 *
 *   And it folded history in unconditionally, so a re-run over a half-finished state summed the same
 *   calls again: a 118-call contract read back as 236. A source whose principal is already credited in
 *   the survivor's breakdown is skipped and only removed, which is also the repair for that state.
 * @structure listAllEntitlementsForMerge · mergeOwnerEntitlements · absorbedAlready
 * @usage
 *   const all = await listAllEntitlementsForMerge(storage);   // { key, value } — the key matters
 *   await mergeOwnerEntitlements(storage, group, { dryRun });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Extracted from metered-entitlements.ts (max-file-lines) with the deletion
 *     and idempotence fixes.
 */
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import {
  entitlementKey, grantKey, archiveEntitlement, persistEntitlement,
  NS_ENTITLEMENT, NS_GRANT_PUBLIC, type MeteredEntitlement,
} from './metered-entitlements.js';

/**
 * Every live right on the node, contracts and grants alike — the input to the owner-key migration,
 * which has to see records whose key no longer resolves in order to fold them in.
 */
export async function listAllEntitlementsForMerge(storage: Storage): Promise<Array<{ key: string; value: MeteredEntitlement }>> {
  const [bought, granted] = await Promise.all([
    storage.listAllMemory({ prefix: 'entitlement.', limit: 5000 }),
    storage.listAllMemory({ prefix: 'entgrant.', limit: 5000 }),
  ]);
  return [...bought.items, ...granted.items]
    .filter(r => r.value)
    .map(r => ({ key: r.key, value: r.value as MeteredEntitlement }));
}

/**
 * Fold every right one OWNER holds over one coordinate into a single record — the migration for rights
 * that were minted per-principal before they were keyed per-owner.
 *
 * Nothing is thrown away. Calls and spend are summed, each source record's usage becomes its own row in
 * the breakdown, and the originals are archived. The surviving TERMS are the most recently created
 * ones, because that is the last set the human agreed to; where they differ from an older record's,
 * that is a real change to what a call costs and the caller of this function is expected to report it
 * rather than let it happen quietly.
 *
 * Rails are never merged: morsels and money micro-units are different numbers, so a coordinate priced
 * on both keeps one record per rail.
 */
/**
 * Is this record's history already inside the survivor's caller breakdown?
 *
 * True for a source that a previous run folded in but failed to delete. Folding it again would count
 * the same calls twice, which is the difference between a migration that can be re-run and one that
 * quietly inflates a customer's meter every time somebody presses it.
 */
function absorbedAlready(newest: MeteredEntitlement, e: MeteredEntitlement): boolean {
  if (e === newest) return false;
  const row = (newest.callers ?? {})[e.consumerGaii];
  return !!row && row.calls >= e.budget.calls;
}

export async function mergeOwnerEntitlements(
  storage: Storage,
  /** Each record WITH the key it is stored under — see the deletion note below. */
  records: Array<{ key: string; value: MeteredEntitlement }>,
  opts: { dryRun: boolean },
): Promise<{ survivor: MeteredEntitlement; absorbed: MeteredEntitlement[] } | null> {
  if (records.length < 2) return null;
  const byValue = new Map(records.map(r => [r.value, r.key]));
  const ordered = [...records.map(r => r.value)].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const oldest = ordered[0] as MeteredEntitlement;

  // WHICH record is the one in force? The one a call would actually find — the row at the live
  // owner-keyed slot. Sorting by `createdAt` cannot answer it, because a survivor from an earlier run
  // deliberately inherits the OLDEST creation date, so the "newest" record is the stale source beside
  // it. That mistake is what let a repair run fold an already-counted 118 calls in a second time.
  const liveKey = (records[0]!.value.grant ? grantKey : entitlementKey)(
    ownerGhiiOf(oldest.consumerGaii), oldest.ext, oldest.action);
  const live = records.find(r => r.key === liveKey)?.value ?? null;
  const newest = live ?? (ordered[ordered.length - 1] as MeteredEntitlement);

  // The survivor carries the newest TERMS and everyone's HISTORY.
  const survivor: MeteredEntitlement = {
    ...newest,
    consumerGaii: ownerGhiiOf(newest.consumerGaii),
    createdAt: oldest.createdAt,
    budget: {
      capUnits: newest.budget.capUnits,
      spentUnits: ordered.reduce((n, e) => n + (absorbedAlready(newest, e) ? 0 : e.budget.spentUnits), 0),
      calls: ordered.reduce((n, e) => n + (absorbedAlready(newest, e) ? 0 : e.budget.calls), 0),
    },
    callers: {},
    updatedAt: new Date().toISOString(),
  };
  if (survivor.grant && newest.grant) {
    survivor.grant = { ...newest.grant, carriedUnits: ordered.reduce((n, e) => n + (absorbedAlready(newest, e) ? 0 : (e.grant?.carriedUnits ?? 0)), 0) };
  }
  // Each source contributes its own usage under its own principal, plus whatever breakdown it already
  // had — unless the newest record ALREADY carries that principal's history, which is what a survivor
  // from an earlier run looks like. Without that check a re-run sums the same calls a second time: on
  // production a 118-call contract would have read back as 236.
  const already = newest.callers ?? {};
  for (const e of ordered) {
    if (e !== newest && already[e.consumerGaii] && already[e.consumerGaii].calls >= e.budget.calls) {
      continue;   // its history is in the survivor; only its stale row is left to remove
    }
    const rows = e.callers ?? { [e.consumerGaii]: { calls: e.budget.calls, spentUnits: e.budget.spentUnits, carriedUnits: e.grant?.carriedUnits ?? 0, lastUsedAt: e.updatedAt } };
    for (const [who, row] of Object.entries(rows)) {
      const prev = survivor.callers![who] ?? { calls: 0, spentUnits: 0, carriedUnits: 0, lastUsedAt: '' };
      survivor.callers![who] = {
        calls: prev.calls + row.calls,
        spentUnits: prev.spentUnits + row.spentUnits,
        carriedUnits: prev.carriedUnits + (row.carriedUnits ?? 0),
        lastUsedAt: prev.lastUsedAt > row.lastUsedAt ? prev.lastUsedAt : row.lastUsedAt,
      };
    }
  }
  const absorbed = ordered.filter(e => e !== newest);
  if (opts.dryRun) return { survivor, absorbed };

  // Archive first: if the write below fails, the record of what was there survives.
  for (const e of absorbed) await archiveEntitlement(storage, e, 'superseded', null);
  await persistEntitlement(storage, survivor);

  // Delete by the key each record was FOUND at, never by one recomputed from its contents.
  //
  // These rows exist precisely BECAUSE the key function changed: they were written under a hash of the
  // exact caller, and the current one hashes the owner. Recomputing gave the survivor's own key for
  // every one of them, so the guard skipped them all and nothing was removed — the sources stayed,
  // their calls were counted twice in the provider's totals, and a second run would have folded them
  // in again. A record does not know where it lives; the scan that found it does.
  const survivorKey = (survivor.grant ? grantKey : entitlementKey)(survivor.consumerGaii, survivor.ext, survivor.action);
  const ns = survivor.grant ? NS_GRANT_PUBLIC : NS_ENTITLEMENT;
  for (const e of [...absorbed, newest]) {
    const k = byValue.get(e);
    if (k && k !== survivorKey) await storage.deleteMemory(ns, k);
  }
  return { survivor, absorbed };
}
