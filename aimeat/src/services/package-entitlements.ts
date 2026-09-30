/**
 * @file services/package-entitlements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which customer node a package repository serves which private package to, and up to
 *   which version.
 *
 *   THE MODEL IS JOUNI'S (2026-09-28, wish-asennuspaketit-uusille-nodeille-ja-keskitetty-
 *   pakettireposit, decisions 8 and 10): a customer buys an install package once and pays monthly for
 *   updates and security. When the monthly fee ends, the install stays and receives no updates; to
 *   update again the customer buys the whole package again. So an entitlement is a node and an
 *   `updatesUntil` instant: the node may pull every published version made up to that instant and
 *   none made after it, and a null `updatesUntil` is a subscription that is running. Buying again
 *   moves the instant forward. Phase 5 (purchase) writes these; until then the package's author or
 *   an operator grants them.
 *
 *   WHERE IT LIVES. One record per package group in the system namespace `package-entitlements`, a
 *   literal with no `@`, so no principal can address it (the pattern of commerce/beneficiary-split.ts).
 *   A package's author could otherwise grant themselves entitlements to their own package from an app
 *   token, which is harmless, but a customer node's owner could not be kept from writing to it if it
 *   lived in anybody's namespace.
 *
 *   ONLY PRIVATE PACKAGES NEED ONE. A public package is served to everyone as before; the repository
 *   role (config.packageRepository) adds the entitled nodes to the readers of a private one.
 * @structure PackageEntitlement · readEntitlements() · grantEntitlement() · revokeEntitlement()
 *   · listEntitlements() · entitlementOf() · entitledVersion() · resolveNodeRead() · entitledGroupsOf()
 * @usage
 *   const pkg = await entitledVersion(storage, groupId, nodeId, versionParam);
 * @version-history
 *   2026-09-30 — A package bought inside a bundle whose update period is over answers UPDATES_ENDED
 *     (after the node's signature is checked) instead of a bare 403 (updatesEndedInBundle).
 *   v1.1.0 — 2026-09-28 — Release channels (Jouni, 2026-09-28): an entitlement follows `stable` (published
 *     versions) or `beta` (beta versions too); the listing names the channel. UPDATES_ENDED only when a
 *     version on the node's channel was made after its cutoff; anything else a held node cannot have is
 *     NOT_FOUND. Channels apply to private packages, the ones served by entitlement.
 *     entitlementOf(): an entitlement to an install bundle carries the packages the bundle lists, from
 *     the same author, on the bundle's terms (install packages, phase 4).
 *   v1.2.0 — 2026-09-28 — A grant with `node` registers an unknown node as a packages-only peer
 *     (package-peer-register.ts), and a peer that shares no catalogue is heard for what it holds an
 *     entitlement to (install packages, phase 5; approved by Jouni 2026-09-28).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { Storage, PackageRecord } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { verifyPackageNode } from './package-node-auth.js';
import { bundleOfPackage } from './install-set-spec.js';
import { checkPackagePeer, registerPackagePeer } from './package-peer-register.js';

export const NS_PACKAGE_ENTITLEMENTS = 'package-entitlements';

export type PackageChannel = 'stable' | 'beta';

export interface PackageEntitlement {
    nodeId: string;
    /** Versions published after this instant are not served to the node. Null: the updates run on. */
    updatesUntil: string | null;
    /**
     * `stable` (the default, and what a grant written before channels existed reads as): published
     * versions only. `beta`: `beta` versions too, the newest of either. Jouni, 2026-09-28.
     */
    channel?: PackageChannel;
    note?: string;
    grantedAt: string;
    grantedBy: string;
    updatedAt: string;
}

type Record_ = { groupId: string; nodes: Record<string, PackageEntitlement> };

const key = (groupId: string): string => `entitlements.${groupId}`;

export async function readEntitlements(storage: Storage, groupId: string): Promise<PackageEntitlement[]> {
    const rec = await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, key(groupId));
    const value = rec?.value as Record_ | undefined;
    return value?.nodes ? Object.values(value.nodes) : [];
}

async function write(storage: Storage, groupId: string, nodes: Record<string, PackageEntitlement>): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, key(groupId));
    await storage.setMemory({
        key: key(groupId),
        ownerGaii: NS_PACKAGE_ENTITLEMENTS,
        value: { groupId, nodes } satisfies Record_,
        visibility: 'private',
        tags: ['package-entitlements'],
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    });
}

export type EntitlementResult =
    | { ok: true; entitlement: PackageEntitlement; peerRegistered?: boolean }
    | { ok: false; status: number; code: string; message: string };

/** Only the package's author or an operator decides who a package is served to. */
async function mayManage(storage: Storage, groupId: string, caller: { owner: string; isOperator: boolean }): Promise<EntitlementResult | null> {
    const latest = (await storage.listVersions(groupId, 1, 0)).versions[0];
    if (!latest) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Package not found: ${groupId}` };
    if (latest.author !== caller.owner && !caller.isOperator) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the package\'s author or an operator decides which nodes it is served to.' };
    }
    return null;
}

const NODE_RE = /^[a-z0-9][a-z0-9.-]{2,127}$/i;

/**
 * Grant a node the package, or change the grant: `updatesUntil` null keeps the updates running.
 * With `node` ({ url, public_key }) and the peers, a node this repository does not know yet is
 * registered as a packages-only peer in the same call (package-peer-register.ts), after every other
 * check has passed.
 */
export async function grantEntitlement(
    storage: Storage,
    caller: { owner: string; isOperator: boolean },
    input: { groupId: string; nodeId: string; updatesUntil?: unknown; note?: unknown; channel?: unknown; node?: unknown },
    peers?: Map<string, PeerInfo>,
): Promise<EntitlementResult> {
    const refused = await mayManage(storage, input.groupId, caller);
    if (refused) return refused;
    if (!NODE_RE.test(input.nodeId)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'node_id is a node id such as "aimeat-customer-001".' };
    if (input.channel !== undefined && input.channel !== 'stable' && input.channel !== 'beta') {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'channel is "stable" or "beta".' };
    }
    let updatesUntil: string | null = null;
    if (input.updatesUntil !== undefined && input.updatesUntil !== null) {
        const t = typeof input.updatesUntil === 'string' ? Date.parse(input.updatesUntil) : NaN;
        if (!Number.isFinite(t)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'updates_until is an ISO date-time, or null for updates that run on.' };
        updatesUntil = new Date(t).toISOString();
    }
    let peerRegistered = false;
    if (input.node !== undefined && input.node !== null) {
        if (!peers) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'node cannot be registered on this path.' };
        const check = checkPackagePeer(peers, input.nodeId, input.node);
        if (!check.ok) return check;
        if (check.add) { await registerPackagePeer(storage, peers, check.add); peerRegistered = true; }
    }
    const now = new Date().toISOString();
    const current = Object.fromEntries((await readEntitlements(storage, input.groupId)).map(e => [e.nodeId, e]));
    const prev = current[input.nodeId];
    const entitlement: PackageEntitlement = {
        nodeId: input.nodeId,
        updatesUntil,
        channel: (input.channel as PackageChannel | undefined) ?? prev?.channel ?? 'stable',
        ...(typeof input.note === 'string' && input.note ? { note: input.note.slice(0, 500) } : prev?.note ? { note: prev.note } : {}),
        grantedAt: prev?.grantedAt ?? now,
        grantedBy: prev?.grantedBy ?? caller.owner,
        updatedAt: now,
    };
    await write(storage, input.groupId, { ...current, [input.nodeId]: entitlement });
    return { ok: true, entitlement, peerRegistered };
}

export async function revokeEntitlement(
    storage: Storage, caller: { owner: string; isOperator: boolean }, groupId: string, nodeId: string,
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
    const refused = await mayManage(storage, groupId, caller);
    if (refused) return refused as { ok: false; status: number; code: string; message: string };
    const current = Object.fromEntries((await readEntitlements(storage, groupId)).map(e => [e.nodeId, e]));
    if (!current[nodeId]) return { ok: false, status: 404, code: 'NOT_FOUND', message: `${nodeId} holds no entitlement to ${groupId}.` };
    delete current[nodeId];
    await write(storage, groupId, current);
    return { ok: true };
}

export async function listEntitlements(
    storage: Storage, caller: { owner: string; isOperator: boolean }, groupId: string,
): Promise<{ ok: true; entitlements: PackageEntitlement[] } | { ok: false; status: number; code: string; message: string }> {
    const refused = await mayManage(storage, groupId, caller);
    if (refused) return refused as { ok: false; status: number; code: string; message: string };
    return { ok: true, entitlements: await readEntitlements(storage, groupId) };
}

/**
 * The version of a private package this node may have: the newest one on its channel made up to its
 * `updatesUntil`, or the one it names if that one is within its entitlement. Null when the node holds
 * no entitlement, or the version it names was made after its updates ended.
 */
export async function entitledVersion(
    storage: Storage, groupId: string, nodeId: string, version?: string,
): Promise<PackageRecord | null> {
    const ent = await entitlementOf(storage, groupId, nodeId);
    if (!ent) return null;
    const until = ent.updatesUntil ? Date.parse(ent.updatesUntil) : Infinity;
    const allowed = (await channelVersions(storage, groupId, ent, version))
        .filter(v => Date.parse(v.createdAt) <= until);
    return allowed[0] ?? null;
}

/**
 * The node's entitlement to `groupId`: its own, or the one it holds to an install bundle of the same
 * author that lists the package (install-set-spec.ts). A customer buys the bundle, and the bundle's
 * packages come with it on the bundle's terms: the same end of updates and the same channel.
 */
export async function entitlementOf(storage: Storage, groupId: string, nodeId: string): Promise<PackageEntitlement | null> {
    const own = (await readEntitlements(storage, groupId)).find(e => e.nodeId === nodeId);
    if (own) return own;
    const author = groupId.split('::')[1];
    for (const { groupId: held, entitlement } of await entitledGroupsOf(storage, nodeId)) {
        if (held === groupId || held.split('::')[1] !== author) continue;
        // The bundle version the node may have: a package added to the bundle after its updates
        // ended does not come with it.
        const until = entitlement.updatesUntil ? Date.parse(entitlement.updatesUntil) : Infinity;
        const pkg = (await channelVersions(storage, held, entitlement)).find(v => Date.parse(v.createdAt) <= until);
        const bundle = pkg ? bundleOfPackage(pkg) : null;
        if (bundle?.ok && bundle.value.packages.some(p => p.groupId === groupId)) return entitlement;
    }
    return null;
}

/** The versions on the entitlement's channel, newest first; only `version` when it names one. */
async function channelVersions(
    storage: Storage, groupId: string, ent: PackageEntitlement, version?: string,
): Promise<PackageRecord[]> {
    const statuses = ent.channel === 'beta' ? ['published', 'beta'] : ['published'];
    const { versions } = await storage.listVersions(groupId, 200, 0);
    return versions
        .filter(v => statuses.includes(v.status) && (!version || v.version === version))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Whether the node holds an entitlement and was refused only because its updates ended: a version on
 * its channel exists and was made after `updatesUntil`. A beta version asked for on the stable
 * channel is not that case, and the endpoint answers it as not found.
 */
/**
 * Whether `nodeId` bought `groupId` inside a bundle whose update period is over, with no bundle
 * version from before the end that lists it. entitlementOf() answers null then, so the node used to
 * get a bare 403 for a package it had paid for, and its owner read `SOURCE_REFUSED ... 403`
 * (the shop's test, 2026-09-30). The node is still a customer whose updates ended.
 */
async function updatesEndedInBundle(storage: Storage, groupId: string, nodeId: string): Promise<boolean> {
    const author = groupId.split('::')[1];
    for (const { groupId: held, entitlement } of await entitledGroupsOf(storage, nodeId)) {
        if (held === groupId || held.split('::')[1] !== author || !entitlement.updatesUntil) continue;
        if (Date.parse(entitlement.updatesUntil) > Date.now()) continue;
        for (const v of await channelVersions(storage, held, entitlement)) {
            const bundle = bundleOfPackage(v);
            if (bundle?.ok && bundle.value.packages.some(p => p.groupId === groupId)) return true;
        }
    }
    return false;
}

async function updatesEndedFor(storage: Storage, groupId: string, nodeId: string, version?: string): Promise<boolean> {
    const ent = await entitlementOf(storage, groupId, nodeId);
    if (!ent?.updatesUntil) return false;
    const until = Date.parse(ent.updatesUntil);
    return (await channelVersions(storage, groupId, ent, version)).some(v => Date.parse(v.createdAt) > until);
}

export type NodeRead =
    | { kind: 'unsigned' }
    | { kind: 'refused'; status: number; code: string; message: string }
    | { kind: 'served'; pkg: PackageRecord; nodeId: string };

/**
 * A read of `groupId` by another node, on the repository's terms. `unsigned` when the request names
 * no node, and the endpoint answers on visibility as it always has. With the repository role off, a
 * signed request is `unsigned` too: nothing private is served on a node that has not taken the role.
 */
export async function resolveNodeRead(
    storage: Storage, config: { packageRepository: boolean }, peers: Map<string, PeerInfo>,
    headers: Record<string, string | string[] | undefined>, groupId: string, version?: string,
): Promise<NodeRead> {
    if (!config.packageRepository) return { kind: 'unsigned' };
    const who = await verifyPackageNode(headers, peers, groupId, Date.now(),
        // A node whose bundle's updates ended is let through the peer gate too, so its signature is
        // checked before it hears anything about its purchase; it is served nothing.
        async nodeId => (await entitlementOf(storage, groupId, nodeId)) !== null || await updatesEndedInBundle(storage, groupId, nodeId));
    if (!who) return { kind: 'unsigned' };
    if (!who.ok) return { kind: 'refused', status: who.status, code: who.code, message: who.message };
    const latest = (await storage.listVersions(groupId, 1, 0)).versions[0];
    if (!latest || latest.visibility === 'public') return { kind: 'unsigned' };
    const pkg = await entitledVersion(storage, groupId, who.nodeId, version);
    if (!pkg) {
        return (await updatesEndedFor(storage, groupId, who.nodeId, version) || await updatesEndedInBundle(storage, groupId, who.nodeId))
            ? { kind: 'refused', status: 403, code: 'UPDATES_ENDED', message: `${who.nodeId}'s updates for ${groupId} ended before that version was published. Buying the package again brings them back.` }
            : { kind: 'refused', status: 404, code: 'NOT_FOUND', message: `Package not found: ${groupId}` };
    }
    return { kind: 'served', pkg, nodeId: who.nodeId };
}

export interface RepositoryListingEntry {
    group_id: string;
    name: string;
    version: string;
    published_at: string;
    description: string;
    category: string;
    visibility: 'public' | 'private';
    updates_until: string | null;
    channel: PackageChannel;
}

/**
 * What `nodeId` may pull here: every published public package (its latest version), and each private
 * one it is entitled to (the latest version its entitlement reaches).
 */
export async function repositoryListing(storage: Storage, nodeId: string, opts: { includePublic?: boolean } = {}): Promise<RepositoryListingEntry[]> {
    const out: RepositoryListingEntry[] = [];
    const { packages } = opts.includePublic === false
        ? { packages: [] }
        : await storage.listPackages({ status: 'published', visibility: 'public', limit: 500 });
    const seen = new Set<string>();
    for (const p of packages) {
        if (seen.has(p.packageGroupId)) continue;
        seen.add(p.packageGroupId);
        out.push({
            group_id: p.packageGroupId, name: p.name, version: p.version, published_at: p.createdAt,
            description: p.description, category: p.category, visibility: 'public', updates_until: null, channel: 'stable',
        });
    }
    for (const { groupId, entitlement } of await entitledGroupsOf(storage, nodeId)) {
        const pkg = await entitledVersion(storage, groupId, nodeId);
        if (!pkg || seen.has(groupId)) continue;
        out.push({
            group_id: groupId, name: pkg.name, version: pkg.version, published_at: pkg.createdAt,
            description: pkg.description, category: pkg.category, visibility: 'private', updates_until: entitlement.updatesUntil,
            channel: entitlement.channel ?? 'stable',
        });
    }
    return out;
}

/** The private packages this node is entitled to, for the repository's listing. */
export async function entitledGroupsOf(storage: Storage, nodeId: string): Promise<Array<{ groupId: string; entitlement: PackageEntitlement }>> {
    const rows = await storage.listMemory(NS_PACKAGE_ENTITLEMENTS, { prefix: 'entitlements.' });
    const out: Array<{ groupId: string; entitlement: PackageEntitlement }> = [];
    for (const row of rows) {
        const value = row.value as Record_ | undefined;
        const ent = value?.nodes?.[nodeId];
        if (value && ent) out.push({ groupId: value.groupId, entitlement: ent });
    }
    return out;
}
