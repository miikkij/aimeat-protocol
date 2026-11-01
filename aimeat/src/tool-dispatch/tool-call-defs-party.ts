/**
 * @file tool-dispatch/tool-call-defs-party.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_party on the CLI dispatch (`/local/call/<tool>`) and so on the connector MCP: a
 *   thin proxy over /v1/parties, one REST call per action, so party:manage, the checks and the writes
 *   are the node's answer here too. `stop` and `resume` with an `owner` call the operator's routes
 *   /v1/admin/parties/{owner}/{name}/stop and /resume. Nothing in this file decides anything.
 * @version-history
 *   v1.2.0 — 2026-11-01 — "share" passes `email` and `locale`, "send_link" calls POST
 *     /v1/parties/{name}/invite; aimeat_admin_app_party_registrations over the operator's registration
 *     routes (WP9b).
 *   v1.1.0 — 2026-11-01 — "share" passes `recipient` (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3.4).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString } from './tool-call-helpers.js';

const SHARE_FIELDS = ['name', 'recipient', 'package', 'purpose', 'days', 'expires', 'kind', 'display_name', 'contact', 'pinned_version', 'allow_url_key', 'terms_required', 'new_key', 'email', 'locale'] as const;
const LINK_FIELDS = ['share', 'email', 'locale'] as const;
const PARTY_FIELDS = ['name', 'kind', 'display_name', 'contact'] as const;

export const partyCliTools: ConnectCliToolDefinition[] = [
    {
        // → /v1/parties, /v1/parties/share, /v1/parties/{name}[/keys|/stop|/resume|/reads], /v1/admin/parties/...
        name: 'aimeat_party',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            const pick = (fields: readonly string[]): JsonObject => Object.fromEntries(fields.filter(f => input[f] !== undefined).map(f => [f, input[f]])) as JsonObject;
            if (action === 'list') return client.get('/v1/parties');
            if (action === 'share') return client.post('/v1/parties/share', pick(SHARE_FIELDS));
            if (action === 'create') return client.post('/v1/parties', pick(PARTY_FIELDS));
            const name = encodeURIComponent(requiredString(input, 'name'));
            const path = `/v1/parties/${name}`;
            const owner = optionalString(input, 'owner');
            switch (action) {
                case 'get': return client.get(path);
                case 'update': return client.patch(path, pick(['kind', 'display_name', 'contact']));
                case 'stop':
                case 'resume': {
                    if (owner) {
                        const reason = optionalString(input, 'reason');
                        return client.post(`/v1/admin/parties/${encodeURIComponent(owner)}/${name}/${action}`, reason !== undefined ? { reason } : {});
                    }
                    return client.post(`${path}/${action}`, {});
                }
                case 'delete': return client.delete(path);
                case 'key_create': return client.post(`${path}/keys`, {});
                case 'key_delete': return client.delete(`${path}/keys/${encodeURIComponent(requiredString(input, 'key_id'))}`);
                case 'reads': return client.get(`${path}/reads`);
                case 'send_link': return client.post(`${path}/invite`, pick(LINK_FIELDS));
                default: throw new Error('action is one of share, send_link, create, list, get, update, stop, resume, delete, key_create, key_delete, reads');
            }
        },
    },
    {
        // → GET /v1/admin/app-party-registrations, POST /v1/admin/app-party-registrations/{owner}/{filename}
        name: 'aimeat_admin_app_party_registrations',
        handler: ({ client }, input) => {
            const action = optionalString(input, 'action') ?? 'list';
            if (action !== 'decide') return client.get('/v1/admin/app-party-registrations');
            const reason = optionalString(input, 'reason');
            return client.post(`/v1/admin/app-party-registrations/${encodeURIComponent(requiredString(input, 'owner'))}/${encodeURIComponent(requiredString(input, 'app'))}`, {
                decision: requiredString(input, 'decision'), ...(reason !== undefined ? { reason } : {}),
            });
        },
    },
];
