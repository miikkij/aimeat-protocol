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
 *   v1.1.0 — 2026-10-08 — aimeat_visibility_settings_set takes clarity_project_id and ga4_measurement_id (layer B).
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
        description: 'Change the person\'s visibility settings; only the fields you give change. `enabled` switches AI visibility counting off or on for the whole place (every app, the portfolio and company pages, the discovery files, purchases); it is on by default, and off keeps what was counted. Ask the person before you switch it off: the report is how they see whether AIs find them. `clarity_project_id` and `ga4_measurement_id` add the person\'s OWN Microsoft Clarity or Google Analytics 4 to every page and app of the place (null removes one); the data goes to the person\'s own accounts. With the node\'s cookie banner on, the tags wait for the visitor\'s consent; without it the answer carries `tags_warning`, which you must tell the person: EU visitors need consent first.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'AI Visibility Settings', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'signals:write',
        surfaces: ['appdev', 'commerce'],
        input: {
            enabled: { type: 'boolean', description: 'true counts, false stops counting.' },
            clarity_project_id: { type: 'string', description: 'The Microsoft Clarity project id (Clarity: Settings > Overview), 6 to 20 letters and digits. null removes it.', zod: z.string().max(40).nullable() },
            ga4_measurement_id: { type: 'string', description: 'The Google Analytics 4 measurement id of a web data stream, such as G-ABC123XYZ9. null removes it.', zod: z.string().max(40).nullable() },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
