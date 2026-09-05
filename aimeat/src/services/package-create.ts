/**
 * @file services/package-create.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writing a package version: normalise the components, hold the ceilings, pick the
 *   version string, build the record, persist it. Two acts — the first version of a new group, and
 *   a new version of a group that already exists.
 *
 *   WHY THIS IS A SERVICE AND NOT A ROUTE BODY. The same sequence was written three times inside
 *   routes/packages.ts (create, versions, import), each with its own copy of the size arithmetic and
 *   its own hash function, and the composer added in the same work would have made a fourth. Lifting
 *   it here means one ceiling, one hash, one record shape, and a refusal that reads the same on
 *   every door — the HTTP route, the MCP tool, and the composer that builds a package out of the
 *   owner's own apps.
 *
 *   REFUSALS ARE RETURNED, NOT THROWN, in the same union shape package-install.ts uses. Every status
 *   code and message below is the one the route already answered; the route maps the union back to a
 *   response and changed none of them.
 * @structure PackageWriteResult · RawComponentInput · normalizeComponents · hashContent ·
 *   nextPackageVersion · createPackageGroup(deps, caller, input) · addPackageVersion(deps, caller, input)
 * @usage
 *   import { createPackageGroup } from '../services/package-create.js';
 *   const out = await createPackageGroup({ storage, config }, caller, { name, components });
 *   if (!out.ok) return res.status(out.status).json(error(nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extraction out of routes/packages.ts (create + versions), with three
 *     deliberate changes to what the create act does, each named here because a reader of the diff
 *     will otherwise take them for extraction slips:
 *     (1) `status` defaults to 'published', not 'draft'. A created package was unreachable: the
 *         list route defaults to status=published, GET reads getLatestPublished, and install refuses
 *         anything else — while no MCP or CLI tool exposed the PATCH that flips it. An agent could
 *         publish a package and then neither see it nor install it.
 *     (2) `visibility` defaults to 'private', not 'public'. The connector's own published tool
 *         description already said "default private", and creating is now an owner's act rather than
 *         an operator's, so a package must not become world-visible by omission.
 *     (3) `status` and `visibility` are validated. The create route accepted any string and stored
 *         it; the PATCH route has always answered 400 for the same value.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type {
    Storage,
    PackageRecord,
    PackageComponent,
    PackageComponentType,
} from '../storage/interface.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { emitChange } from './event-bus.js';

/** The per-author ceiling when config carries none. config.packageMaxPerAuthor normally wins. */
const MAX_PACKAGES_PER_AUTHOR = 100;

/** The only statuses and visibilities a package may hold. One list, read by every door. */
export const VALID_STATUSES = ['draft', 'published', 'archived'] as const;
export const VALID_VISIBILITIES = ['private', 'public'] as const;

export type PackageStatus = (typeof VALID_STATUSES)[number];
export type PackageVisibility = (typeof VALID_VISIBILITIES)[number];

/** Raw, client-supplied component shape from a request body or a parsed ZIP (pre-validation). */
export interface RawComponentInput {
    id: string;
    type: string;
    label?: string;
    content?: string;
    contentHash?: string;
    dependencies?: string[];
    meta?: Record<string, unknown>;
}

export type PackageWriteResult =
    | { ok: true; package: PackageRecord }
    | { ok: false; status: number; code: string; message: string };

export interface PackageCreateDeps {
    storage: Storage;
    config: AimeatConfig;
}

/** Who is writing. `sub` is only the fallback resolveGhii takes when the owner has no GHII record. */
export interface PackageCreateCaller {
    owner: string;
    sub: string;
}

export interface PackageCreateInput {
    name: string;
    components: RawComponentInput[];
    description?: string;
    category?: string;
    tags?: string[];
    visibility?: string;
    status?: string;
    changelog?: string;
    manifest?: string;
}

export interface PackageVersionInput {
    groupId: string;
    /** Omitted keeps the previous version's components, which is what the route has always done. */
    components?: RawComponentInput[];
    changelog?: string;
    manifest?: string;
    status?: string;
}

export interface PackageStatusInput {
    groupId: string;
    /** Omitted means the newest version in the group. Both providers order by version descending. */
    version?: string;
    /** Omitted keeps the status it has, which is what a PATCH with an empty body has always done. */
    status?: string;
}

/** SHA-256 of content, for change detection. The one hash function packages use. */
export function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Client shape → stored shape.
 *
 * THE HASH IS ALWAYS COMPUTED FROM THE CONTENT, never taken from the caller. A supplied hash used to
 * win, and a caller that fetched a package, edited one component and posted it back as a new version
 * sent the OLD hash with the NEW bytes — after which the update diff compared hash to hash, saw no
 * change, and the new version was invisible to every installed copy. Nothing needs the caller's
 * value: the ZIP path computes it from the file bytes anyway, so this costs one hash per component
 * and removes a whole class of silently wrong answers downstream.
 */
export function normalizeComponents(raw: RawComponentInput[]): PackageComponent[] {
    return raw.map(c => ({
        id: c.id,
        type: c.type as PackageComponentType,
        label: c.label ?? '',
        content: c.content ?? '',
        contentHash: hashContent(c.content ?? ''),
        dependencies: c.dependencies ?? [],
        ...(c.meta && Object.keys(c.meta).length > 0 ? { meta: c.meta } : {}),
    }));
}

/** Generate a date-based version string: v{YYYY}-{MM}-{DD}-{HHmm}. */
function generateVersion(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `v${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * The next version string for a group, with a `-2`, `-3` suffix when this minute already has one.
 * Two versions published inside the same minute would otherwise collide on the storage layer's
 * UNIQUE(packageGroupId, version).
 */
export async function nextPackageVersion(storage: Storage, groupId: string): Promise<string> {
    const version = generateVersion();
    const existing = await storage.listVersions(groupId, 100, 0);
    const sameMinute = existing.versions.filter(v => v.version.startsWith(version));
    return sameMinute.length > 0 ? `${version}-${sameMinute.length + 1}` : version;
}

/** Component count and total byte size against the node's ceilings. */
function checkCeilings(config: AimeatConfig, components: PackageComponent[]): PackageWriteResult | null {
    if (components.length > config.packageMaxComponents) {
        return {
            ok: false, status: 413, code: 'COMPONENT_LIMIT_EXCEEDED',
            message: `Package has ${components.length} components, max is ${config.packageMaxComponents}`,
        };
    }
    const totalSizeBytes = components.reduce((sum, c) => sum + Buffer.byteLength(c.content ?? '', 'utf-8'), 0);
    const maxSizeBytes = config.packageMaxSizeMb * 1024 * 1024;
    if (totalSizeBytes > maxSizeBytes) {
        return {
            ok: false, status: 413, code: 'SIZE_EXCEEDED',
            message: `Total component size ${(totalSizeBytes / 1024 / 1024).toFixed(1)}MB exceeds limit of ${config.packageMaxSizeMb}MB`,
        };
    }
    return null;
}

/** How many package groups this author already holds, against the per-author ceiling. */
export async function checkAuthorQuota(
    deps: PackageCreateDeps, owner: string,
): Promise<PackageWriteResult | null> {
    const maxPerAuthor = deps.config.packageMaxPerAuthor ?? MAX_PACKAGES_PER_AUTHOR;
    const existing = await deps.storage.listPackages({ author: owner, limit: 1, offset: 0 });
    if (existing.total >= maxPerAuthor) {
        return {
            ok: false, status: 413, code: 'QUOTA_EXCEEDED',
            message: `Maximum ${maxPerAuthor} packages per author. Archive unused packages first.`,
        };
    }
    return null;
}

/** The one place a package row is written, so the storage layer's uniqueness error reads the same. */
async function persist(storage: Storage, record: PackageRecord, name: string): Promise<PackageWriteResult> {
    try {
        const created = await storage.createPackage(record);
        emitChange('packages');
        return { ok: true, package: created };
    } catch (e) {
        const err = e as { message?: string; code?: string };
        if (err.message === 'PACKAGE_EXISTS' || err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'P2002') {
            return {
                ok: false, status: 409, code: 'CONFLICT',
                message: `Package "${name}" already exists for this author`,
            };
        }
        throw e;
    }
}

/**
 * Create the FIRST version of a package group.
 *
 * Refuses when this author already has a group of this name, and names the door that publishes a new
 * version instead. Authorisation happened before this call.
 */
export async function createPackageGroup(
    deps: PackageCreateDeps,
    caller: PackageCreateCaller,
    input: PackageCreateInput,
): Promise<PackageWriteResult> {
    const { storage, config } = deps;
    const { owner } = caller;

    if (!input.name || typeof input.name !== 'string') {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'name is required and must be a string' };
    }
    if (!Array.isArray(input.components) || input.components.length === 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'components must be an array with at least 1 item' };
    }

    const status = (input.status ?? 'published') as PackageStatus;
    if (!VALID_STATUSES.includes(status)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: `status must be one of: ${VALID_STATUSES.join(', ')}` };
    }
    const visibility = (input.visibility ?? 'private') as PackageVisibility;
    if (!VALID_VISIBILITIES.includes(visibility)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}` };
    }

    const components = normalizeComponents(input.components);

    const ceiling = checkCeilings(config, components);
    if (ceiling) return ceiling;

    const quota = await checkAuthorQuota(deps, owner);
    if (quota) return quota;

    const packageGroupId = `${input.name}::${owner}`;
    const existingGroup = await storage.listVersions(packageGroupId, 1, 0);
    if (existingGroup.total > 0) {
        return {
            ok: false, status: 409, code: 'CONFLICT',
            message: `Package "${input.name}" already exists for this author. Use POST /v1/packages/${encodeURIComponent(packageGroupId)}/versions to publish a new version.`,
        };
    }

    const now = new Date().toISOString();
    const record: PackageRecord = {
        id: randomUUID(),
        packageGroupId,
        name: input.name,
        author: owner,
        authorGhii: await resolveGhii(storage, owner, caller.sub),
        version: generateVersion(),
        changelog: input.changelog ?? '',
        description: input.description ?? '',
        category: input.category ?? 'other',
        tags: input.tags ?? [],
        visibility,
        status,
        components,
        manifest: input.manifest ?? '',
        createdAt: now,
        updatedAt: now,
    };

    return persist(storage, record, input.name);
}

/**
 * Publish a NEW VERSION of a group that already exists.
 *
 * The group's author is the only principal that may add to it, and that check reads the author on the
 * stored record rather than anything the caller supplied. No quota check: the group already counts
 * against it, so a new version of a package the author already holds costs nothing.
 */
export async function addPackageVersion(
    deps: PackageCreateDeps,
    caller: PackageCreateCaller,
    input: PackageVersionInput,
): Promise<PackageWriteResult> {
    const { storage, config } = deps;
    const { groupId } = input;

    const latest = await storage.getLatestPublished(groupId);
    const anyVersion = latest ?? (await storage.listVersions(groupId, 1, 0)).versions[0];
    if (!anyVersion) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Package group not found: ${groupId}` };
    }
    if (anyVersion.author !== caller.owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the package author can publish new versions' };
    }

    const status = (input.status ?? 'draft') as PackageStatus;
    if (!VALID_STATUSES.includes(status)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: `status must be one of: ${VALID_STATUSES.join(', ')}` };
    }

    // Omitted components mean "the same parts, new version": the stored ones are already normalised,
    // so they pass through rather than being re-hashed.
    const components = input.components
        ? normalizeComponents(input.components)
        : anyVersion.components;

    const ceiling = checkCeilings(config, components);
    if (ceiling) return ceiling;

    const now = new Date().toISOString();
    const record: PackageRecord = {
        id: randomUUID(),
        packageGroupId: groupId,
        name: anyVersion.name,
        author: anyVersion.author,
        authorGhii: anyVersion.authorGhii,
        version: await nextPackageVersion(storage, groupId),
        changelog: input.changelog ?? '',
        description: anyVersion.description,
        category: anyVersion.category,
        tags: anyVersion.tags,
        visibility: anyVersion.visibility,
        status,
        components,
        manifest: input.manifest ?? anyVersion.manifest,
        createdAt: now,
        updatedAt: now,
    };

    return persist(storage, record, anyVersion.name);
}

/**
 * Move one version between draft, published and archived.
 *
 * THE ACT THAT MADE PUBLISHING POSSIBLE. A package is created private and, before this had a door on
 * any MCP surface, the status could only be changed by PATCHing an exact version over HTTP. An agent
 * could therefore author a package and then neither see it (the read doors default to published) nor
 * install it (install refuses anything else).
 *
 * Omitting the version takes the newest one, which is what a person means by "publish it". The
 * author check reads the author on the stored record.
 */
export async function setPackageVersionStatus(
    deps: PackageCreateDeps,
    caller: PackageCreateCaller,
    input: PackageStatusInput,
): Promise<PackageWriteResult> {
    const { storage } = deps;
    const { groupId } = input;

    // Read, then author, then validate — the order the PATCH route has always used.
    const pkg = input.version
        ? await storage.getPackageByGroupAndVersion(groupId, input.version)
        : (await storage.listVersions(groupId, 1, 0)).versions[0] ?? null;

    if (!pkg) {
        const which = input.version ? `Version ${input.version} not found for package ${groupId}` : `Package not found: ${groupId}`;
        return { ok: false, status: 404, code: 'NOT_FOUND', message: which };
    }
    if (pkg.author !== caller.owner) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the package author can update version status' };
    }
    if (input.status !== undefined && !VALID_STATUSES.includes(input.status as PackageStatus)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: `status must be one of: ${VALID_STATUSES.join(', ')}` };
    }

    const status = (input.status ?? pkg.status) as PackageStatus;
    const updated = await storage.updatePackage(pkg.id, { status, updatedAt: new Date().toISOString() });
    if (!updated) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Version ${pkg.version} not found for package ${groupId}` };
    }
    emitChange('packages');
    return { ok: true, package: updated };
}
