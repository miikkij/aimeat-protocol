/**
 * @file tool-dispatch/tool-call-defs-refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mail refinery on the CLI dispatch (`/local/call/<tool>`): thin REST proxies over
 *   /v1/refinery/*, so the scope checks and the batch are the node's answer here too. Nothing in
 *   this file decides anything.
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalArray } from './tool-call-helpers.js';

export const refineryCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/refinery/classes
        name: 'aimeat_refinery_classes',
        handler: ({ client }) => client.get('/v1/refinery/classes'),
    },
    {
        // → POST /v1/refinery/runs — answers at once with the run.
        name: 'aimeat_refinery_run',
        handler: ({ client }, input) => {
            const ids = optionalArray(input, 'message_ids');
            return client.post('/v1/refinery/runs', {
                prefix: requiredString(input, 'prefix'),
                ...(ids ? { message_ids: ids } : {}),
            });
        },
    },
    {
        // → GET /v1/refinery/runs/:id
        name: 'aimeat_refinery_status',
        handler: ({ client }, input) => client.get(`/v1/refinery/runs/${encodeURIComponent(requiredString(input, 'run_id'))}`),
    },
];
