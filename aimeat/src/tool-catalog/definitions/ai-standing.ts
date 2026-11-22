/**
 * @file src/tool-catalog/definitions/ai-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_ai_standing_get: the owner's "Allow always" setting, read by their AI so it does
 *   not ask again for what it may already do (services/ai-standing/). On all three surfaces: the node's
 *   MCP endpoint (src/mcp/ai-standing.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-ai-standing.ts), the last two over GET /v1/ai-standing. Changing
 *   the setting is the account holder's in person (PUT /v1/ai-standing), so no tool writes it.
 * @structure aiStandingTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const aiStandingTools = [
    {
        name: 'aimeat_ai_standing_get',
        description: 'What your owner lets every one of their AIs do without asking each time ("Allow always"): each permission the setting can name, in plain words in `lang`, whether it is on, who set it and when, and whether this node allows it. A permission that is on is already on your own list, so do the work and do not ask your owner again for it; each such act is written to your owner\'s feed. A permission that is off and that you need: tell your owner in one sentence what you would do, and give them `page`, where they can turn it on for all of their AIs. Only your owner, signed in themselves, changes this setting.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Allow Always Setting', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/ai-standing asks.
        scope: 'agent:read',
        surfaces: ['agent', 'appdev', 'service'],
        input: {
            lang: { type: 'string', description: 'The language of the plain words: en, fi or es. Default en.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
