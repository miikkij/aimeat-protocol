/**
 * @file src/cli/connect/tool-call-defs-apps-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CLI dispatch definitions for the node's search visibility (aimeat_seo_status,
 *   aimeat_seo_announce). An app's own settings are aimeat_app_manage since 2026-09-27
 *   (tool-call-defs-app-manage.ts). A pure extraction from tool-call-defs-apps.ts when that file passed the
 *   800-line ceiling; the entries are spread back into appTools, so the assembled table, the
 *   parity gates and test/unit/cli-tool-param-forwarding.test.ts see the same list as before.
 * @structure appSettingsTools: ConnectCliToolDefinition[]
 * @usage import { appSettingsTools } from './tool-call-defs-apps-settings.js';
 * @version-history
 *   v1.5.0 -- 2026-09-27 -- The six per-app tools moved into aimeat_app_manage; the two node-wide SEO
 *     tools stay.
 *   v1.4.0 -- 2026-09-18 -- aimeat_app_visitors and aimeat_app_visitors_measure, on the third surface
 *     in the same change as the other two.
 *   v1.3.0 -- 2026-09-11 -- aimeat_seo_announce: the whole site to IndexNow (or its plan), on the
 *     third surface in the same change as the other two.
 *   v1.2.0 -- 2026-09-02 -- aimeat_app_audit forwards `playtest`, so a fleet agent on this door can
 *     have the node open its app in a headless browser. The third surface gets the parameter in the
 *     same change as the other two, which is the whole point of this file existing.
 *   v1.1.0 -- 2026-08-29 -- aimeat_app_legal_set forwards ai_provenance / ai_provenance_id in the PATCH body.
 *   v1.0.0 -- 2026-08-29 -- Extracted from tool-call-defs-apps.ts (max-file-lines), no behaviour change.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { optionalString, optionalBoolean } from './tool-call-helpers.js';

export const appSettingsTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/admin/seo/status — is this node findable, and what is left to do. Operator-only.
        name: 'aimeat_seo_status',
        description: 'Whether this node can be found in a search engine, and what is still undone about it. Operator-only.',
        input: {},
        handler: ({ client }) => client.get('/v1/admin/seo/status'),
    },
    {
        // → POST /v1/admin/seo/indexnow, or GET /v1/admin/seo/indexnow/plan with plan: true — the
        //   whole site to IndexNow, one batch per host under that host's own key. Operator-only.
        name: 'aimeat_seo_announce',
        description: 'Tell the search engines about the whole site now through IndexNow, or with plan: true list what would be sent. Operator-only.',
        input: {
            scope: { type: 'string', description: '"all" (default): the pages and every findable application. "pages": the pages alone.' },
            plan: { type: 'boolean', description: 'true lists what would be sent, host by host, and sends nothing.' },
        },
        handler: ({ client }, input) => {
            const scope = optionalString(input, 'scope') ?? 'all';
            if (optionalBoolean(input, 'plan')) return client.get(`/v1/admin/seo/indexnow/plan?scope=${encodeURIComponent(scope)}`);
            return client.post('/v1/admin/seo/indexnow', { scope });
        },
    },
];
