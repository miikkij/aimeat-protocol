/**
 * @file tool-dispatch/tool-call-defs-storage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The file storage tools on the CLI dispatch (`/local/call/<tool>`): aimeat_storage_upload,
 *   aimeat_storage_download and aimeat_storage_delete, thin proxies over /v1/storage and /v1/pub.
 *   Moved from tool-call-defs-core.ts, which had reached the 800-line limit.
 * @version-history
 *   v1.1.0 — 2026-09-29 — aimeat_storage_upload forwards workspace_refs, so a 'workspace' file names
 *     its workspaces here as on the other two surfaces.
 *   v1.0.0 — 2026-09-29 — Moved from tool-call-defs-core.ts, unchanged.
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalBoolean, optionalArray } from './tool-call-helpers.js';

export const storageCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_storage_upload',
        // The catalog and the connector-MCP door both publish `data_base64`; POST /v1/storage reads
        // it as `data`. This door read `content`, which nothing declares and nothing sends, so the
        // whole tool was unreachable — and `visibility`/`group_id` were dropped besides.
        handler: ({ client }, input) => {
            const body: JsonObject = { key: requiredString(input, 'key'), data: requiredString(input, 'data_base64') };
            const mimeType = optionalString(input, 'mime_type'); if (mimeType) body.mime_type = mimeType;
            const visibility = optionalString(input, 'visibility'); if (visibility) body.visibility = visibility;
            const groupId = optionalString(input, 'group_id'); if (groupId) body.group_id = groupId;
            const workspaceRefs = optionalArray(input, 'workspace_refs'); if (workspaceRefs) body.workspace_refs = workspaceRefs as JsonObject[keyof JsonObject];
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
            const inline = optionalBoolean(input, 'inline') === true;
            if (!owner) return client.get(`/v1/storage/${encodeURIComponent(key)}${query({ inline: inline ? 'true' : undefined })}`);
            const refKey = optionalString(input, 'owner') ? key : key.slice(slash + 1);
            return client.get(`/v1/pub/${encodeURIComponent(owner)}/${refKey.split('/').map(encodeURIComponent).join('/')}?mode=${inline ? 'inline' : 'handle'}`);
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
