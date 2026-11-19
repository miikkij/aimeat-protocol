/**
 * @file src/tool-catalog/definitions/broadcast-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dm_broadcast_summary: the results of a broadcast the calling agent sent, for an
 *   AI. On all three surfaces: the node's MCP endpoint (src/mcp/dm-messages.ts), the connector MCP and
 *   the CLI dispatch (src/tool-dispatch/tool-call-defs-broadcast-summary.ts), the last two over GET
 *   /v1/messages/broadcast/:id. One implementation: services/message/broadcast.ts broadcastSummary.
 * @structure broadcastSummaryTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: an agent sent a broadcast from the chat and could not read its
 *     results (feature audit 2026-11-19, 4.4 item 5).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const broadcastSummaryTools = [
    {
        name: 'aimeat_dm_broadcast_summary',
        description: 'The results of a broadcast you sent with aimeat_dm_broadcast: `total` copies, how many were `delivered`, `read` and `answered`, and per recipient its `status` and, for a poll, the `answers`. `mode` says announcement or broadcast, and `interactive` holds the questions you asked. Only the broadcasts you sent yourself are found; one your owner or another agent sent is NOT_FOUND. Same as GET /v1/messages/broadcast/:id.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Broadcast Results', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/messages/broadcast/:id admits an agent with.
        scope: 'messages:read',
        surfaces: ['agent'],
        input: {
            broadcast_id: { type: 'string', required: true, description: 'The broadcast_id aimeat_dm_broadcast answered.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
