/**
 * @file services/packages/compose/package-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading packages with the one visibility rule: a private package is visible to its
 *   author and to nobody else, and a stranger is told it does not exist rather than that it is
 *   private.
 *
 *   WHY THIS IS A SERVICE. The rule was written inline in four read routes, and the node's own MCP
 *   surface could not list or get a package at all — those tools existed only on the connector,
 *   which reaches the node over HTTP. An MCP tool that POSTs to its own route is a second
 *   implementation of the same gate, so the tools call this instead and the rule stays in one place.
 *
 *   THE CALLER IS AN OWNER NAME OR NOTHING. Anonymous reads pass `undefined`, which is the same
 *   thing the routes do when there is no session; nothing here reads a request.
 * @structure PackageReadCaller · listPackagesFor · getPackageFor · getPackageVersionFor ·
 *   listPackageVersionsFor · listInstancesFor
 * @usage
 *   import { getPackageFor } from './package-read.js';
 *   const pkg = await getPackageFor(storage, groupId, req.auth?.owner);
 * @version-history
 *   v1.3.0 — 2026-10-31 — packageVisibleTo: a private package its author sells to accounts is read by
 *     an account holding an active purchase and by the operator (sale/package-account-entitlement.ts;
 *     wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 *   v1.2.0 — 2026-10-17 — packageVisibleTo: 'members' and 'organism:<id>' are read by whom
 *     services/audience.ts admits; the caller may be the request's auth, so a visitor from another
 *     node is told apart from a local account (plan doc-mvcn6c7e4e5q, V3.7).
 *   v1.1.0 — 2026-09-28 — listInstancesFor: the owner's installed copies, for GET /v1/instances and
 *     the aimeat_package_instances MCP tool.
 *   v1.0.0 — 2026-09-05 — Extraction out of routes/packages.ts (four read routes). Behaviour
 *     unchanged; the node MCP surface gains list and get through it.
 */
import type { Storage, PackageRecord, PackageFilter, PackageInstanceRecord } from '../../../storage/interface.js';
import { parseAudience, audienceAllows, isNodeAccount, type AudienceAuth } from '../../audience.js';
import { readAccountSale, activePurchase } from '../sale/package-account-entitlement.js';
import { isOperatorCaller, type OperatorAuth } from '../../operator-override.js';

/**
 * Who is reading. A route passes the request's auth (or undefined), so a visitor from another node
 * and the anonymous identity are told apart from this node's accounts. A bare owner name is what a
 * service passes when it acts for a local account (an install set, a pull), and it reads as that
 * account.
 */
export type PackageReadCaller = string | AudienceAuth | undefined;

/** The author name a caller is compared to: the account name it carries. */
function authorNameOf(caller: PackageReadCaller): string | undefined {
    return typeof caller === 'string' ? caller : caller?.owner;
}

/**
 * The one visibility rule (plan doc-mvcn6c7e4e5q, V3.7): public to anyone, everything to its author,
 * 'members' and 'organism:<id>' to whom services/audience.ts admits, and private to nobody else.
 */
export async function packageVisibleTo(storage: Storage, pkg: PackageRecord, caller: PackageReadCaller): Promise<boolean> {
    if (pkg.visibility === 'public') return true;
    const name = authorNameOf(caller);
    if (name !== undefined && name === pkg.author) return true;
    const audience = parseAudience(pkg.visibility);
    if (audience?.level === 'private') return soldTo(storage, pkg, caller, name);
    if (!audience || audience.level === 'public') return false;
    const auth: AudienceAuth | undefined = typeof caller === 'string' ? { sub: caller, owner: caller } : caller;
    return audienceAllows(storage, audience, auth);
}

/**
 * A private package its author sells to accounts (sale/package-account-entitlement.ts): read by an
 * account of this node holding an active purchase, and by the node operator, who answers for what is
 * sold here. A visitor from another node, the anonymous identity and an account without a purchase
 * read nothing. A package that is not sold answers false without a second read.
 */
async function soldTo(storage: Storage, pkg: PackageRecord, caller: PackageReadCaller, name: string | undefined): Promise<boolean> {
    if (!name || name.includes('@')) return false;
    if (typeof caller === 'object' && !isNodeAccount(caller)) return false;
    const sale = await readAccountSale(storage, pkg.packageGroupId);
    if (!sale) return false;
    if (await activePurchase(storage, sale, name)) return true;
    return typeof caller === 'object' && isOperatorCaller(storage, caller as OperatorAuth);
}

export interface PackageListQuery {
    author?: string;
    category?: string;
    status?: string;
    // No `visibility`: it is decided in listPackagesFor, never asked for. See the note there.
    search?: string;
    limit?: number;
    offset?: number;
}

/**
 * List packages, defaulting to what the public may see.
 *
 * ASKING FOR YOUR OWN PACKAGES DROPS THE VISIBILITY FILTER. `?author=alice` read by alice returns
 * her private packages too, because a filter that hid them would make her own list lie to her.
 *
 * EVERY OTHER LIST IS PUBLIC, AND THE CALLER DOES NOT GET A SAY IN IT. The sentence that stood here
 * said the filter "cannot be used to read somebody else's private work", and the line under it did
 * the opposite: `visibility: ownList ? undefined : query.visibility ?? 'public'` passed the caller's
 * own word into a storage filter that means `where visibility = ?`. So `GET /v1/packages` — a door
 * with no authentication on it at all — answered `?visibility=private` with every author's private
 * packages, `components` and all, which is their CONTENT and not merely their names. Found by the
 * AI triage of 2026-09-13 and reproduced on aimeat.io before this was written.
 *
 * The value is now decided here and never read from the request: your own list, or the public one.
 * A package is `private` or `public` and nothing else, so there is no third answer to lose.
 */
export async function listPackagesFor(
    storage: Storage,
    caller: PackageReadCaller,
    query: PackageListQuery = {},
): Promise<{ packages: PackageRecord[]; total: number }> {
    const status = query.status ?? 'published';
    // A list is public or your own: a members or organism package is not listed to anyone but its
    // author (plan V3.7, "the public listing shows only public"); it is read and installed by id.
    const name = authorNameOf(caller);
    const ownList = Boolean(name) && query.author === name;

    const filter: PackageFilter = {
        author: query.author,
        category: query.category,
        status,
        visibility: ownList ? undefined : 'public',
        search: query.search,
        limit: Math.min(200, Math.max(1, query.limit ?? 50)),
        offset: Math.max(0, query.offset ?? 0),
    };

    return storage.listPackages(filter);
}

/** The latest published version of a group, or null when there is none the caller may see. */
export async function getPackageFor(
    storage: Storage, groupId: string, caller: PackageReadCaller,
): Promise<PackageRecord | null> {
    const pkg = await storage.getLatestPublished(groupId);
    if (!pkg) return null;
    return (await packageVisibleTo(storage, pkg, caller)) ? pkg : null;
}

/** One named version of a group, or null when there is none the caller may see. */
export async function getPackageVersionFor(
    storage: Storage, groupId: string, version: string, caller: PackageReadCaller,
): Promise<PackageRecord | null> {
    const pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    if (!pkg) return null;
    return (await packageVisibleTo(storage, pkg, caller)) ? pkg : null;
}

/**
 * The versions of a group the caller may see.
 *
 * `total` stays the storage layer's count of the whole group, which is what the route has always
 * returned; the array is what survived the filter. They differ for a stranger reading a group that
 * holds both public and private versions, and that is the honest pair: the page is what you may
 * read, the total is how the pager was built.
 */
export async function listPackageVersionsFor(
    storage: Storage, groupId: string, caller: PackageReadCaller,
    paging: { limit?: number; offset?: number } = {},
): Promise<{ versions: PackageRecord[]; total: number }> {
    const limit = Math.min(200, Math.max(1, paging.limit ?? 50));
    const offset = Math.max(0, paging.offset ?? 0);
    const result = await storage.listVersions(groupId, limit, offset);
    const versions: PackageRecord[] = [];
    for (const v of result.versions) if (await packageVisibleTo(storage, v, caller)) versions.push(v);
    return { versions, total: result.total };
}

/**
 * The owner's installed copies of packages. Only ever the caller's own: an install is filed under
 * the bare account name that installed it (package-install.ts), and nothing here takes another.
 * GET /v1/instances and the aimeat_package_instances MCP tool both read through this.
 */
export async function listInstancesFor(
    storage: Storage, owner: string,
    query: { packageGroupId?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ instances: PackageInstanceRecord[]; total: number }> {
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const offset = Math.max(0, query.offset ?? 0);
    return storage.listInstances({
        owner, packageGroupId: query.packageGroupId, status: query.status, limit, offset,
    });
}
