/**
 * @file src/tool-dispatch/tool-call-defs-data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map part of the shell / local-call dispatch: read an app's map, state it,
 *   and tie an app to one of the owner's agents or take that tie away.
 *
 *   Extracted from tool-call-defs-core.ts when the two tie tools pushed that file past the
 *   800-line ceiling. A pure move for aimeat_datamap_get and aimeat_datamap_set: same handlers,
 *   same comment, spread into coreTools at the place they came from.
 * @structure dataMapCliTools[] — the handler table, spread by tool-call-defs-core.ts
 * @usage import { dataMapCliTools } from './tool-call-defs-data-map.js';
 * @version-history
 *   v1.0.0 — 2026-10-11 — Extracted from tool-call-defs-core.ts (max-file-lines), with
 *     aimeat_app_agent_tie → PUT, and aimeat_app_agent_untie → DELETE, on
 *     /v1/datamap/apps/:owner/:filename/agents/:agent.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, requiredRecord } from './tool-call-helpers.js';

export const dataMapCliTools: ConnectCliToolDefinition[] = [
    {
        // THE THIRD SURFACE. A fleet daemon calls /local/call/<tool>, which dispatches here, and a
        // parameter that exists on the two MCP surfaces and not in this table is dropped in silence.
        // Every published parameter is forwarded, and test/unit/cli-tool-param-forwarding.test.ts
        // invokes this handler against a recording client to prove each one leaves the process.
        name: 'aimeat_datamap_get',
        handler: ({ client }, input) => {
            const app = requiredString(input, 'app');
            const slash = app.indexOf('/');
            if (slash <= 0) throw new Error('Name the app as "owner/filename.html".');
            return client.get(`/v1/datamap/apps/${encodeURIComponent(app.slice(0, slash))}`
                + `/${encodeURIComponent(app.slice(slash + 1))}`);
        },
    },
    {
        name: 'aimeat_datamap_set',
        handler: ({ client }, input) => {
            const app = requiredString(input, 'app');
            const slash = app.indexOf('/');
            if (slash <= 0) throw new Error('Name the app as "owner/filename.html".');
            return client.put(`/v1/datamap/apps/${encodeURIComponent(app.slice(0, slash))}`
                + `/${encodeURIComponent(app.slice(slash + 1))}`, requiredRecord(input, 'data_map'));
        },
    },
    {
        name: 'aimeat_app_agent_tie',
        handler: ({ client }, input) => {
            const app = requiredString(input, 'app');
            const slash = app.indexOf('/');
            if (slash <= 0) throw new Error('Name the app as "owner/filename.html".');
            const holds = optionalString(input, 'holds');
            return client.put(`/v1/datamap/apps/${encodeURIComponent(app.slice(0, slash))}/${encodeURIComponent(app.slice(slash + 1))}`
                + `/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}`,
            { made_for: optionalBoolean(input, 'made_for') === true, ...(holds ? { holds } : {}) });
        },
    },
    {
        name: 'aimeat_app_agent_untie',
        handler: ({ client }, input) => {
            const app = requiredString(input, 'app');
            const slash = app.indexOf('/');
            if (slash <= 0) throw new Error('Name the app as "owner/filename.html".');
            return client.delete(`/v1/datamap/apps/${encodeURIComponent(app.slice(0, slash))}/${encodeURIComponent(app.slice(slash + 1))}`
                + `/agents/${encodeURIComponent(requiredString(input, 'target_agent_name'))}`);
        },
    },
];
