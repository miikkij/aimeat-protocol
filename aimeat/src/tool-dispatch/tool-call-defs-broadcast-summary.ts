/**
 * @file src/tool-dispatch/tool-call-defs-broadcast-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dm_broadcast_summary for the shell / local-call dispatch and the connector MCP,
 *   over GET /v1/messages/broadcast/:id (routes/messages.ts). The route decides whose broadcast it
 *   finds; this file only forwards.
 * @structure broadcastSummaryCliTools[]
 * @usage import { broadcastSummaryCliTools } from './tool-call-defs-broadcast-summary.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial.
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString } from './tool-call-helpers.js';

export const broadcastSummaryCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/messages/broadcast/:id
        name: 'aimeat_dm_broadcast_summary',
        handler: ({ client }, input) => client.get(`/v1/messages/broadcast/${encodeURIComponent(requiredString(input, 'broadcast_id'))}`),
    },
];
