/**
 * @file tool-dispatch/tool-call-defs-storage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The file storage tools on the CLI dispatch (`/local/call/<tool>`): aimeat_storage_upload,
 *   aimeat_storage_download and aimeat_storage_delete, thin proxies over /v1/storage and /v1/pub.
 *   Moved from tool-call-defs-core.ts, which had reached the 800-line limit.
 * @version-history
 *   v1.3.0 — 2026-10-08 — aimeat_storage_upload forwards ai_provenance (validated here first) and
 *     ai_provenance_id; POST /v1/storage records them (recorded-by-route).
 *   v1.2.0 — 2026-10-06 — aimeat_storage_upload without data_base64 asks for a presigned upload_url;
 *     aimeat_storage_download always names `mode` (handle or inline), the query GET /v1/storage/:key
 *     reads, and reads a reference as a handle. The connector MCP runs these now (secaudit 2026-10
 *     follow-up, Part B).
 *   v1.1.0 — 2026-09-29 — aimeat_storage_upload forwards workspace_refs, so a 'workspace' file names
 *     its workspaces here as on the other two surfaces.
 *   v1.0.0 — 2026-09-29 — Moved from tool-call-defs-core.ts, unchanged.
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalArray } from './tool-call-helpers.js';
import { parseDeclarationInput } from './ai-provenance-carry.js';

export const storageCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_storage_upload',
        // The catalog and the connector-MCP door both publish `data_base64`; POST /v1/storage reads
        // it as `data`. This door read `content`, which nothing declares and nothing sends, so the
        // whole tool was unreachable — and `visibility`/`group_id` were dropped besides.
        // Without data_base64 it asks for a presigned upload_url (mode 'presigned'), the mode the
        // catalog describes and the node's MCP runs. Neither connector door reached it: one required
        // the payload and the other posted `{ key }` alone, which POST /v1/storage answers 400.
        handler: ({ client }, input) => {
            const data = optionalString(input, 'data_base64');
            const body: JsonObject = { key: requiredString(input, 'key'), ...(data ? { data } : { mode: 'presigned' }) };
            const mimeType = optionalString(input, 'mime_type'); if (mimeType) body.mime_type = mimeType;
            const visibility = optionalString(input, 'visibility'); if (visibility) body.visibility = visibility;
            const groupId = optionalString(input, 'group_id'); if (groupId) body.group_id = groupId;
            const workspaceRefs = optionalArray(input, 'workspace_refs'); if (workspaceRefs) body.workspace_refs = workspaceRefs as JsonObject[keyof JsonObject];
            // How the bytes were made: POST /v1/storage records it in both modes and names the record
            // in its answer (`ai_provenance`), so it travels in the body (recorded-by-route).
            const declared = parseDeclarationInput(input.ai_provenance);
            if (declared) body.ai_provenance = input.ai_provenance as JsonObject[keyof JsonObject];
            const provenanceId = optionalString(input, 'ai_provenance_id'); if (provenanceId) body.ai_provenance_id = provenanceId;
            return client.post('/v1/storage', body);
        },
    },
    {
        name: 'aimeat_storage_download',
        // `owner` (or an "owner@node/key" reference) reads a file the agent does NOT own — its owner's
        // upload, a DM/task attachment — through /v1/pub, which runs the consent/visibility guard.
        // Without it the read is namespaced to the agent and a perfectly readable file answers 404.
        handler: ({ client }, input) => {
            const key = requiredString(input, 'key');
            const slash = key.indexOf('/');
            const head = slash > 0 ? key.slice(0, slash) : '';
            const owner = optionalString(input, 'owner') ?? (head.includes('@') || head.startsWith('ext:') ? head : '');
            // `inline` asks for the BYTES in the response rather than a handle to fetch. It is the
            // difference between an agent reading a file and an agent being told where one is.
            // GET /v1/storage/:key reads `mode` (handle or inline) and answers raw bytes without it, so
            // the request always names one. GET /v1/pub has a handle mode only; its other answer is
            // the bytes, so a reference is always read as a handle.
            const inline = optionalBoolean(input, 'inline') === true;
            if (!owner) return client.get(`/v1/storage/${encodeURIComponent(key)}?mode=${inline ? 'inline' : 'handle'}`);
            const refKey = optionalString(input, 'owner') ? key : key.slice(slash + 1);
            return client.get(`/v1/pub/${encodeURIComponent(owner)}/${refKey.split('/').map(encodeURIComponent).join('/')}?mode=handle`);
        },
    },
    {
        // Own namespace only, so there is no /v1/pub twin here the way aimeat_storage_download has one.
        name: 'aimeat_storage_delete',
        handler: ({ client }, input) => client.delete(
            `/v1/storage/${requiredString(input, 'key').split('/').map(encodeURIComponent).join('/')}`,
        ),
    },
];
