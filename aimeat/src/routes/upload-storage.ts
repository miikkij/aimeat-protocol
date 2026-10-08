/**
 * @file src/routes/upload-storage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage half of PUT /v1/upload/:token (a presigned storage upload), and the one
 *   reading of the `ai_provenance` block a presigned token carries. Moved out of routes/upload.ts by
 *   pure extraction when that file reached the 800-line ceiling; upload.ts still dispatches here.
 * @structure declaredFromMeta() · handleStorageUpload()
 * @usage
 *   import { handleStorageUpload, declaredFromMeta } from './upload-storage.js';
 *   await handleStorageUpload(res, config, storage, verified.sub, verified.actor, verified.meta, data);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Extracted from routes/upload.ts (max-file-lines). The storage upload takes
 *     the token's actor and its ai_provenance / ai_provenance_id, and answers with the file's
 *     `ai_provenance` block (AI provenance for stored files).
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import { writeStorageFile } from '../services/storage-file-write.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import type { DeclaredProvenance } from '../services/ai-provenance.js';
import { logger } from '../utils/logger.js';
import { emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { versionedAddress } from '../utils/http-range.js';
import { uploadProvenanceBlock } from './storage-provenance-input.js';

/**
 * The `ai_provenance` block a presigned token carries, mapped to the mint path's input — or
 * undefined when there is none, or when what is there no longer validates.
 *
 * Shared by every utype that grows a declaration, which is why it sits here rather than inside
 * handleAppUpload: the app door is simply the first one to need it, and the next one must not
 * hand-roll a second reading of the same key.
 */
export function declaredFromMeta(meta: Record<string, unknown>): DeclaredProvenance | undefined {
    const parsed = parseDeclaredProvenanceInput(meta.ai_provenance);
    if (!parsed.ok) {
        logger.warn('Upload token carried an ai_provenance block that no longer validates — publishing without it', {
            violations: parsed.violations.map((v) => `${v.path}: ${v.message}`).join('; '),
        });
        return undefined;
    }
    return parsed.declared;
}

// ── Handler: Storage ──

export async function handleStorageUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, actor: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    // tags + workspace_refs ride in the token meta (PRESIGNED_META_KEYS.storage). Dropping them here
    // is how a presigned upload of a workspace-shared file would land as an untagged private one —
    // the file exists, nobody it was meant for can see it, and nothing says why.
    const tags = Array.isArray(meta.tags)
        ? (meta.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : undefined;

    // The key fence, the two size ceilings, the account-wide quota, the record shape, the overage
    // charge and the change events are services/storage-file-write.ts, shared with POST /v1/storage
    // and aimeat_storage_upload. This door's own business is reading the token meta and rendering
    // the answer. `sub` is the token subject, set server-side at mint from resolveIdentity(), so the
    // owner the file lands under is never anything a client sent.
    const written = await writeStorageFile(
        { storage, config, emitResourceUpdated, emitResourceListChanged },
        sub,
        {
            key: meta.key as string,
            data,
            mimeType: (meta.mime_type as string) ?? 'application/octet-stream',
            visibility: (meta.visibility as StorageFileRecord['visibility']) ?? 'private',
            groupId: typeof meta.group_id === 'string' ? meta.group_id : undefined,
            workspaceRef: typeof meta.workspace_refs === 'string' ? meta.workspace_refs : undefined,
            tags,
            // The statement the caller made when it asked for the URL, from the SIGNED token, and the
            // writer the token names (set at mint from resolveIdentity, never from the client). The
            // write checks the attached record's hash against these bytes.
            provenance: {
                actor, pipeline: 'rest.upload.storage',
                ...(typeof meta.ai_provenance_id === 'string' ? { declaredId: meta.ai_provenance_id } : {}),
                ...(meta.ai_provenance !== undefined ? { declared: declaredFromMeta(meta) } : {}),
            },
        },
    );
    if (!written.ok) {
        res.status(written.status).json({ success: false, error: written.code, message: written.message });
        return;
    }
    const { file, overageMorsels } = written;

    res.json({
        success: true,
        type: 'storage',
        // The record the file carries: attached, declared or stamped by the write above.
        ...await uploadProvenanceBlock(storage, config, file.aiProvenanceId),
        key: file.key,
        owner_gaii: file.ownerGaii,
        size: file.size,
        mime_type: file.mimeType,
        visibility: file.visibility,
        // What the account-wide quota cost this upload. The charge already happened on this path;
        // reporting it is what tells the caller their balance moved.
        ...(overageMorsels > 0 ? { overage_charged: overageMorsels } : {}),
        // Ready-to-embed, owner-addressed URL. Embedding this in a workspace document scopes the file to
        // that workspace's members on save (never the public internet) — use it, not /v1/storage/<key>.
        embed_url: pubEmbedUrl(file.ownerGaii, file.key),
        embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
        // The same address with ?v=<this write>, as POST /v1/storage answers: a re-upload under this
        // key is a new URL to every cache, and GET /v1/pub ignores the query.
        versioned_url: versionedAddress(pubEmbedUrl(file.ownerGaii, file.key), file),
    });
}
