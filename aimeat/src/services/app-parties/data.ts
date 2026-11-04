/**
 * @file src/services/app-parties/data.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person registered to an app keeps in it (plan doc-mvwxcas3dom3, D4.2): GET, PUT
 *   and DELETE /v1/apps/:owner/:filename/party-data/:key. The records live under the APP OWNER's GHII,
 *   service-owned, keyed by the node (./contract.ts partyDataKey): one record per party per collection,
 *   never one key per field. The party names only the collection; the node puts its uid in the key, so
 *   a party reads and writes its own records and nothing else, and reads with `shared` the collections
 *   the app shares to all its parties. The owner, or the app's own token, writes the shared ones.
 * @structure getPartyData · putPartyData · deletePartyData · putSharedData
 * @usage const out = await getPartyData(deps, ctx, 'cart', { shared: false });
 * @version-history
 *   2026-11-04 — The collection count reads at most MAX_PARTY_COLLECTIONS meta rows, no values
 *     (codebase analysis 2026-11-03, item C1).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { rosterContext, rosterBucketOf, type RosterCaller } from '../app-roster-context.js';
import { done, refuse, type AppOpOutcome } from '../app-op-outcome.js';
import { tokenOfThisApp } from '../app-record-keys.js';
import { DATA_KEY_RE, MAX_PARTY_COLLECTIONS, MAX_PARTY_VALUE_BYTES, PARTY_DATA_PREFIX, partyDataKey, sharedDataKey } from './contract.js';
import { appKeySegment } from '../app-record-keys.js';
import { updateRecord } from '../record-cas.js';
import type { AppPartyCtx } from './service.js';

type Deps = { storage: Storage; config: AimeatConfig };

const badKey = () => refuse(400, 'INVALID_INPUT', 'The key is a collection name: 1 to 40 lowercase letters, digits, "-" or "_".');

/** Replace one collection, on its version (services/record-cas.ts). Answers the record as stored. */
async function write(storage: Storage, ownerGhii: string, key: string, value: unknown): Promise<MemoryRecord | null> {
    await updateRecord(storage, ownerGhii, key, v => v, () => value as Record<string, unknown>, { tag: 'app-party-data' });
    return storage.getMemory(ownerGhii, key);
}

const sizeOf = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');

/** Read the party's own collection, or with `shared` the app's shared one. Null when it holds nothing. */
export async function getPartyData(deps: Deps, ctx: AppPartyCtx, key: string, opts: { shared: boolean }): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    const rec = await deps.storage.getMemory(ctx.ownerGhii, opts.shared ? sharedDataKey(ctx.appId, key) : partyDataKey(ctx.appId, ctx.party.uid, key));
    return done({ key, shared: opts.shared, value: rec?.value ?? null, version: rec?.version ?? 0, updated_at: rec?.updatedAt ?? null });
}

/** Write the party's own collection. At most MAX_PARTY_COLLECTIONS collections of MAX_PARTY_VALUE_BYTES each. */
export async function putPartyData(deps: Deps, ctx: AppPartyCtx, key: string, value: unknown): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    if (value === undefined) return refuse(400, 'INVALID_INPUT', 'Send the value to keep: { "value": ... }.');
    if (sizeOf(value) > MAX_PARTY_VALUE_BYTES) return refuse(413, 'TOO_LARGE', `One collection holds at most ${MAX_PARTY_VALUE_BYTES / 1024} kB.`);
    const full = partyDataKey(ctx.appId, ctx.party.uid, key);
    if (!(await deps.storage.getMemory(ctx.ownerGhii, full))) {
        const prefix = `${PARTY_DATA_PREFIX}${appKeySegment(ctx.appId)}.${ctx.party.uid}.`;
        // `limit` stops the read at the ceiling: the comparison needs to know only whether there are that many.
        if ((await deps.storage.listMemoryMeta(ctx.ownerGhii, { prefix, limit: MAX_PARTY_COLLECTIONS })).length >= MAX_PARTY_COLLECTIONS) {
            return refuse(413, 'QUOTA_EXCEEDED', `A person keeps at most ${MAX_PARTY_COLLECTIONS} collections in one app.`);
        }
    }
    const rec = await write(deps.storage, ctx.ownerGhii, full, value);
    return done({ key, stored: true, version: rec?.version ?? 1, updated_at: rec?.updatedAt ?? null });
}

/** Delete the party's own collection. */
export async function deletePartyData(deps: Deps, ctx: AppPartyCtx, key: string): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    const deleted = await deps.storage.deleteMemory(ctx.ownerGhii, partyDataKey(ctx.appId, ctx.party.uid, key), ctx.ownerGhii);
    return done({ key, deleted: !!deleted });
}

/** Write a collection the app shares to every party of it: the app's owner, or its own token. */
export async function putSharedData(deps: Deps, caller: RosterCaller, ref: { owner: string; filename: string }, key: string, value: unknown): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    const c = await rosterContext(deps.storage, deps.config, caller, ref.owner, ref.filename);
    if (!c.ok) return c;
    if (!c.isOwner && !tokenOfThisApp(caller, c.appId)) return refuse(403, 'FORBIDDEN', 'Only the app\'s owner, or the app itself, writes what it shares to the people registered to it.');
    if (sizeOf(value) > MAX_PARTY_VALUE_BYTES) return refuse(413, 'TOO_LARGE', `One collection holds at most ${MAX_PARTY_VALUE_BYTES / 1024} kB.`);
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, c.owner);
    const k = sharedDataKey(c.appId, key);
    if (value === null) return done({ key, deleted: !!(await deps.storage.deleteMemory(ownerGhii, k, ownerGhii)) });
    const rec = await write(deps.storage, ownerGhii, k, value);
    return done({ key, shared: true, stored: true, version: rec?.version ?? 1 });
}
