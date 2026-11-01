/**
 * @file tool-dispatch/tool-call-defs-dataproduct.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dataproduct on the CLI dispatch (`/local/call/<tool>`) and so on the connector
 *   MCP: a thin proxy over /v1/dataproducts, one REST call per action, so the words, the source checks
 *   and the publish are the node's answer here too. Nothing in this file decides anything.
 * @version-history
 *   v1.2.0 — 2026-11-01 — action "describe" → POST /v1/dataproducts/{name}/describe, with `lang` (WP9c).
 *   v1.1.0 — 2026-11-01 — `retention` passes through to define and a draft preview (WP9a).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';

/** The definition fields PUT /v1/dataproducts/{name} and a draft preview read from the body. */
const DEFINITION_FIELDS = ['title', 'description', 'keywords', 'license', 'sources', 'combine', 'columns', 'filter', 'schedule', 'retention', 'visibility', 'confirm_personal_public'] as const;

export const dataProductCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET/PUT/DELETE /v1/dataproducts/{name}, GET /v1/dataproducts, POST .../preview, .../run and .../describe
        name: 'aimeat_dataproduct',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            if (action === 'list') return client.get('/v1/dataproducts');
            const path = `/v1/dataproducts/${encodeURIComponent(requiredString(input, 'name'))}`;
            const body: JsonObject = Object.fromEntries(DEFINITION_FIELDS.filter(f => input[f] !== undefined).map(f => [f, input[f]]));
            switch (action) {
                case 'define': return client.put(path, body);
                case 'get': return client.get(path);
                case 'preview': return client.post(`${path}/preview`, body);
                case 'run': return client.post(`${path}/run`, {});
                case 'delete': return client.delete(path);
                case 'describe': return client.post(`${path}/describe`, { ...body, ...(typeof input.lang === 'string' ? { lang: input.lang } : {}) });
                default: throw new Error('action is one of define, get, list, preview, run, delete, describe');
            }
        },
    },
];
