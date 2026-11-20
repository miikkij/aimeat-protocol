/**
 * @file src/tool-catalog/definitions/organism-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_organism_apps: an organism's own app wall, the apps its members opened to it
 *   (services/app/organism-wall.ts). On all three surfaces: the node's MCP endpoint
 *   (src/mcp/organism-apps.ts), the connector MCP and the CLI dispatch
 *   (src/tool-dispatch/tool-call-defs-organism-apps.ts), the last two over GET /v1/organisms/:id/apps.
 * @structure organismAppsTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const organismAppsTools = [
    {
        name: 'aimeat_organism_apps',
        description: 'The apps your owner\'s colleagues made and opened to one organism (a company, a team or a training): each app\'s name, what it does, its address, who made it and their teams, when it was published, how many times it was opened (in all and today, as counts only) and the capabilities it is made of (the libraries, cortexes and extensions it uses). Newest first. Use it to show what others built, or to answer "what could I build with the same capabilities": read how an app is put together, then ask the person what they do in their work. Members of the organism only. A training is an organism of its own, so "what did we make in today\'s training" is this list of that organism, apps published today. The person opens the same wall at /v1/appcat?view=org&org=<organism id>.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Organism App Wall', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/organisms/:id/apps asks.
        scope: 'organism:read',
        surfaces: ['agent', 'appdev', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'The organism whose app wall to read (aimeat_organism_list gives the ids).' },
            lang: { type: 'string', description: 'The language of the capability titles and team names: en, fi or es. Default en.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
