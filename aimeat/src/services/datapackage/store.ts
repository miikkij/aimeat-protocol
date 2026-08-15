/**
 * @file src/services/datapackage/store.ts
 * @description Publishing and reading an AIMEAT Data Package — the one implementation the three
 *   bindings (ctx.datapackage, the browser library, the MCP tools) all reach.
 *
 *   REFUSE BEFORE YOU WRITE. `publish` validates every resource against its own Table Schema and
 *   returns the coordinates of what is wrong WITHOUT having stored a byte. The order is the point:
 *   this node's own audit found three defects of exactly one shape — bytes written before the name
 *   was claimed, a paywall standing down before comparing the coordinate, a response sent before the
 *   work it announced. A publish that wrote the CSV and then discovered the schema was violated would
 *   leave a half-version at a permanent address, which is worse than no version at all.
 *
 *   AND A FAILED RUN LEAVES THE PREVIOUS VERSION STANDING. `recordFailure` writes the reason onto
 *   the mutable `latest.json` pointer and touches nothing else, so a consumer following the newest
 *   version keeps reading the last good one and can see that the newest attempt failed, when, and
 *   why. No empty version, no truncated version, no silent success.
 *
 *   TWO SURFACES, ONE TRUTH. The BYTES in storage are canonical — a permanent, auth-free,
 *   range-readable address that DuckDB, pandas and frictionless-py read with no AIMEAT knowledge.
 *   The knowledge package written beside them is a CATALOGUE entry (`content_type: 'dataset'`, the
 *   value the closed union already has — `data-package` is not in it) so the package appears where a
 *   person and an agent look for knowledge. The catalogue points at the bytes; it never holds them,
 *   because a knowledge package is a collection of memory entries and memory does not carry files.
 * @structure publishPackage · openPackage · readRows · recordFailure · listPackages
 * @usage
 *   const out = await publishPackage({ storage, config }, ownerGhii, input, producedBy);
 *   if (!out.ok) return out.issues;
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, A4/B1/B2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { writeStorageFile } from '../storage-file-write.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { provenanceForWrite, type DeclaredProvenance } from '../ai-provenance.js';
import { stableStringify } from '../../utils/stable-json.js';
import { logger } from '../../utils/logger.js';
import {
    type Descriptor, type DescriptorResource, type LatestPointer, type PublishInput, type TableSchema,
    bare, bytesHash, contentHashOf, descriptorKey, latestKey, packageId, packageKeyRoot,
    publicUrl, resourceKey, resourcePath, validateName, RESOURCE_NAME_RE,
} from './contract.js';
import { inferSchema, toCsv, fromCsv, validateRows, type ValidationIssue } from './table.js';

export interface StoreDeps { storage: Storage; config: AimeatConfig }

/** Who produced this version. Every road knows it; none of them may make it up. */
export interface ProducedBy {
    /** The exact principal: an owner GHII, an agent GAII, or the owner on an unattended road. */
    gaii: string;
    kind: Descriptor['aimeat']['producer']['kind'];
    ref?: string;
    schedule?: string;
    run?: string;
}

export type PublishResult =
    | { ok: true; descriptor: Descriptor; contentHash: string; descriptorUrl: string; unchanged: boolean;
        resources: Array<{ name: string; url: string; rowCount: number; bytes: number }> }
    | { ok: false; code: 'INVALID_INPUT' | 'QUALITY_GATE'; message: string; issues: ValidationIssue[] };

/**
 * Build, check and store one version.
 *
 * `unchanged: true` means the content hash matched what is already published: the same address
 * already holds these exact bytes, so nothing was rewritten. That is not a failure and not a new
 * version — it is a deterministic producer proving it is deterministic, and the caller should say
 * so rather than announcing an update that did not happen.
 */
export async function publishPackage(
    deps: StoreDeps, ownerGhii: string, input: PublishInput, producedBy: ProducedBy,
): Promise<PublishResult> {
    const { storage, config } = deps;
    const ownerName = ownerGhii.split('@')[0];

    const nameError = validateName(input.name);
    if (nameError) return { ok: false, code: 'INVALID_INPUT', message: nameError, issues: [] };
    if (!input.changes || !input.changes.trim()) {
        return {
            ok: false, code: 'INVALID_INPUT', issues: [],
            message: 'changes is required: every version says what moved against the previous one and why. '
                + 'A version nobody explained is a version a consumer cannot decide about.',
        };
    }
    if (!Array.isArray(input.resources) || input.resources.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'a package needs at least one resource', issues: [] };
    }

    // ── 1. Schema, then the gate. Nothing is serialised until every resource passes. ──
    const issues: ValidationIssue[] = [];
    const prepared: Array<{ name: string; schema: TableSchema; inferred: boolean; rows: Array<Record<string, unknown>>; title?: string; description?: string }> = [];
    for (const res of input.resources) {
        if (!RESOURCE_NAME_RE.test(res.name)) {
            return { ok: false, code: 'INVALID_INPUT', issues: [],
                message: `resource name "${res.name}" must be lowercase letters, digits and dashes, 2-64 characters` };
        }
        if (!Array.isArray(res.rows)) {
            return { ok: false, code: 'INVALID_INPUT', message: `resource "${res.name}" has no rows array`, issues: [] };
        }
        const inferred = res.schema === 'infer';
        const schema = inferred ? inferSchema(res.rows) : (res.schema as TableSchema);
        if (!schema?.fields?.length) {
            return { ok: false, code: 'INVALID_INPUT', issues: [],
                message: `resource "${res.name}" has no fields — an empty schema describes nothing` };
        }
        issues.push(...validateRows(res.name, res.rows, schema));
        prepared.push({ name: res.name, schema, inferred, rows: res.rows, title: res.title, description: res.description });
    }
    if (issues.length > 0) {
        return {
            ok: false, code: 'QUALITY_GATE', issues,
            message: `${issues.length} row/column problem(s): the data does not validate against its own Table Schema, `
                + 'so no version was written and the package still stands on its previous one.',
        };
    }

    // ── 2. Serialise. Canonical CSV, hashed per resource. ──
    const bodies = prepared.map(p => {
        const data = toCsv(p.rows, p.schema);
        return { ...p, data, hash: bytesHash(data) };
    });

    const schemaSource: Descriptor['aimeat']['schemaSource'] =
        bodies.every(b => b.inferred) ? 'inferred' : bodies.some(b => b.inferred) ? 'mixed' : 'declared';

    const resources: DescriptorResource[] = bodies.map(b => ({
        name: b.name,
        path: resourcePath(b.name),
        profile: 'tabular-data-resource',
        format: 'csv',
        mediatype: 'text/csv',
        encoding: 'utf-8',
        schema: b.schema,
        rowCount: b.rows.length,
        bytes: b.data.length,
        hash: b.hash,
        ...(b.title ? { title: b.title } : {}),
        ...(b.description ? { description: b.description } : {}),
    }));

    const now = new Date().toISOString();
    const withoutHash = {
        name: input.name,
        profile: 'tabular-data-package' as const,
        resources,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.provenance?.license ? { licenses: [{ name: input.provenance.license }] } : {}),
        created: now,
        aimeat: {
            packageId: packageId(ownerName, input.name),
            changes: input.changes.trim(),
            producer: {
                kind: producedBy.kind,
                ...(producedBy.ref ? { ref: producedBy.ref } : {}),
                ...(producedBy.schedule ? { schedule: producedBy.schedule } : {}),
            },
            producedBy: { gaii: producedBy.gaii, ...(producedBy.run ? { run: producedBy.run } : {}), at: now },
            schemaSource,
            ...(input.parameters ? { parameters: input.parameters } : {}),
            ...(input.provenance ?? {}),
            ...(input.retentionPolicy ? { retentionPolicy: input.retentionPolicy } : {}),
        },
    };
    const contentHash = contentHashOf(withoutHash);
    const descriptor: Descriptor = { ...withoutHash, aimeat: { ...withoutHash.aimeat, contentHash } };

    // TARGET-058: an agent publishing a package is model-touched output, and that gets DECLARED
    // rather than inferred from the shape of the caller. `provenanceForWrite` decides from the
    // PRINCIPAL whether a record is minted at all — an owner publishing through their own token is
    // never stamped — so this is one call rather than a branch here. It lands AFTER the hash on
    // purpose: a provenance id is a fresh UUID, and putting it inside the identity would make two
    // identical runs produce two versions.
    const aiProvenanceId = await provenanceForWrite(storage, {
        principal: producedBy.gaii,
        content: stableStringify(descriptor),
        declaredId: input.declaredProvenanceId,
        declared: input.declaredProvenance as DeclaredProvenance | undefined,
        pipeline: `datapackage.publish.${producedBy.kind}`,
        // A published package is world-readable at a permanent address and is read by people as well
        // as programs, which is exactly the surface the disclosure rules are written for.
        surface: { visibility: 'public', humanAudience: true },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
        enabled: config.aiProvenance,
    });
    if (aiProvenanceId) descriptor.aimeat.aiProvenanceId = aiProvenanceId;

    // ── 3. Already published? The address carries the hash, so the same bytes are already there. ──
    const dKey = descriptorKey(input.name, contentHash);
    const existing = await storage.getStorageFile(ownerGhii, dKey);
    const descriptorUrl = publicUrl(config.baseUrl, ownerGhii, dKey);
    const resourceUrls = bodies.map(b => ({
        name: b.name,
        url: publicUrl(config.baseUrl, ownerGhii, resourceKey(input.name, contentHash, b.name)),
        rowCount: b.rows.length,
        bytes: b.data.length,
    }));
    if (existing) {
        await writeLatest(deps, ownerGhii, input.name, contentHash, descriptorUrl, now);
        return { ok: true, descriptor, contentHash, descriptorUrl, unchanged: true, resources: resourceUrls };
    }

    // ── 4. Write. Bytes first, descriptor last: a descriptor is a promise about resources, and a
    //       reader that finds one must find what it points at. ──
    for (const b of bodies) {
        const written = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
            key: resourceKey(input.name, contentHash, b.name),
            data: b.data,
            mimeType: 'text/csv; charset=utf-8',
            visibility: 'public',
        });
        if (!written.ok) {
            return { ok: false, code: 'INVALID_INPUT', issues: [],
                message: `storing resource "${b.name}" failed: ${written.message}` };
        }
    }
    const descriptorBytes = Buffer.from(JSON.stringify(descriptor, null, 2) + '\n', 'utf8');
    const wroteDescriptor = await writeStorageFile({ storage, config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
        key: dKey,
        data: descriptorBytes,
        mimeType: 'application/json; charset=utf-8',
        visibility: 'public',
    });
    if (!wroteDescriptor.ok) {
        return { ok: false, code: 'INVALID_INPUT', message: `storing the descriptor failed: ${wroteDescriptor.message}`, issues: [] };
    }

    await writeLatest(deps, ownerGhii, input.name, contentHash, descriptorUrl, now);
    await upsertCatalogueEntry(deps, ownerGhii, descriptor, descriptorUrl).catch(err => {
        // The bytes ARE the package; the catalogue is where a person finds it. A catalogue failure
        // must not un-publish a version that is already at its permanent address, and it must not be
        // swallowed either — an operator seeing this knows a package is live and unlisted.
        logger.warn('datapackage: catalogue entry failed, the package is published and unlisted', {
            package: descriptor.aimeat.packageId, error: String(err),
        });
    });

    return { ok: true, descriptor, contentHash, descriptorUrl, unchanged: false, resources: resourceUrls };
}

/** The mutable pointer for a consumer following the newest version. Clears any recorded failure:
 *  a successful publish IS the answer to "the last attempt broke". */
async function writeLatest(
    deps: StoreDeps, ownerGhii: string, name: string, contentHash: string, descriptorUrl: string, at: string,
): Promise<void> {
    const pointer: LatestPointer = {
        packageId: packageId(ownerGhii.split('@')[0], name),
        name, contentHash, descriptorUrl, updatedAt: at,
    };
    await writeStorageFile({ storage: deps.storage, config: deps.config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
        key: latestKey(name),
        data: Buffer.from(JSON.stringify(pointer, null, 2) + '\n', 'utf8'),
        mimeType: 'application/json; charset=utf-8',
        visibility: 'public',
    });
}

/**
 * A run failed. The package stays on the version it had; the pointer says the newest attempt did not
 * land, when, and why. This is the whole of "epäonnistuminen näkyy, eikä sitä peitetä": no empty
 * version is written, and a consumer polling `latest.json` learns the difference between a package
 * that has not changed and one whose producer is broken.
 */
export async function recordFailure(
    deps: StoreDeps, ownerGhii: string, name: string, message: string,
): Promise<void> {
    const key = latestKey(name);
    const existing = await deps.storage.getStorageFile(ownerGhii, key);
    let pointer: LatestPointer;
    if (existing) {
        pointer = JSON.parse(existing.data.toString('utf8')) as LatestPointer;
    } else {
        pointer = {
            packageId: packageId(ownerGhii.split('@')[0], name),
            name, contentHash: '', descriptorUrl: '', updatedAt: new Date().toISOString(),
        };
    }
    pointer.lastError = { at: new Date().toISOString(), message: message.slice(0, 1000) };
    await writeStorageFile({ storage: deps.storage, config: deps.config, emitResourceUpdated, emitResourceListChanged }, ownerGhii, {
        key,
        data: Buffer.from(JSON.stringify(pointer, null, 2) + '\n', 'utf8'),
        mimeType: 'application/json; charset=utf-8',
        visibility: 'public',
    });
}

export interface OpenedPackage { descriptor: Descriptor; descriptorUrl: string; latest?: LatestPointer }

/**
 * Read a package back. `ref` is `pkg:{owner}/{name}` for the newest version, or
 * `pkg:{owner}/{name}@sha256:…` to pin one. A pinned reference always answers with the same bytes,
 * which is what makes pinning worth anything.
 */
export async function openPackage(deps: StoreDeps, ref: string, nodeId: string): Promise<OpenedPackage | null> {
    const parsed = parseRef(ref, nodeId);
    if (!parsed) return null;
    const { ownerGhii, name, contentHash } = parsed;

    let hash = contentHash;
    let latest: LatestPointer | undefined;
    if (!hash) {
        const pointerFile = await deps.storage.getStorageFile(ownerGhii, latestKey(name));
        if (!pointerFile) return null;
        latest = JSON.parse(pointerFile.data.toString('utf8')) as LatestPointer;
        if (!latest.contentHash) return null;   // only a failure has ever been recorded
        hash = latest.contentHash;
    }
    const file = await deps.storage.getStorageFile(ownerGhii, descriptorKey(name, hash));
    if (!file) return null;
    return {
        descriptor: JSON.parse(file.data.toString('utf8')) as Descriptor,
        descriptorUrl: publicUrl(deps.config.baseUrl, ownerGhii, descriptorKey(name, hash)),
        ...(latest ? { latest } : {}),
    };
}

/** Rows of one resource, paginated. The caller names the window; nothing here decides to send a
 *  whole table into somebody's context because it happened to fit. */
export async function readRows(
    deps: StoreDeps, ref: string, nodeId: string, resource: string, opts: { offset?: number; limit?: number; select?: string[] } = {},
): Promise<{ rows: Array<Record<string, unknown>>; total: number; schema: TableSchema } | null> {
    const parsed = parseRef(ref, nodeId);
    const opened = await openPackage(deps, ref, nodeId);
    if (!parsed || !opened) return null;
    const res = opened.descriptor.resources.find(r => r.name === resource);
    if (!res) return null;
    const hash = opened.descriptor.aimeat.contentHash;
    const file = await deps.storage.getStorageFile(parsed.ownerGhii, resourceKey(parsed.name, hash, resource));
    if (!file) return null;

    const all = fromCsv(file.data, res.schema);
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(Math.max(1, opts.limit ?? 500), 5000);
    let rows = all.slice(offset, offset + limit);
    let schema = res.schema;
    if (opts.select?.length) {
        const keep = new Set(opts.select);
        rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
        schema = { ...res.schema, fields: res.schema.fields.filter(f => keep.has(f.name)) };
    }
    return { rows, total: all.length, schema };
}

/** Every package one owner has, newest version each, with any recorded failure. */
export async function listPackages(deps: StoreDeps, ownerGhii: string): Promise<LatestPointer[]> {
    const files = await deps.storage.listStorageFiles(ownerGhii);
    const names = files
        .filter(f => f.key.startsWith('datapkg/') && f.key.endsWith('/latest.json'))
        .map(f => f.key.slice('datapkg/'.length, -'/latest.json'.length));
    const out: LatestPointer[] = [];
    for (const name of names) {
        const file = await deps.storage.getStorageFile(ownerGhii, latestKey(name));
        if (file) out.push(JSON.parse(file.data.toString('utf8')) as LatestPointer);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** `pkg:{owner}/{name}` or `pkg:{owner}/{name}@sha256:…`, or the bare `{name}` of your own. */
export function parseRef(ref: string, nodeId: string): { ownerGhii: string; name: string; contentHash?: string } | null {
    const m = /^pkg:([^/@]+)\/([^@]+)(?:@(sha256:[a-f0-9]{64}))?$/.exec(String(ref || '').trim());
    if (!m) return null;
    const owner = m[1];
    return {
        ownerGhii: owner.includes('@') ? owner : `${owner}@${nodeId}`,
        name: m[2],
        ...(m[3] ? { contentHash: m[3] } : {}),
    };
}

/**
 * The catalogue side: a knowledge package so the data package appears where people and agents look
 * for knowledge. `content_type: 'dataset'` because the union is closed and `dataset` is already the
 * right word for this; inventing `data-package` would be a type change for no gain.
 *
 * Deterministic id from the packageId, so re-publishing a version updates the entry instead of
 * accumulating one manifest per run — which at a daily cadence is 365 manifests a year for one
 * package, and the memory-key budget is 1000.
 */
async function upsertCatalogueEntry(
    deps: StoreDeps, ownerGhii: string, descriptor: Descriptor, descriptorUrl: string,
): Promise<void> {
    const id = bare(bytesHash(Buffer.from(descriptor.aimeat.packageId, 'utf8'))).slice(0, 32);
    const key = `packages/${id}/manifest`;
    const now = new Date().toISOString();
    const existing = await deps.storage.getMemory(ownerGhii, key);
    const manifest = {
        type: 'knowledge-package',
        name: descriptor.title ?? descriptor.name,
        version: bare(descriptor.aimeat.contentHash).slice(0, 12),
        author: ownerGhii,
        created: (existing?.value as { created?: string } | undefined)?.created ?? now,
        updated: now,
        content_type: 'dataset',
        tags: ['data-package', 'frictionless', descriptor.name],
        language: 'en',
        maturity: 'stable',
        synthesis: { level: 'original', description: descriptor.aimeat.changes },
        references: (descriptor.aimeat.sources ?? []).map(s => ({ url: s.url ?? '', title: s.title ?? '' })),
        entries: descriptor.resources.map(r => ({
            key: `packages/${id}/${r.name}`,
            title: r.title ?? r.name,
            visibility: 'public',
        })),
        links: [],
        sharing: { catalog_listed: true, allow_clone: false, morsel_price: 0 },
        // The pointer back to the canonical bytes. The catalogue never holds them: a knowledge
        // package is a collection of memory entries, and memory does not carry files.
        x_aimeat_datapackage: {
            packageId: descriptor.aimeat.packageId,
            contentHash: descriptor.aimeat.contentHash,
            descriptorUrl,
            resources: descriptor.resources.map(r => ({ name: r.name, rowCount: r.rowCount, fields: r.schema.fields.length })),
        },
    };
    await deps.storage.setMemory({
        key, ownerGaii: ownerGhii, value: manifest,
        visibility: 'public', tags: ['knowledge-package', 'dataset', 'data-package'], ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    // One entry per resource, holding its schema — so an agent that found the package through the
    // catalogue learns the columns without fetching a single byte of data.
    for (const r of descriptor.resources) {
        const entryKey = `packages/${id}/${r.name}`;
        const prev = await deps.storage.getMemory(ownerGhii, entryKey);
        await deps.storage.setMemory({
            key: entryKey, ownerGaii: ownerGhii,
            value: {
                resource: r.name, rowCount: r.rowCount, bytes: r.bytes, hash: r.hash,
                schema: r.schema,
                csvUrl: publicUrl(deps.config.baseUrl, ownerGhii, `${packageKeyRoot(descriptor.name)}/${bare(descriptor.aimeat.contentHash)}/${r.path}`),
            },
            visibility: 'public', tags: ['knowledge-entry', 'dataset'], ttlHours: null,
            version: prev ? prev.version + 1 : 1,
            createdAt: prev?.createdAt ?? now, updatedAt: now,
        });
    }
}
