/**
 * @file tool-dispatch/tool-call-defs-dataspace.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dataspace on the CLI dispatch (`/local/call/<tool>`) and so on the connector MCP:
 *   a thin proxy over /v1/dataspace, one REST call per action, so party:manage, the checks and the
 *   writes are the node's answer here too. Nothing in this file decides anything.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString } from './tool-call-helpers.js';

export const dataspaceCliTools: ConnectCliToolDefinition[] = [
    {
        // → /v1/dataspace/negotiations[/{pid}[/approve|/decline]], /v1/dataspace/settings
        name: 'aimeat_dataspace',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            if (action === 'list') {
                const q = new URLSearchParams();
                const state = optionalString(input, 'state');
                if (state) q.set('state', state);
                if (input.waiting === true) q.set('waiting', 'true');
                return client.get(`/v1/dataspace/negotiations${q.size ? `?${q}` : ''}`);
            }
            if (action === 'settings') {
                if (input.package === undefined) return client.get('/v1/dataspace/settings');
                return client.put('/v1/dataspace/settings', { package: input.package, auto_agree: input.auto_agree ?? null } as JsonObject);
            }
            const path = `/v1/dataspace/negotiations/${encodeURIComponent(requiredString(input, 'provider_pid'))}`;
            switch (action) {
                case 'get': return client.get(path);
                case 'approve': return client.post(`${path}/approve`, {});
                case 'decline': {
                    const reason = optionalString(input, 'reason');
                    return client.post(`${path}/decline`, reason !== undefined ? { reason } : {});
                }
                default: throw new Error('action is one of list, get, approve, decline, settings');
            }
        },
    },
];
