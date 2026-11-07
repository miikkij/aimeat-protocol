/**
 * @file tool-dispatch/tool-call-defs-receivers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_receiver and aimeat_admin_receivers on the CLI dispatch (`/local/call/<tool>`) and
 *   so on the connector MCP: a thin proxy over /v1/receivers and /v1/admin/receivers, one REST call per
 *   action, so receivers:read, receivers:manage, the operator check and the target checks are the
 *   node's answer here too. checkReceiverInput (the catalog's one table) runs first, as on the node MCP.
 *   Nothing in this file decides anything.
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString } from './tool-call-helpers.js';
import { checkReceiverInput } from '../tool-catalog/definitions/receivers.js';

const SETTING_FIELDS = ['verbs', 'limits', 'visibility', 'display_name', 'description', 'expires_days', 'csm_version', 'target_max_keys'] as const;
const CREATE_FIELDS = ['name', 'target', 'csm', 'csm_version', 'verbs', 'limits', 'visibility', 'display_name', 'description', 'expires_days'] as const;

export const receiverCliTools: ConnectCliToolDefinition[] = [
    {
        // → /v1/receivers, /v1/receivers/proposals, /v1/receivers/{name}[/deliveries|/pause|/resume|/rotate]
        name: 'aimeat_receiver',
        handler: ({ client }, input) => {
            const checked = checkReceiverInput(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
            if (!checked.ok) throw new Error(`INVALID_INPUT: ${checked.message}`);
            const pick = (fields: readonly string[]): JsonObject => Object.fromEntries(fields.filter(f => input[f] !== undefined).map(f => [f, input[f]])) as JsonObject;
            const action = checked.action;
            if (action === 'list') return client.get('/v1/receivers');
            if (action === 'propose') return client.post('/v1/receivers/proposals', pick(CREATE_FIELDS));
            if (action === 'create') return client.post('/v1/receivers', pick(CREATE_FIELDS));
            const path = `/v1/receivers/${encodeURIComponent(requiredString(input, 'name'))}`;
            switch (action) {
                case 'get': return client.get(path);
                case 'deliveries': return client.get(`${path}/deliveries${input.only_refused === true ? '?refused=true' : ''}`);
                case 'update': return client.patch(path, pick(SETTING_FIELDS));
                case 'pause': return client.post(`${path}/pause`, {});
                case 'resume': return client.post(`${path}/resume`, {});
                case 'rotate': return client.post(`${path}/rotate`, input.overlap_minutes !== undefined ? { overlap_minutes: input.overlap_minutes } as JsonObject : {});
                case 'delete': return client.delete(path);
                default: throw new Error(`INVALID_INPUT: unknown action "${action}"`);
            }
        },
    },
    {
        // → GET /v1/admin/receivers, POST /v1/admin/receivers/{owner}/{name}/stop|start|decide
        name: 'aimeat_admin_receivers',
        handler: ({ client }, input) => {
            const action = optionalString(input, 'action') ?? 'list';
            if (action === 'list') {
                const owner = optionalString(input, 'owner');
                return client.get(`/v1/admin/receivers${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`);
            }
            const path = `/v1/admin/receivers/${encodeURIComponent(requiredString(input, 'owner'))}/${encodeURIComponent(requiredString(input, 'name'))}`;
            const reason = optionalString(input, 'reason');
            if (action === 'stop') return client.post(`${path}/stop`, { reason: requiredString(input, 'reason') });
            if (action === 'start') return client.post(`${path}/start`, {});
            if (action === 'decide') return client.post(`${path}/decide`, { decision: requiredString(input, 'decision'), ...(reason !== undefined ? { reason } : {}) });
            throw new Error('INVALID_INPUT: action is one of list, stop, start, decide');
        },
    },
];
