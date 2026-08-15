/**
 * @file src/mcp/core-storage.ts
 * @description The core MCP storage tools: aimeat_storage_upload (inline or presigned),
 *   aimeat_storage_download (by key in the caller's own namespace, or by REFERENCE for a file someone
 *   else owns), and aimeat_storage_delete. Extracted from src/mcp/core.ts to satisfy max-file-lines.
 *
 *   The reference form is the point of the download tool: storage is keyed by (owner, key), and a
 *   key-only lookup made every file the CALLER did not upload unreachable — an owner's PDF answered
 *   "not found" to that owner's own agent. Foreign reads go through services/file-refs.ts, i.e. the
 *   same authorizeRead() guard as GET /v1/pub and ctx.files.read, and answer with a presigned handle
 *   so binary never enters a model context.
 * @structure registerCoreStorageTools() — registers the three tools on an McpServer
 * @usage
 *   import { registerCoreStorageTools } from './core-storage.js';
 *   registerCoreStorageTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-07-26 — Extracted from src/mcp/core.ts together with the reference-read change.
 *   v1.1.0 — 2026-08-11 — aimeat_storage_upload stores through services/storage-file-write.ts, the
 *     same write POST /v1/storage runs. This copy had never checked the account-wide storage quota
 *     and never charged the overage that follows it, so an agent could pass the node's storage
 *     ceiling through the tool and be billed for none of it, while the identical upload from the
 *     browser was gated and charged. It also took Node's permissive base64 reader, which turns
 *     mis-sent HTML or JSON into a few bytes of garbage stored as a successful file.
 *   v1.2.0 — 2026-08-15 — aimeat_storage_delete. An agent could store a file over MCP and had no way
 *     to take it back: the capability existed as DELETE /v1/storage/{key} and on no tool, so the
 *     cleanup after any agent-side experiment needed a human with a REST client. It deletes through
 *     services/storage-file-write.ts, the same removeStorageFile() the route now calls.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { writeStorageFile, mintStorageUploadUrl, removeStorageFile } from '../services/storage-file-write.js';
import { resolveFileRef, handleFromResolved } from '../services/file-refs.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { decodeStrictBase64 } from '../utils/base64.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, jsonContent } from './catalog/shape.js';

/** F11: storage holds binaries (images, video, large blobs). aimeat_storage_download returns a
 *  handle (resource_link + presigned download_url) instead of base64 so bytes never enter the
 *  model context. Only small text files may be returned inline. */
const STORAGE_INLINE_MAX_BYTES = 32 * 1024;
function isInlineableMime(mime: string): boolean {
    return mime.startsWith('text/') || /(json|xml|csv|javascript|yaml|markdown)/i.test(mime);
}

export function registerCoreStorageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 13: aimeat_storage_upload ──
    mcp.tool(
        'aimeat_storage_upload',
        descriptionFor('aimeat_storage_upload'),
        {
            key: z.string().describe('Storage key (path-like identifier)'),
            data_base64: z.string().optional().describe('Base64-encoded file data. Omit to get an upload URL instead (recommended for files > 1KB).'),
            mime_type: z.string().optional().describe('MIME type (default: application/octet-stream)'),
            visibility: z.enum(['private', 'owner', 'group', 'public']).optional().describe('Access control (default: private)'),
            group_id: z.string().optional().describe('ID of sharing group for group visibility'),
        },
        annotationsFor('aimeat_storage_upload'),
        async ({ key, data_base64, mime_type, visibility, group_id }) => {
            const deps = { storage, config, emitResourceUpdated, emitResourceListChanged };

            // --- UPLOAD MODE ---
            if (!data_base64) {
                const minted = await mintStorageUploadUrl(deps, agentGaii, {
                    key, mimeType: mime_type, visibility, groupId: group_id,
                });
                if (!minted.ok) {
                    return { content: [{ type: 'text' as const, text: minted.message }], isError: true };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: minted.uploadUrl,
                            upload_method: 'PUT',
                            content_type: minted.contentType,
                            max_size_bytes: minted.maxBytes,
                            expires_in_seconds: minted.expiresInSeconds,
                            note: 'PUT the raw file to upload_url. The response contains the result as JSON.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE ---
            // Strict decode, as every other inline-upload door does: Node's own base64 reader drops
            // anything outside the alphabet, so raw HTML or JSON sent here used to be stored as a few
            // bytes of garbage and served back as a successful file.
            const fileData = decodeStrictBase64(data_base64);
            if (!fileData) {
                return {
                    content: [{ type: 'text' as const, text: 'data_base64 must be base64-encoded.' }],
                    isError: true,
                };
            }

            const written = await writeStorageFile(deps, agentGaii, {
                key, data: fileData, mimeType: mime_type, visibility, groupId: group_id,
            });
            if (!written.ok) {
                // Only the per-file ceiling has an answer the caller can act on. Offering the
                // presigned URL against the ACCOUNT quota would send an agent round a loop that
                // ends in the same refusal, since that door checks the same ceiling.
                const alternative = written.limit === 'per_file'
                    ? ' Omit data_base64 to get a presigned upload URL instead.'
                    : '';
                return { content: [{ type: 'text' as const, text: written.message + alternative }], isError: true };
            }

            const file = written.file;
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                    mode: 'inline', key: file.key, owner_gaii: file.ownerGaii, size: file.size, uploaded: true,
                    ...(written.overageMorsels > 0 ? { overage_charged: written.overageMorsels } : {}),
                    // To embed this image in a workspace document, use embed_markdown / embed_url — NOT the raw
                    // /v1/storage/<key> path. Saving it into a document scopes the file to that workspace's
                    // members (visibility:'workspace'); it is never exposed to the public internet.
                    embed_url: pubEmbedUrl(file.ownerGaii, file.key),
                    embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
                }, null, 2) }],
            };
        },
    );

    // ── Tool 14: aimeat_storage_download ──
    // Reads by REFERENCE, not just by own-namespace key. Storage is keyed by (owner, key), and this
    // tool used to look only in the calling agent's namespace — so a PDF its OWNER uploaded, or a file
    // arriving as a DM/task attachment, answered "File not found" no matter what the access rules said.
    // A foreign read goes through the same authorizeRead() guard as GET /v1/pub and ctx.files.read.
    mcp.tool(
        'aimeat_storage_download',
        descriptionFor('aimeat_storage_download'),
        {
            key: z.string().describe('Storage key in your own namespace, OR a full reference "owner@node/path/file.pdf" for a file someone else owns.'),
            owner: z.string().optional().describe('GHII/GAII that owns the file (e.g. alice@aimeat-fi-001-genesis). Omit for your own files. Use this for your owner\'s uploads and for DM/task attachments.'),
            inline: z.boolean().optional().describe('Only for small text files (<= 32 KB): return content inline. Binaries always return a download handle, never base64 in context.'),
        },
        annotationsFor('aimeat_storage_download'),
        async ({ key, owner, inline }) => {
            const ref = owner ? `${owner}/${key}` : key;
            const resolved = await resolveFileRef(storage, config, ref, {
                gaii: agentGaii, sub: agentGaii, owner: parseGaiiLoose(agentGaii).owner,
            });
            if (resolved.access !== 'granted' || !resolved.file) {
                // Name the alternative instead of a bare "not found": asking for the OWNER's file by
                // bare key is the single most common mistake, and the blank answer read as data loss.
                const hint = resolved.reason === 'not_found_in_your_namespace'
                    ? `No file "${resolved.key}" in your own namespace. If it belongs to your owner or arrived as an attachment, pass owner="<owner@node>" (or key="<owner@node>/${resolved.key}").`
                    : resolved.access === 'denied'
                        ? `You may not read ${resolved.ref} (${resolved.reason}). The owner can make it readable by their own agents by uploading it with visibility:'owner', or grant you consent for storage:${resolved.key}.`
                        : `No such file: ${resolved.ref}`;
                return { content: [{ type: 'text' as const, text: JSON.stringify({ access: resolved.access, ref: resolved.ref, reason: resolved.reason, hint }, null, 2) }], isError: true };
            }

            const file = resolved.file;
            const resourceUri = `aimeat://storage/${encodeURIComponent(resolved.key)}`;

            // Inline only for small text files — keeps binaries (images/video/large blobs) out of context.
            if (inline && file.size <= STORAGE_INLINE_MAX_BYTES && isInlineableMime(file.mimeType)) {
                return jsonContent({
                    ref: resolved.ref, owner_gaii: resolved.ownerGaii,
                    key: file.key, mime_type: file.mimeType, size: file.size,
                    mode: 'inline', content_text: file.data.toString('utf8'), resource_uri: resourceUri,
                });
            }

            // Default: return a handle. resource_link lets MCP clients read bytes out-of-band via
            // resources/read; download_url is a presigned, TTL-limited HTTP fetch for everything else.
            const handle = await handleFromResolved(config, resolved, agentGaii);
            return {
                content: [
                    {
                        type: 'resource_link' as const,
                        uri: resourceUri,
                        name: file.key,
                        mimeType: file.mimeType,
                        description: `${file.size} bytes — fetch via download_url; do not read the bytes into context`,
                    },
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            ...handle, mode: 'handle', download_method: 'GET', resource_uri: resourceUri,
                            note: inline
                                ? 'inline refused (file too large or not text) — returning a handle instead'
                                : 'Binary content is not inlined. GET download_url to fetch the bytes out-of-band.',
                        }, null, 2),
                    },
                ],
            };
        },
    );

    // ── Tool 15: aimeat_storage_delete ──
    // Own namespace only, unlike the download above. The read tool takes a reference because an agent
    // legitimately reads its owner's uploads; nothing makes the same argument for deleting them, and
    // a delete that could reach across owners on a permission meant for reading is the shape of an
    // accident nobody can undo. The gates live in removeStorageFile().
    mcp.tool(
        'aimeat_storage_delete',
        descriptionFor('aimeat_storage_delete'),
        {
            key: z.string().describe('Storage key in your own namespace. You can only delete files you uploaded.'),
        },
        annotationsFor('aimeat_storage_delete'),
        async ({ key }) => {
            const removed = await removeStorageFile(
                { storage, config, emitResourceUpdated, emitResourceListChanged }, agentGaii, key,
            );
            if (!removed.ok) {
                return { content: [{ type: 'text' as const, text: removed.message }], isError: true };
            }
            // Say what was destroyed, not just that something was. A caller that deleted the wrong
            // key finds out here rather than the next time it looks for the file.
            return jsonContent({
                deleted: true, key: removed.key, size: removed.size,
                mime_type: removed.mimeType, visibility: removed.visibility,
            });
        },
    );
}
