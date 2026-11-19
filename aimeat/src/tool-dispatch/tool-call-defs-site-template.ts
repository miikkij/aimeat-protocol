/**
 * @file src/tool-dispatch/tool-call-defs-site-template.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_site_template for the shell / local-call dispatch and the connector MCP, over
 *   GET, POST and DELETE /v1/site/template (routes/site.ts). The route decides who may and checks
 *   the input; this file only forwards.
 * @structure siteTemplateCliTools[]
 * @usage import { siteTemplateCliTools } from './tool-call-defs-site-template.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString, query } from './tool-call-helpers.js';

export const siteTemplateCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/site/template?lang= · POST /v1/site/template · DELETE /v1/site/template?lang=
        name: 'aimeat_site_template',
        handler: ({ client }, input) => {
            const action = requiredString(input, 'action');
            const lang = optionalString(input, 'lang');
            if (action === 'set') {
                const body: JsonObject = { template: requiredString(input, 'template') };
                if (lang !== undefined) body.lang = lang;
                return client.post('/v1/site/template', body);
            }
            if (action === 'delete') return client.delete(`/v1/site/template${query({ lang })}`);
            if (action === 'get') return client.get(`/v1/site/template${query({ lang })}`);
            throw new Error('action must be "get", "set" or "delete".');
        },
    },
];
