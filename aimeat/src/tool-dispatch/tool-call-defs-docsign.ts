/**
 * @file tool-dispatch/tool-call-defs-docsign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Document signing and signature validation on the CLI dispatch (`/local/call/<tool>`)
 *   and the connector MCP: thin REST proxies over /v1/docsign/*, so the node decides everything.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — aimeat_docsign_wallet_start and _wallet_status (wish-allekirjoitus-eudi-lompakolla).
 *   v1.2.0 — 2026-10-10 — aimeat_docsign_wallet_start's storage_key is optional.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalRecord, requiredArray, query } from './tool-call-helpers.js';

const id = (input: Record<string, unknown>) => encodeURIComponent(requiredString(input, 'id'));

export const docsignCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/docsign/validate (JSON: a stored file, or the bytes as base64)
        name: 'aimeat_docsign_validate',
        handler: ({ client }, input) => {
            const storageKey = optionalString(input, 'storage_key');
            const documentKey = optionalString(input, 'document_storage_key');
            const content = optionalString(input, 'content_base64');
            const online = optionalBoolean(input, 'online');
            return client.post('/v1/docsign/validate', {
                ...(storageKey ? { storage_key: storageKey } : {}),
                ...(documentKey ? { document_storage_key: documentKey } : {}),
                ...(content ? { content_base64: content } : {}),
                ...(online !== undefined ? { online } : {}),
            });
        },
    },
    {
        // → GET /v1/docsign/lookup/:sha256
        name: 'aimeat_docsign_lookup',
        handler: ({ client }, input) => client.get(`/v1/docsign/lookup/${encodeURIComponent(requiredString(input, 'sha256'))}`),
    },
    {
        // → POST /v1/docsign/requests
        name: 'aimeat_docsign_request_create',
        handler: ({ client }, input) => {
            const storageKey = optionalString(input, 'storage_key');
            const document = optionalRecord(input, 'document');
            const title = optionalString(input, 'title');
            const message = optionalString(input, 'message');
            return client.post('/v1/docsign/requests', {
                ...(title ? { title } : {}),
                ...(message ? { message } : {}),
                ...(storageKey ? { storage_key: storageKey } : {}),
                ...(document ? { document } : {}),
                parties: requiredArray(input, 'parties'),
            });
        },
    },
    {
        // → GET /v1/docsign/requests?state=
        name: 'aimeat_docsign_requests',
        handler: ({ client }, input) => client.get(`/v1/docsign/requests${query({ state: optionalString(input, 'state') })}`),
    },
    {
        // → GET /v1/docsign/requests/:id
        name: 'aimeat_docsign_request_get',
        handler: ({ client }, input) => client.get(`/v1/docsign/requests/${id(input)}`),
    },
    {
        // → POST /v1/docsign/requests/:id/sign
        name: 'aimeat_docsign_sign',
        handler: ({ client }, input) => {
            const signature = optionalString(input, 'signature');
            return client.post(`/v1/docsign/requests/${id(input)}/sign`, {
                method: requiredString(input, 'method'),
                ...(signature ? { signature } : {}),
            });
        },
    },
    {
        // → POST /v1/docsign/requests/:id/cancel
        name: 'aimeat_docsign_cancel',
        handler: ({ client }, input) => client.post(`/v1/docsign/requests/${id(input)}/cancel`, {}),
    },
    {
        // → DELETE /v1/docsign/requests/:id
        name: 'aimeat_docsign_delete',
        handler: ({ client }, input) => client.delete(`/v1/docsign/requests/${id(input)}`),
    },
    {
        // → POST /v1/docsign/requests/:id/wallet (JSON: the PDF named by a stored file)
        name: 'aimeat_docsign_wallet_start',
        handler: ({ client }, input) => {
            const storageKey = optionalString(input, 'storage_key');
            return client.post(`/v1/docsign/requests/${id(input)}/wallet`, storageKey ? { storage_key: storageKey } : {});
        },
    },
    {
        // → GET /v1/docsign/requests/:id/wallet/:session
        name: 'aimeat_docsign_wallet_status',
        handler: ({ client }, input) => client.get(`/v1/docsign/requests/${id(input)}/wallet/${encodeURIComponent(requiredString(input, 'session_id'))}`),
    },
];
