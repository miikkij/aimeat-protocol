/**
 * @file src/services/datapackage/version-audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reads a stored data package version: the `latest.json` pointer, the catalogue
 *   entry beside the bytes, and the files of one version taking an audience.
 *
 *   writeLatest and upsertCatalogueEntry moved here from ./store.ts unchanged (max-file-lines).
 *   setVersionAudience is new: a publish of bytes already stored under another audience used to move
 *   the pointer only, so the files kept the tier they were written at and the catalogue entry its
 *   listing. It now gives the version's files, the pointer and the catalogue entry the audience asked
 *   for, and an approved publish request calls the same function (services/publish-requests/
 *   apply-datapackage.ts; plan doc-mvcn6c7e4e5q, V4).
 * @structure readPointer · writeLatest · upsertCatalogueEntry · setVersionAudience
 * @usage
 *   await setVersionAudience(deps, ownerGhii, name, contentHash, 'public', { catalogue: true });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Extracted from ./store.ts (writeLatest, upsertCatalogueEntry) with
 *     readPointer and setVersionAudience (plan doc-mvcn6c7e4e5q, V4).
 */
import { writeStorageFile, type StorageWriteDeps } from '../storage-file-write.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import {
    type Descriptor, type LatestPointer,
    bare, bytesHash, descriptorKey, latestKey, packageId, packageKeyRoot, publicUrl,
} from './contract.js';
import { manifestRecordVisibility, entryRecordVisibility } from '../knowledge-audience.js';
import { fileVisibilityOf, catalogueAudienceOf, catalogueEntryVisibilityOf } from './audience.js';

/**
 * The storage, the config and, from ./store.ts, the MCP resource notifications a file write sends. A
 * service does not import src/mcp/, so the caller that has them hands them in; without them the
 * files are written and no MCP resource notice goes out.
 */
type StoreDeps = StorageWriteDeps;

/** The pointer as stored, or null when there is none or it does not parse. A failure-only pointer is returned too. */
export async function readPointer(deps: StoreDeps, ownerGhii: string, name: string): Promise<LatestPointer | null> {
    const file = await deps.storage.getStorageFile(ownerGhii, latestKey(name));
    if (!file) return null;
    try {
        return JSON.parse(file.data.toString('utf8')) as LatestPointer;
    } catch (err) {
        // An unreadable pointer is no pointer to this reader; publishPackage refuses on it itself.
        logger.warn('datapackage: latest.json is not readable JSON', { owner: ownerGhii, package: name, error: String(err) });
        return null;
    }
}

/** The mutable pointer for a consumer following the newest version. Clears any recorded failure:
 *  a successful publish IS the answer to "the last attempt broke". */
export async function writeLatest(
    deps: StoreDeps, ownerGhii: string, name: string, contentHash: string, descriptorUrl: string, at: string,
    visibility: string,
): Promise<void> {
    const pointer: LatestPointer = {
        packageId: packageId(localAccountName(ownerGhii), name),
        name, contentHash, descriptorUrl, updatedAt: at, visibility,
    };
    await writeStorageFile(deps, ownerGhii, {
        key: latestKey(name),
        data: Buffer.from(JSON.stringify(pointer, null, 2) + '\n', 'utf8'),
        mimeType: 'application/json; charset=utf-8',
        visibility: fileVisibilityOf(visibility),
    });
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
export async function upsertCatalogueEntry(
    deps: StoreDeps, ownerGhii: string, descriptor: Descriptor, descriptorUrl: string, visibility: string,
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
            visibility: catalogueEntryVisibilityOf(visibility),
        })),
        links: [],
        // Listed in the public catalogue only when the package is public; else the package's own
        // audience (services/knowledge-audience.ts reads it).
        sharing: { catalog_listed: visibility === 'public', allow_clone: false, toll_morsels: 0, audience: catalogueAudienceOf(visibility) },
        // The pointer back to the canonical bytes. The catalogue never holds them: a knowledge
        // package is a collection of memory entries, and memory does not carry files.
        x_aimeat_datapackage: {
            packageId: descriptor.aimeat.packageId,
            contentHash: descriptor.aimeat.contentHash,
            descriptorUrl,
            resources: descriptor.resources.map(r => ({ name: r.name, rowCount: r.rowCount, fields: r.schema.fields.length })),
        },
    };
    // The catalogue rows carry the descriptor's record: they describe the same version, publicly.
    const aiProvenanceId = descriptor.aimeat.aiProvenanceId;
    await deps.storage.setMemory({
        key, ownerGaii: ownerGhii, value: manifest,
        ...(aiProvenanceId ? { aiProvenanceId } : {}),
        visibility: manifestRecordVisibility(manifest), tags: ['knowledge-package', 'dataset', 'data-package'], ttlHours: null,
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
            ...(aiProvenanceId ? { aiProvenanceId } : {}),
            visibility: entryRecordVisibility(catalogueEntryVisibilityOf(visibility)), tags: ['knowledge-entry', 'dataset'], ttlHours: null,
            version: prev ? prev.version + 1 : 1,
            createdAt: prev?.createdAt ?? now, updatedAt: now,
        });
    }
}

/**
 * Give one stored version an audience and point `latest.json` at it: every file of the version is
 * rewritten at the audience's tier where it differs (same bytes, same provenance record), then the
 * pointer, then, with `catalogue`, the catalogue entry. Refuses when the version's descriptor is not
 * stored, before anything is written.
 */
export async function setVersionAudience(
    deps: StoreDeps, ownerGhii: string, name: string, contentHash: string, visibility: string,
    opts: { catalogue: boolean },
): Promise<{ ok: true; descriptorUrl: string } | { ok: false; message: string }> {
    const dKey = descriptorKey(name, contentHash);
    const descriptorFile = await deps.storage.getStorageFile(ownerGhii, dKey);
    if (!descriptorFile) return { ok: false, message: 'the version is not stored' };
    const tier = fileVisibilityOf(visibility);
    const root = `${packageKeyRoot(name)}/${bare(contentHash)}/`;
    const files = (await deps.storage.listStorageFiles(ownerGhii)).filter(f => f.key.startsWith(root) && f.visibility !== tier);
    for (const meta of files) {
        const file = await deps.storage.getStorageFile(ownerGhii, meta.key);
        if (!file) continue;
        const written = await writeStorageFile(deps, ownerGhii, {
            key: file.key, data: file.data, mimeType: file.mimeType, visibility: tier,
            ...(file.aiProvenanceId ? { aiProvenanceId: file.aiProvenanceId } : {}),
        });
        if (!written.ok) return { ok: false, message: `storing ${file.key} failed: ${written.message}` };
    }
    const descriptorUrl = publicUrl(deps.config.baseUrl, ownerGhii, dKey);
    await writeLatest(deps, ownerGhii, name, contentHash, descriptorUrl, new Date().toISOString(), visibility);
    if (opts.catalogue) {
        const descriptor = JSON.parse(descriptorFile.data.toString('utf8')) as Descriptor;
        await upsertCatalogueEntry(deps, ownerGhii, descriptor, descriptorUrl, visibility);
    }
    return { ok: true, descriptorUrl };
}
