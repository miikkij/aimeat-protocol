/**
 * @file src/tool-catalog/definitions/visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI visibility tools: the owner's report (where people came from, which AIs
 *   fetched what, who read the discovery files, which purchases followed) and the owner's switch.
 *   On all three surfaces: the node's MCP endpoint (src/mcp/visibility.ts), the connector MCP and
 *   the CLI dispatch (src/tool-dispatch/tool-call-defs-visibility.ts), the last two over
 *   /v1/visibility/*.
 * @structure visibilityTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const visibilityTools = [
    {
        name: 'aimeat_visibility_report',
        description: 'How people and AIs find the person\'s place, over the last `days` days (30 by default, 0 is today, up to 400): people by channel (an AI answer, search, social, another site, direct), people sent by each AI (ChatGPT, Copilot, Perplexity, Gemini, Claude...), the pages and apps each AI fetched because someone asked it (assistant) or to build its index (crawler), who read the machine-readable files (llms.txt, AGENTS.md, the MCP card, the UCP profile), and completed purchases by the channel they came from, with a row per day. Counting is on by default for every owner and keeps no address, cookie or visitor id. Each part carries a sentence on what the number is worth; say those to the person rather than the bare numbers. It cannot show the question a person asked the AI: only whoever runs the AI sees that.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'AI Visibility Report', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'signals:read',
        surfaces: ['appdev', 'commerce'],
        input: {
            days: { type: 'number', description: 'The window in days, counted back from today. 0 is today only. Default 30, at most 400.', zod: z.number().int().min(0).max(400) },
        },
    },
    {
        name: 'aimeat_visibility_settings_set',
        description: 'Switch AI visibility counting off or on for the person\'s whole place (every app, the portfolio and company pages, the discovery files, purchases). It is on by default. Off stops new counting and keeps what was counted. Ask the person before you switch it off: the report is how they see whether AIs find them.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'AI Visibility On or Off', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'signals:write',
        surfaces: ['appdev', 'commerce'],
        input: {
            enabled: { type: 'boolean', required: true, description: 'true counts, false stops counting.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
