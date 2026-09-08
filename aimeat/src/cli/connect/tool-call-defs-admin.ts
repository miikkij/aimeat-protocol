/**
 * @file cli/connect/tool-call-defs-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's CORS connect-call tool definitions: the CORS page in one read and the
 *   write that sets or clears a person's or an agent's list. Their own file because
 *   tool-call-defs-core.ts sits eight lines under the 800-line ceiling; the next operator page's
 *   tools belong here beside them.
 * @structure adminCliTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { adminCliTools } from './tool-call-defs-admin.js';
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial: aimeat_admin_cors_overview (GET /v1/admin/cors/overview) and
 *     aimeat_admin_cors_set (the two PUT cors routes, chosen by the `#` in `who`).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, requiredValue } from './tool-call-helpers.js';

export const adminCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_admin_cors_overview',
        handler: ({ client }) => client.get('/v1/admin/cors/overview'),
    },
    {
        // THE THIRD SURFACE forwards both parameters: `who` picks the door (an agent's address carries
        // a `#`, a person's does not) and `origins` is the body, null included, so a clear reaches the
        // node as the null the route understands.
        name: 'aimeat_admin_cors_set',
        handler: ({ client }, input) => {
            const who = requiredString(input, 'who');
            const path = who.includes('#')
                ? `/v1/admin/agents/${encodeURIComponent(who)}/cors`
                : `/v1/admin/ghii/${encodeURIComponent(who)}/cors`;
            return client.put(path, { allowed_origins: requiredValue(input, 'origins') });
        },
    },
];
