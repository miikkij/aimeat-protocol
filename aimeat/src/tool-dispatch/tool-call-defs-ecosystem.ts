/**
 * @file src/tool-dispatch/tool-call-defs-ecosystem.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outside application (ecosystem app) tools for the shell / local-call dispatch and
 *   the connector MCP, over GET /v1/ecosystem-apps and DELETE /v1/ecosystem-apps/:app
 *   (routes/ecosystem-apps.ts). The route decides who may ask; this file only forwards.
 * @structure ecosystemCliTools[]
 * @usage import { ecosystemCliTools } from './tool-call-defs-ecosystem.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial: aimeat_ecosystem_app_list and aimeat_ecosystem_app_revoke.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';

export const ecosystemCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/ecosystem-apps
        name: 'aimeat_ecosystem_app_list',
        handler: ({ client }) => client.get('/v1/ecosystem-apps'),
    },
    {
        // → DELETE /v1/ecosystem-apps/:app
        name: 'aimeat_ecosystem_app_revoke',
        handler: ({ client }, input) => client.delete(`/v1/ecosystem-apps/${encodeURIComponent(requiredString(input, 'app'))}`),
    },
];
