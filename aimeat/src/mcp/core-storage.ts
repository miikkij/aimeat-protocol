/**
 * @file src/mcp/core-storage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-18 — The upload-mode answer carries the shared mint's `warnings` (PUBLIC_IS_SIGNED_IN_HERE:
 *     a closed node lands a public file at 'members'; plan V1.6).
 *   2026-10-18 — aimeat_storage_upload asks the publish gate through the shared write and the mint
 *     (services/storage-file-publish.ts; plan doc-mvcn6c7e4e5q, V4): a file made public without
 *     publish:public is stored at the level it had and the answer carries `publish_request`, as
 *     POST /v1/storage answers 202. A caller with nobody on this node to ask gets PUBLISH_NOT_ALLOWED.
 *   2026-10-08 — aimeat_storage_upload takes ai_provenance / ai_provenance_id (inline and presigned) and
 *     answers with the file's `ai_provenance` block; a provenance refusal is toolError(code).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.1.0 — 2026-09-29 — aimeat_storage_upload takes visibility 'workspace' with workspace_refs,
 *     the binding POST /v1/storage takes; it had no way to name a workspace.
 *   v1.0.0 — 2026-07-26 — Extracted from src/mcp/core.ts together with the reference-read change.
 *   v1.1.0 — 2026-09-29 — aimeat_storage_download resolves with the agent's classification reader (TARGET-082).
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
 *   v1.3.0 — 2026-09-13 — aimeat_storage_upload's inline answer carries versioned_url, the /v1/pub
 *     address plus ?v=<this write>, as POST /v1/storage does. A re-upload to the same key was served
 *     from browsers' five-minute copies (appdev pitfall pub-file-cache-stale-assets).
 *   v1.3.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readerForAgent } from '../services/classification/reader.js';
import { localAccountName } from '../utils/gaii.js';
import { writeStorageFile, mintStorageUploadUrl, removeStorageFile } from '../services/storage-file-write.js';
import { normalizeWorkspaceRefs } from '../utils/workspace-ref.js';
import { resolveFileRef, handleFromResolved } from '../services/file-refs.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import { versionedAddress } from '../utils/http-range.js';
import { decodeStrictBase64 } from '../utils/base64.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, jsonContent } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { loadServedProvenance, provenanceItemBlock } from '../services/ai-provenance-marks.js';
import { toolError } from './tool-error.js';
import type { CallerContext } from '../services/caller-context.js';

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
    sessionScopes: string[] = [],
    /** The session's caller (services/caller-context.ts), for the publish gate on an upload made public. */
    caller?: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 13: aimeat_storage_upload ──
    mcp.registerTool(
        'aimeat_storage_upload',
        {
            description: descriptionFor('aimeat_storage_upload'),
            inputSchema: zodShapeFor('aimeat_storage_upload'),
            annotations: annotationsFor('aimeat_storage_upload'),
        },
        async ({ key, data_base64, mime_type, visibility, group_id, workspace_refs, ai_provenance, ai_provenance_id }) => {
            const deps = { storage, config, emitResourceUpdated, emitResourceListChanged };
            // The same binding POST /v1/storage takes; the shared write refuses a workspace file
            // that names none.
            const workspaceRef = visibility === 'workspace' ? normalizeWorkspaceRefs(workspace_refs, undefined) || undefined : undefined;
            // The writer and its statement, decided by the shared write as on POST /v1/storage.
            const declared = toDeclaredProvenance(ai_provenance);
            const provenance = {
                actor: agentGaii, scopes: sessionScopes, pipeline: 'mcp.storage_upload',
                ...(ai_provenance_id ? { declaredId: ai_provenance_id } : {}),
                ...(declared ? { declared, wireBlock: ai_provenance } : {}),
            };
            // Making the file public asks the node's publish gate (plan doc-mvcn6c7e4e5q, V4), as POST /v1/storage does.
            const publishGate = caller ? { caller: caller() } : undefined;

            // --- UPLOAD MODE ---
            if (!data_base64) {
                const minted = await mintStorageUploadUrl(deps, agentGaii, {
                    key, mimeType: mime_type, visibility, groupId: group_id, workspaceRef, provenance,
                    ...(publishGate ? { publishGate } : {}),
                });
                if (!minted.ok) {
                    if (minted.code === 'SCOPE_DENIED' || minted.code === 'NOT_FOUND' || minted.code === 'PUBLISH_NOT_ALLOWED') return toolError(minted.code, minted.message);
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
                            // A closed node lands the file at 'members' instead of public (plan V1.6).
                            ...(minted.warnings ? { warnings: minted.warnings } : {}),
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
                key, data: fileData, mimeType: mime_type, visibility, groupId: group_id, workspaceRef, provenance,
                ...(publishGate ? { publishGate } : {}),
            });
            if (!written.ok) {
                // A provenance refusal answers `CODE: message`, the code REST answers.
                if (written.code === 'SCOPE_DENIED' || written.code === 'NOT_FOUND' || written.code === 'PROVENANCE_HASH_MISMATCH'
                    || written.code === 'PUBLISH_NOT_ALLOWED') {
                    return toolError(written.code, written.message);
                }
                // Only the per-file ceiling has an answer the caller can act on. Offering the
                // presigned URL against the ACCOUNT quota would send an agent round a loop that
                // ends in the same refusal, since that door checks the same ceiling.
                const alternative = written.limit === 'per_file'
                    ? ' Omit data_base64 to get a presigned upload URL instead.'
                    : '';
                return { content: [{ type: 'text' as const, text: written.message + alternative }], isError: true };
            }

            const file = written.file;
            const prov = await loadServedProvenance(storage, config, file.aiProvenanceId, { full: true });
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                    // Stored at the level it had: making it public waits for the owner (what to tell them is in next_step).
                    ...(written.publishRequest ? { publish_request: written.publishRequest } : {}),
                    ...(written.warnings?.length ? { warnings: written.warnings } : {}),
                    mode: 'inline', key: file.key, owner_gaii: file.ownerGaii, size: file.size, visibility: file.visibility, uploaded: true,
                    // The record the file carries: attached, declared or stamped by the shared write.
                    ...provenanceItemBlock(prov),
                    ...(written.overageMorsels > 0 ? { overage_charged: written.overageMorsels } : {}),
                    // To embed this image in a workspace document, use embed_markdown / embed_url — NOT the raw
                    // /v1/storage/<key> path. Saving it into a document scopes the file to that workspace's
                    // members (visibility:'workspace'); it is never exposed to the public internet.
                    embed_url: pubEmbedUrl(file.ownerGaii, file.key),
                    embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
                    // For an app or a page, not a document: the same address with ?v=<this write>,
                    // so a re-upload under this key is not served from a browser's five-minute copy.
                    versioned_url: versionedAddress(pubEmbedUrl(file.ownerGaii, file.key), file),
                }, null, 2) }],
            };
        },
    );

    // ── Tool 14: aimeat_storage_download ──
    // Reads by REFERENCE, not just by own-namespace key. Storage is keyed by (owner, key), and this
    // tool used to look only in the calling agent's namespace — so a PDF its OWNER uploaded, or a file
    // arriving as a DM/task attachment, answered "File not found" no matter what the access rules said.
    // A foreign read goes through the same authorizeRead() guard as GET /v1/pub and ctx.files.read.
    mcp.registerTool(
        'aimeat_storage_download',
        {
            description: descriptionFor('aimeat_storage_download'),
            inputSchema: zodShapeFor('aimeat_storage_download'),
            annotations: annotationsFor('aimeat_storage_download'),
        },
        async ({ key, owner, inline }) => {
            const ref = owner ? `${owner}/${key}` : key;
            const resolved = await resolveFileRef(storage, config, ref, {
                gaii: agentGaii, sub: agentGaii, owner: localAccountName(agentGaii), reader: readerForAgent({ storage, config }, agentGaii),
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
    mcp.registerTool(
        'aimeat_storage_delete',
        {
            description: descriptionFor('aimeat_storage_delete'),
            inputSchema: zodShapeFor('aimeat_storage_delete'),
            annotations: annotationsFor('aimeat_storage_delete'),
        },
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
