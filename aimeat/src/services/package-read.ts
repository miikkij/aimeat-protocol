/**
 * @file services/package-read.ts
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
 *   listPackageVersionsFor
 * @usage
 *   import { getPackageFor } from '../services/package-read.js';
 *   const pkg = await getPackageFor(storage, groupId, req.auth?.owner);
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extraction out of routes/packages.ts (four read routes). Behaviour
 *     unchanged; the node MCP surface gains list and get through it.
 */
import type { Storage, PackageRecord, PackageFilter } from '../storage/interface.js';

/** The owner name reading, or undefined when nobody is signed in. */
export type PackageReadCaller = string | undefined;

export interface PackageListQuery {
    author?: string;
    category?: string;
    status?: string;
    visibility?: string;
    search?: string;
    limit?: number;
    offset?: number;
}

/**
 * List packages, defaulting to what the public may see.
 *
 * ASKING FOR YOUR OWN PACKAGES DROPS THE VISIBILITY FILTER. `?author=alice` read by alice returns
 * her private packages too, because a filter that hid them would make her own list lie to her. Any
 * other author name keeps the filter, so this cannot be used to read somebody else's private work.
 */
export async function listPackagesFor(
    storage: Storage,
    caller: PackageReadCaller,
    query: PackageListQuery = {},
): Promise<{ packages: PackageRecord[]; total: number }> {
    const status = query.status ?? 'published';
    const visibility = query.visibility ?? 'public';
    const ownList = Boolean(caller) && query.author === caller;

    const filter: PackageFilter = {
        author: query.author,
        category: query.category,
        status,
        visibility: ownList ? undefined : visibility,
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
    if (pkg.visibility === 'private' && caller !== pkg.author) return null;
    return pkg;
}

/** One named version of a group, or null when there is none the caller may see. */
export async function getPackageVersionFor(
    storage: Storage, groupId: string, version: string, caller: PackageReadCaller,
): Promise<PackageRecord | null> {
    const pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    if (!pkg) return null;
    if (pkg.visibility === 'private' && caller !== pkg.author) return null;
    return pkg;
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
    return {
        versions: result.versions.filter(v => v.visibility === 'public' || v.author === caller),
        total: result.total,
    };
}
