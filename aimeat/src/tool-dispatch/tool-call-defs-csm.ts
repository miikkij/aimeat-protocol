/**
 * @file src/tool-dispatch/tool-call-defs-csm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_csm on the CLI dispatch (`/local/call/<tool>`) and so on the connector MCP: a thin
 *   proxy over /v1/csm, one REST call per action, so the owner prefix, the visibility, the version check
 *   and the in-use refusal are the node's answer here too. Nothing in this file decides anything.
 * @structure csmCliTools
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM owner prefix, visibility, versions, csm:write, draft; Jouni, 2026-11-07).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, query } from './tool-call-helpers.js';

/** The fields of input that go into the body under their own names, when present. */
const pick = (input: JsonObject, keys: readonly string[]): JsonObject =>
    Object.fromEntries(keys.filter(k => input[k] !== undefined && input[k] !== null).map(k => [k, input[k]]));

export const csmCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/csm, GET/PUT/PATCH/DELETE /v1/csm/{name}, GET .../versions(/{n}), GET /v1/csm/templates(/{type}),
        //   POST /v1/csm/draft, POST /v1/csm
        name: 'aimeat_csm',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            // The name, path-encoded; read only by the actions that take one.
            const n = () => encodeURIComponent(requiredString(input, 'name'));
            switch (action) {
                case 'list': return client.get(`/v1/csm${query({ service_type: typeof input.service_type === 'string' ? input.service_type : undefined })}`);
                case 'get': return client.get(`/v1/csm/${n()}`);
                case 'versions': return client.get(typeof input.version === 'number' ? `/v1/csm/${n()}/versions/${input.version}` : `/v1/csm/${n()}/versions`);
                case 'templates': return client.get(typeof input.type === 'string'
                    ? `/v1/csm/templates/${encodeURIComponent(input.type)}?format=json` : '/v1/csm/templates');
                case 'from_sample': return client.post('/v1/csm/draft', pick(input, ['name', 'sample', 'service_type', 'description']));
                case 'create': return client.post('/v1/csm', pick(input, ['yaml', 'definition', 'visibility', 'federate']));
                case 'update': return client.put(`/v1/csm/${n()}`, pick(input, ['yaml', 'definition', 'expected_version']));
                case 'set_visibility': return client.patch(`/v1/csm/${n()}`, pick(input, ['visibility']));
                case 'delete': return client.delete(`/v1/csm/${n()}`);
                default: throw new Error('action is one of list, get, versions, templates, from_sample, create, update, set_visibility, delete');
            }
        },
    },
];
