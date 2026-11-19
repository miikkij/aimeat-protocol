/**
 * @file src/tool-catalog/definitions/living.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_living_author: the owner's AI designs a living document template from a
 *   plain-language need, from the chat. On all three surfaces: the node's MCP endpoint
 *   (src/mcp/living.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-living.ts), the last two over POST /v1/living/author. One
 *   implementation: services/living/author.ts authorLivingTemplate, which takes the caller, so the
 *   owner pays and an agent's call is planned as that agent's.
 * @structure livingTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: living document authoring had no chat path, only its page and
 *     REST (feature audit 2026-11-19, 4.4 item 5).
 */
import { z } from 'zod';
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const livingTools = [
    {
        name: 'aimeat_living_author',
        description: 'Design a living document template from what the person wants it to keep track of: a document that keeps itself current on a cadence, section by section. Give `need` in the person\'s words ("a weekly page of what changed in our harbour project and who decided it"). The node\'s AI answers `template`: a title, a description, the charter (what it tracks, what it includes and leaves out, how often it refreshes, whether a refresh waits for the person\'s approval, when it stops) in `charter` and in plain words in `charterReadable`, and two to six sections, each with what it holds and, when `catalogue` named one, the agent that fills it. `catalogue` is an optional list of the owner\'s agent offers { agent, offerId, title, ask }; a section names only an agent from that list. '
            + 'Nothing is stored: show the person the template, and they save, change and start it on the Document templates page (/v1/profile?tab=living). '
            + 'The call runs on your owner\'s AI and is counted as yours: their AI policy for you, your own daily limit and their allowance apply, so a refusal names the limit that stopped it (AI_MODEL_NOT_ALLOWED, QUOTA_EXHAUSTED, NO_OPENROUTER_KEY), and PARSE_ERROR means the model answered something that was not a template: try again. Same as POST /v1/living/author.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Design a Living Document', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // The word POST /v1/living/author admits an agent with: it spends the owner's AI.
        scope: 'ai:use',
        surfaces: ['agent'],
        input: {
            need: { type: 'string', required: true, description: 'What the living document should keep track of, in the person\'s words.', zod: z.string().min(1).max(4000) },
            catalogue: { type: 'array', description: 'Optional: the owner\'s agent offers a section may name, each { agent, offerId, title, ask }. At most 60 are read.', zod: z.array(z.record(z.string(), z.unknown())).max(200) },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
