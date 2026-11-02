/**
 * @file src/services/datapackage/version-returns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record of a package returning to bytes it had earlier. A version is a directory
 *   named by its content hash, so a run that produces the rows of an earlier version writes nothing new:
 *   the pointer moves back to that directory (./store.ts, the `existing` branch). Without a record of
 *   that move the history listed the earlier version under its first date, and the newest version on
 *   the list was not the one the package stands on ("Uusin on versio 1" above a list with version 2).
 *   This record keeps each return, so the history lists it as its own row, newest first.
 *
 *   One memory record per package in the owner's namespace, key `datapkg-returns.<name>`, written by
 *   the service only and read by listVersions. The newest RETURNS_KEPT returns are kept.
 * @structure VersionReturn · RETURNS_PREFIX · RETURNS_KEPT · returnsKey · recordVersionReturn · readVersionReturns
 * @usage await recordVersionReturn(storage, ownerGhii, name, contentHash, previousHash);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP10e C2).
 */
import type { Storage } from '../../storage/interface.js';
import { updateRecord } from '../record-cas.js';
import { bare } from './contract.js';

/** One return: the version the package came back to, when, and the version it left. */
export interface VersionReturn { contentHash: string; at: string; from?: string }

export const RETURNS_PREFIX = 'datapkg-returns.';
export const RETURNS_KEPT = 200;

export const returnsKey = (name: string): string => `${RETURNS_PREFIX}${name}`;

interface ReturnsRecord { name: string; returns: VersionReturn[] }

function parseReturns(v: unknown): VersionReturn[] {
    const list = (v as { returns?: unknown } | null)?.returns;
    if (!Array.isArray(list)) return [];
    return list.filter((r): r is VersionReturn => !!r && typeof r === 'object'
        && typeof (r as VersionReturn).contentHash === 'string' && typeof (r as VersionReturn).at === 'string');
}

/** Record that `name` came back to `contentHash`, leaving `from`. */
export async function recordVersionReturn(storage: Storage, ownerGhii: string, name: string, contentHash: string, from: string | undefined, at = new Date().toISOString()): Promise<void> {
    const entry: VersionReturn = { contentHash: `sha256:${bare(contentHash)}`, at, ...(from ? { from: `sha256:${bare(from)}` } : {}) };
    await updateRecord<ReturnsRecord>(storage, ownerGhii, returnsKey(name), v => ({ name, returns: parseReturns(v) }),
        cur => ({ name, returns: [...cur.returns, entry].slice(-RETURNS_KEPT) }), { tag: 'datapackage-returns', ttlHours: null });
}

/** Every recorded return of `name`, oldest first. */
export async function readVersionReturns(storage: Storage, ownerGhii: string, name: string): Promise<VersionReturn[]> {
    const rec = await storage.getMemory(ownerGhii, returnsKey(name));
    return parseReturns(rec?.value);
}
