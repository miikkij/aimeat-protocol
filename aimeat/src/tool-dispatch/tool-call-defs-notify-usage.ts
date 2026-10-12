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
];
