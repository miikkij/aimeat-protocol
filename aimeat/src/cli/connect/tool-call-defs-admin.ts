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
 *   v1.3.0 -- 2026-09-12 -- aimeat_admin_knowledge (GET /v1/admin/knowledge), the third surface of
 *     the Knowledge page's one read, with all six filters forwarded independently.
 *   v1.2.0 -- 2026-09-12 -- aimeat_admin_statistics (GET /v1/stats, with from and to forwarded as
 *     a pair), the third surface of the Statistics page's one read.
 *   v1.1.0 -- 2026-09-12 -- aimeat_admin_hooks (GET /v1/admin/hooks) and aimeat_admin_hook_set
 *     (PUT /v1/admin/hooks/:hook), on the third surface in the same change as the other two.
 *   v1.0.0 -- 2026-09-08 -- Initial: aimeat_admin_cors_overview (GET /v1/admin/cors/overview) and
 *     aimeat_admin_cors_set (the two PUT cors routes, chosen by the `#` in `who`).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, requiredValue, optionalString, optionalNumber, optionalBoolean, query } from './tool-call-helpers.js';

export const adminCliTools: ConnectCliToolDefinition[] = [
    {
        name: 'aimeat_admin_cors_overview',
        handler: ({ client }) => client.get('/v1/admin/cors/overview'),
    },
    {
        name: 'aimeat_admin_hooks',
        handler: ({ client }) => client.get('/v1/admin/hooks'),
    },
    {
        // THE THIRD SURFACE forwards all three, and forwards each date WHETHER OR NOT its partner
        // is there. A lone date is a mistake, and the route says so in a 400; withholding it here
        // would turn that refusal into thirty days of numbers wearing the caller's label.
        // `ask_provider` picks a SECOND route rather than a query parameter, because asking the
        // provider costs an outbound round trip the page's own read never pays.
        name: 'aimeat_admin_usage',
        handler: async ({ client }, input) => {
            const page = await client.get(`/v1/admin/usage/page${query({
                from: optionalString(input, 'from'),
                to: optionalString(input, 'to'),
            })}`);
            if (optionalBoolean(input, 'ask_provider') !== true || !page.ok) return page;
            // The answered keys REPLACE the page's own `keys`, which is the same block with every
            // `spend` left null. Merging into `data` rather than beside the envelope keeps the one
            // shape every other tool on this surface returns.
            const keys = await client.get('/v1/admin/usage/keys');
            const answered = (keys.data as { keys?: unknown } | undefined)?.keys;
            if (!keys.ok || !answered) return page;
            return { ...page, data: { ...(page.data as object), keys: answered } };
        },
    },
    {
        // THE THIRD SURFACE forwards all six, each on its own. None of these is read as a pair, and
        // a filter dropped here answers about a LARGER collection than the caller asked about while
        // still wearing their label — which on a moderation surface reads as "nothing to see".
        name: 'aimeat_admin_knowledge',
        handler: ({ client }, input) => client.get(`/v1/admin/knowledge${query({
            page: optionalNumber(input, 'page'),
            limit: optionalNumber(input, 'limit'),
            q: optionalString(input, 'q'),
            author_key: optionalString(input, 'author_key'),
            content_type: optionalString(input, 'content_type'),
            flagged: optionalBoolean(input, 'flagged'),
        })}`),
    },
    {
        // THE THIRD SURFACE forwards both dates, and forwards them TOGETHER. The route uses them
        // only as a pair, so dropping one here would answer the node's whole life under a period's
        // label — the exact silence this file's wrapper exists to prevent.
        name: 'aimeat_admin_statistics',
        handler: ({ client }, input) => client.get(
            `/v1/stats${query({ from: optionalString(input, 'from'), to: optionalString(input, 'to') })}`),
    },
    {
        // THE THIRD SURFACE forwards both parameters: `hook` picks the moment and `actions` is the
        // body, an empty list included, because that is how a moment is cleared.
        name: 'aimeat_admin_hook_set',
        handler: ({ client }, input) =>
            client.put(`/v1/admin/hooks/${encodeURIComponent(requiredString(input, 'hook'))}`,
                { actions: requiredValue(input, 'actions') }),
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
