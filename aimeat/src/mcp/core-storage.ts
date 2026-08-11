/**
 * @file src/mcp/core-storage.ts
 * @description The two core MCP storage tools: aimeat_storage_upload (inline or presigned) and
 *   aimeat_storage_download (by key in the caller's own namespace, or by REFERENCE for a file someone
 *   else owns). Extracted from src/mcp/core.ts to satisfy max-file-lines; no behavior change.
 *
 *   The reference form is the point of the download tool: storage is keyed by (owner, key), and a
 *   key-only lookup made every file the CALLER did not upload unreachable — an owner's PDF answered
 *   "not found" to that owner's own agent. Foreign reads go through services/file-refs.ts, i.e. the
 *   same authorizeRead() guard as GET /v1/pub and ctx.files.read, and answer with a presigned handle
 *   so binary never enters a model context.
 * @structure registerCoreStorageTools() — registers both tools on an McpServer
 * @usage
 *   import { registerCoreStorageTools } from './core-storage.js';
 *   registerCoreStorageTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-07-26 — Extracted from src/mcp/core.ts together with the reference-read change.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { generateUploadToken, buildUploadMeta } from '../services/upload-token.js';
import { resolveFileRef, handleFromResolved } from '../services/file-refs.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, jsonContent } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';

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
            // --- UPLOAD MODE ---
            if (!data_base64) {
                // The operator's own setting, not a constant. This was hardcoded to 10 MB, so a node
                // configured for 50 MB still minted 10 MB tokens and refused everything above it with
                // 413 FILE_TOO_LARGE — the admin page said 50 and the tool said 10, with nothing
                // connecting the two.
                const maxBytes = config.storageMaxFileSizeMb * 1024 * 1024;
                const contentType = mime_type ?? 'application/octet-stream';
                const token = await generateUploadToken({
                    sub: agentGaii,
                    utype: 'storage',
                    meta: buildUploadMeta('storage', {
                        key, mime_type: contentType, visibility: visibility ?? 'private', group_id,
                    }),
                    maxBytes,
                    contentType,
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: contentType,
                            max_size_bytes: maxBytes,
                            expires_in_seconds: 3600,
                            note: 'PUT the raw file to upload_url. The response contains the result as JSON.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE ---
            const fileData = Buffer.from(data_base64, 'base64');
            if (fileData.length > config.storageMaxFileSizeMb * 1024 * 1024) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `File exceeds this node's ${config.storageMaxFileSizeMb}MB per-file limit. Omit data_base64 to get a presigned upload URL instead.`,
                    }],
                    isError: true,
                };
            }
            const file = await storage.createStorageFile({
                key,
                ownerGaii: agentGaii,
                visibility: visibility ?? 'private',
                groupId: visibility === 'group' ? group_id : undefined,
                mimeType: mime_type ?? 'application/octet-stream',
                size: fileData.length,
                data: fileData,
                createdAt: new Date().toISOString(),
            });
            // routes/storage-files.ts emits BOTH: a stored file shows in the files view and counts against
            // the memory budget the memory view renders.
            emitChange('files');
            emitChange('memory');
            emitResourceUpdated(agentGaii, `aimeat://storage/${encodeURIComponent(key)}`);
            emitResourceListChanged(agentGaii);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                    mode: 'inline', key: file.key, owner_gaii: file.ownerGaii, size: file.size, uploaded: true,
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
}
