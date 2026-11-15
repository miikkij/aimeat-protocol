/**
 * @file src/services/app-parties/data.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person registered to an app keeps in it (plan doc-mvwxcas3dom3, D4.2): GET, PUT
 *   and DELETE /v1/apps/:owner/:filename/party-data/:key. One row per party per collection in the
 *   AppPartyData table (storage/types/app-parties.ts), never one row per field. The party names only the
 *   collection; the node puts the party's uid in the row, so a party reads and writes its own rows and
 *   nothing else, and reads with `shared` the collections the app shares to all its parties (party uid
 *   APP_PARTY_SHARED). The owner, or the app's own token, writes the shared ones.
 *
 *   Until 2026-11-15 each collection was a memory key under the app owner's GHII, which counted toward
 *   the owner's own key budget; ./move-to-tables.ts moved them.
 * @structure getPartyData · putPartyData · deletePartyData · putSharedData
 * @usage const out = await getPartyData(deps, ctx, 'cart', { shared: false });
 * @version-history
 *   v1.1.0 — 2026-11-15 — The collections are AppPartyData rows; the collection count and the write are
 *     one transaction (storage putAppPartyData).
 *   2026-11-04 — The collection count reads at most MAX_PARTY_COLLECTIONS meta rows, no values
 *     (codebase analysis 2026-11-03, item C1).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2).
 */
import { APP_PARTY_SHARED, type Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { rosterContext, rosterBucketOf, type RosterCaller } from '../app/roster-context.js';
import { done, refuse, type AppOpOutcome } from '../app/op-outcome.js';
import { tokenOfThisApp } from '../app/record-keys.js';
import { DATA_KEY_RE, MAX_PARTY_COLLECTIONS, MAX_PARTY_VALUE_BYTES } from './contract.js';
import type { AppPartyCtx } from './service.js';

type Deps = { storage: Storage; config: AimeatConfig };

/**
 * The collections one app shares to its parties. They were memory keys under the owner with no count
 * of their own before 2026-11-15, held only by the owner's key budget (1000 by default); the rows keep
 * that number as their ceiling.
 */
const MAX_SHARED_COLLECTIONS = 1000;

const badKey = () => refuse(400, 'INVALID_INPUT', 'The key is a collection name: 1 to 40 lowercase letters, digits, "-" or "_".');

const sizeOf = (v: unknown): number => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');

/** Read the party's own collection, or with `shared` the app's shared one. Null when it holds nothing. */
export async function getPartyData(deps: Deps, ctx: AppPartyCtx, key: string, opts: { shared: boolean }): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    const row = await deps.storage.getAppPartyData(ctx.appId, opts.shared ? APP_PARTY_SHARED : ctx.party.uid, key);
    return done({ key, shared: opts.shared, value: row?.value ?? null, version: row?.version ?? 0, updated_at: row?.updatedAt ?? null });
}

/** Write the party's own collection. At most MAX_PARTY_COLLECTIONS collections of MAX_PARTY_VALUE_BYTES each. */
export async function putPartyData(deps: Deps, ctx: AppPartyCtx, key: string, value: unknown): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    if (value === undefined) return refuse(400, 'INVALID_INPUT', 'Send the value to keep: { "value": ... }.');
    const bytes = sizeOf(value);
    if (bytes > MAX_PARTY_VALUE_BYTES) return refuse(413, 'TOO_LARGE', `One collection holds at most ${MAX_PARTY_VALUE_BYTES / 1024} kB.`);
    const updatedAt = new Date().toISOString();
    const out = await deps.storage.putAppPartyData(
        { appId: ctx.appId, partyUid: ctx.party.uid, key, ownerGhii: ctx.ownerGhii, value, bytes, updatedAt }, MAX_PARTY_COLLECTIONS);
    if (!out.stored) return refuse(413, 'QUOTA_EXCEEDED', `A person keeps at most ${MAX_PARTY_COLLECTIONS} collections in one app.`);
    return done({ key, stored: true, version: out.version, updated_at: updatedAt });
}

/** Delete the party's own collection. */
export async function deletePartyData(deps: Deps, ctx: AppPartyCtx, key: string): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    return done({ key, deleted: await deps.storage.deleteAppPartyData(ctx.appId, ctx.party.uid, key) });
}

/** Write a collection the app shares to every party of it: the app's owner, or its own token. */
export async function putSharedData(deps: Deps, caller: RosterCaller, ref: { owner: string; filename: string }, key: string, value: unknown): Promise<AppOpOutcome> {
    if (!DATA_KEY_RE.test(key)) return badKey();
    const c = await rosterContext(deps.storage, deps.config, caller, ref.owner, ref.filename);
    if (!c.ok) return c;
    if (!c.isOwner && !tokenOfThisApp(caller, c.appId)) return refuse(403, 'FORBIDDEN', 'Only the app\'s owner, or the app itself, writes what it shares to the people registered to it.');
    const bytes = sizeOf(value);
    if (bytes > MAX_PARTY_VALUE_BYTES) return refuse(413, 'TOO_LARGE', `One collection holds at most ${MAX_PARTY_VALUE_BYTES / 1024} kB.`);
    if (value === null) return done({ key, deleted: await deps.storage.deleteAppPartyData(c.appId, APP_PARTY_SHARED, key) });
    const ownerGhii = await rosterBucketOf(deps.storage, deps.config, c.owner);
    const out = await deps.storage.putAppPartyData(
        { appId: c.appId, partyUid: APP_PARTY_SHARED, key, ownerGhii, value, bytes, updatedAt: new Date().toISOString() }, MAX_SHARED_COLLECTIONS);
    if (!out.stored) return refuse(413, 'QUOTA_EXCEEDED', `An app shares at most ${MAX_SHARED_COLLECTIONS} collections to the people registered to it.`);
    return done({ key, shared: true, stored: true, version: out.version });
}
