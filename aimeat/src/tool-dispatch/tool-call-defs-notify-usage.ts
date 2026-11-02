/**
 * @file src/tool-dispatch/tool-call-defs-notify-usage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two agent tools on the CLI dispatch (`aimeat connect call` and
 *   `POST /local/call/<tool>`): the agent tells its own owner something (aimeat_notify), and it
 *   reads the owner's usage report (aimeat_usage_report). Thin REST proxies over
 *   POST /v1/notifications (src/routes/notifications.ts) and GET /v1/usage/summary
 *   (src/routes/usage-reports.ts), parameter for parameter with the node MCP tools
 *   (src/mcp/notify.ts, src/mcp/agent-telemetry.ts).
 *
 *   Until 2026-10-12 both had a handler only on the connector MCP (dm-messages.ts and
 *   agent-telemetry.ts under src/cli/connect/mcp/tools/), so a fleet daemon and crew code could not
 *   call them. The handlers moved here unchanged in what they send; the connector MCP runs them
 *   through dispatch-tools.ts.
 * @structure notifyUsageCliTools[] — the handler table, spread by index.ts
 * @usage import { notifyUsageCliTools } from './tool-call-defs-notify-usage.js';
 * @version-history
 *   v1.3.0 — 2026-11-02 — aimeat_home_feed, over GET /v1/home/feed (src/routes/home/feed.ts, src/mcp/home-feed.ts).
 *   v1.2.0 — 2026-10-31 — aimeat_overview, over GET /v1/overview (src/routes/overview.ts, src/mcp/overview.ts).
 *   v1.1.0 — 2026-10-31 — aimeat_notify forwards `email` (v31 K46).
 *   v1.0.0 — 2026-10-12 — Moved from the connector MCP modules (wish: every MCP tool on aimeat connect serve).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';

export const notifyUsageCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/notifications, as the connected principal. The route gates the scope and
        //   decides who the notification reaches: the caller's own owner.
        name: 'aimeat_notify',
        handler: ({ client }, input) => client.post('/v1/notifications', {
            title: requiredString(input, 'title'),
            body: input.body,
            link: input.link,
            type: input.type,
            email: input.email,
        }),
    },
    {
        // → GET /v1/usage/summary — one report over a period; the route owns the report names.
        name: 'aimeat_usage_report',
        handler: ({ client }, input) => client.get(`/v1/usage/summary${query({
            report: requiredString(input, 'report'),
            from: optionalString(input, 'from'),
            to: optionalString(input, 'to'),
            grain: optionalString(input, 'grain'),
            limit: optionalNumber(input, 'limit') || undefined,
        })}`),
    },
    {
        // → GET /v1/overview — the account's overview; the route decides what the caller may see.
        //   Without focus the node MCP answers the busiest 10 of each lane, and so does this.
        name: 'aimeat_overview',
        handler: ({ client }, input) => {
            const focus = optionalString(input, 'focus');
            return client.get(`/v1/overview${query({
                range: optionalString(input, 'range'),
                focus,
                limit: optionalNumber(input, 'limit') || (focus ? undefined : 10),
            })}`);
        },
    },
    {
        // → GET /v1/home/feed — what the person's home lists as having happened; the route gates
        //   memory:read and decides which fields of a task row the caller sees.
        name: 'aimeat_home_feed',
        handler: ({ client }) => client.get('/v1/home/feed'),
    },
];
