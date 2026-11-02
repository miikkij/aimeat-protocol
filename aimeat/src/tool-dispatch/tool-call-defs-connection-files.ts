/**
 * @file src/tool-dispatch/tool-call-defs-connection-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A connected SharePoint or OneDrive on the CLI dispatch (`/local/call/<tool>`): thin
 *   REST proxies over POST /v1/connections/:id/read/:resource, /files/text, /files/store and
 *   /write/:resource, so the permission words, the ownership check and the classification gate are
 *   the node's answer here too. Nothing in this file decides anything.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';

/** The named parameters a tool forwards, each only when it was given. */
function pick(input: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of names) if (input[n] !== undefined && input[n] !== null && input[n] !== '') out[n] = input[n];
    return out;
}

const BROWSE_PARAMS = ['query', 'site_id', 'hostname', 'path', 'drive_id', 'item_id', 'list_id', 'token', 'page_token'] as const;
const WRITE_PARAMS = ['drive_id', 'parent_id', 'item_id', 'filename', 'name', 'from_key', 'text', 'mime_type', 'conflict', 'etag', 'site_id', 'list_id', 'fields'] as const;

export const connectionFileCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/connections/:id/read/:what, the generic read route; `what` is a resource name.
        name: 'aimeat_files_browse',
        handler: ({ client }, input) => client.post(
            `/v1/connections/${encodeURIComponent(requiredString(input, 'connection_id'))}/read/${encodeURIComponent(requiredString(input, 'what'))}`,
            { ...pick(input, BROWSE_PARAMS), ...(optionalNumber(input, 'limit') ? { limit: optionalNumber(input, 'limit') } : {}) },
        ),
    },
    {
        // → POST /v1/connections/:id/files/text or /files/store. Both paths are written out as literals,
        //   because the gate matches a tool to its route by the path it calls.
        name: 'aimeat_files_get',
        handler: ({ client }, input) => {
            const id = encodeURIComponent(requiredString(input, 'connection_id'));
            const body = {
                drive_id: requiredString(input, 'drive_id'),
                item_id: requiredString(input, 'item_id'),
                ...(optionalString(input, 'key') ? { key: optionalString(input, 'key') } : {}),
            };
            if (requiredString(input, 'as') === 'store') return client.post(`/v1/connections/${id}/files/store`, body);
            return client.post(`/v1/connections/${id}/files/text`, body);
        },
    },
    {
        // → POST /v1/connections/:id/write/:what — the provider entry builds the URL, the verb and the body.
        name: 'aimeat_files_write',
        handler: ({ client }, input) => client.post(
            `/v1/connections/${encodeURIComponent(requiredString(input, 'connection_id'))}/write/${encodeURIComponent(requiredString(input, 'what'))}`,
            pick(input, WRITE_PARAMS),
        ),
    },
];
