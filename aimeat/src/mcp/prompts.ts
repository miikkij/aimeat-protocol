/**
 * @file prompts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP handbook tool registration. Provides 1 tool for retrieving the agent
 *   operating handbook or managed prompts by tier. No resource -- fetched on-demand.
 * @structure
 *   - registerPromptsTools() — registers the prompts get tool on an McpServer instance
 * @usage
 *   import { registerPromptsTools } from './prompts.js';
 *   registerPromptsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   2026-09-19 — aimeat_handbook_get serves the ATELIER specification in parts
 *     ("build-app-atelier", "build-app-atelier/<id>"). It had no MCP door at all, so a chat could
 *     not read the guide of the track a new app is built on.
 *   v1.0.0 -- 2026-03-21 -- Initial creation: 1 tool for managed system prompt retrieval via MCP
 *   v1.1.0 -- 2026-05-27 -- Rename tool from aimeat_prompts_get to aimeat_handbook_get
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + readOnlyHint) from shared
 *     annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.4.0 -- 2026-05-30 -- aimeat_handbook_get gains optional `surface` param → returns the v2
 *     per-role surface handbook (handbookForRole); tier now optional (defaults tier1).
 *   v1.6.0 -- 2026-09-18 -- A call with no arguments returns the handbook of the surface the session
 *     is on (`full` on /v1/mcp), followed by which of this node's skills fits which situation.
 *     It returned the REST tier-1 handbook with {{variables}} unfilled, which names no MCP tool;
 *     the server instructions send every agent here first, and five of nine cold-agent baseline
 *     tasks opened with it. `surface` takes all seven roles (it took four, so three handbooks
 *     could not be read over MCP), and a tier asked for by name has its variables filled.
 *   v1.7.0 -- 2026-09-18 -- `tier: "build-app"` returns the first of the four parts of the build
 *     specification every app needs, with an index of the rest; `"build-app/<id>"` returns one
 *     part or one section. It answered
 *     "Prompt not found", because the specification is code-built and this tool read managed
 *     prompts only.
 *   v1.5.0 -- 2026-08-22 -- The surface handbook carries the proactive guidance while the owner
 *     keeps that setting on (services/proactive-mode.ts). Tier prompts are left alone on purpose:
 *     that response reports a managed prompt's own content, and appending to it would misreport it.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { handbookForRole } from '../services/handbooks/index.js';
import { proactiveGuidance } from '../services/proactive-mode.js';
import { skillsBySituation } from '../services/skills-by-situation.js';
import { substituteVariables } from '../services/prompt-variables.js';
import { buildAppPrompt } from '../services/build-app-prompt.js';
import { buildAppPiece, buildAppPieceIds } from '../services/build-app-layers.js';
import { buildAtelierPrompt } from '../services/build-atelier-prompt.js';
import { atelierPiece, atelierPieceIds } from '../services/build-atelier-layers.js';
import { toolError } from './tool-error.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { V2_ROLES, toolsForSurface, type SurfaceRole } from './catalog/surfaces.js';

export function registerPromptsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The surface this session is connected to. 'all' is /v1/mcp, which carries every tool. */
    role: SurfaceRole | 'all' = 'all',
): void {

    // ── Tool 1: aimeat_handbook_get ──
    mcp.tool(
        'aimeat_handbook_get',
        descriptionFor('aimeat_handbook_get'),
        {
            tier: z.string().optional().describe('A REST-style tier handbook or a managed prompt by id (e.g. "tier1", "tier2", or a custom prompt ID), for an agent that works over HTTP. Leave it out over MCP: the handbook for your own surface comes back. Two values are for every builder. "build-app-atelier" returns the first part of the ATELIER build specification, the track an app is built on unless there is a reason not to, and "build-app-atelier/<id>" one of the parts it lists. "build-app" and "build-app/<id>" do the same for the Classic specification.'),
            surface: z.enum(V2_ROLES as unknown as [SurfaceRole, ...SurfaceRole[]]).optional().describe('Read another surface\'s handbook than your own. Leave it out to get the one for the surface you are connected to.'),
        },
        annotationsFor('aimeat_handbook_get'),
        async ({ tier, surface }) => {
            // The handbook an MCP agent gets when it asks for "the handbook", which is what the
            // server instructions tell it to do first: the one for the surface it is on, and the
            // whole-node one on /v1/mcp. Until 2026-09-18 a call with no arguments returned the
            // REST tier-1 handbook with its {{variables}} unfilled: a boot sequence of HTTP calls
            // and a cron watchdog, naming no MCP tool, which is what five of nine cold-agent
            // baseline tasks opened with. A tier is still served when it is asked for by name.
            if (surface || !tier) {
                const which: SurfaceRole = surface ?? (role === 'all' ? 'full' : role);
                const ownerName = parseGaiiLoose(getAgentGaii()).owner || undefined;
                // The same guidance the handshake carried, for the agent that treats the handbook
                // as its operating guide and re-reads it when a task is new to it. Appended to the
                // markdown rather than to a managed prompt's `content`, which has to keep saying
                // what that prompt actually says.
                const guidance = await proactiveGuidance(storage, config, ownerName);
                // Which skill fits which situation, from this node's own registry. Only where the
                // surface carries the tool that loads one.
                const canLoadSkills = role === 'all' || toolsForSurface(role).has('aimeat_skill_get');
                const skills = canLoadSkills ? await skillsBySituation(storage, config, ownerName ?? null) : '';
                const text = [handbookForRole(which), skills, guidance].filter(Boolean).join('\n\n');
                return { content: [{ type: 'text' as const, text }] };
            }
            const tierKey = tier;
            // The build specification is code-built, not a managed prompt, so the lookup below
            // never found it: every cold-agent build run asked for `build-app` here and was told
            // "Prompt not found", and then built without the text the app-builder skill calls law.
            // Served in pieces, because the whole of it is more than one tool result carries: even
            // the 66 kB core never reached the model in the first measured run (the client wrote
            // it to a file a chat cannot read). "build-app" is the first of four parts.
            if (tierKey === 'build-app' || tierKey.startsWith('build-app/')) {
                const full = buildAppPrompt(config, { mode: 'new', lang: 'en' }).full;
                const id = tierKey.slice('build-app/'.length) || 'start';
                const piece = buildAppPiece(full, id, config.baseUrl);
                if (piece) return { content: [{ type: 'text' as const, text: piece.text }] };
                return toolError('NOT_FOUND', `The build specification has no part or section "${id}". It has: ${buildAppPieceIds(full).join(', ')}. Ask for "build-app" to read the first part, which lists the others.`);
            }
            // The Atelier specification had no MCP door at all until 2026-09-19: it is 68 kB, a
            // chat with no HTTP tool could not read it, and the track every app is meant to be
            // built on was therefore the one whose guide a chat could not open.
            if (tierKey === 'build-app-atelier' || tierKey.startsWith('build-app-atelier/')) {
                const full = buildAtelierPrompt(config, { mode: 'new', lang: 'en' }).full;
                const id = tierKey.slice('build-app-atelier/'.length) || 'start';
                const piece = atelierPiece(full, id, config.baseUrl);
                if (piece) return { content: [{ type: 'text' as const, text: piece.text }] };
                return toolError('NOT_FOUND', `The Atelier build specification has no part "${id}". It has: ${atelierPieceIds().join(', ')}. Ask for "build-app-atelier" to read the first part, which lists the others.`);
            }
            // Normalize tier aliases used in routes (tier1 → tier-1, etc.)
            const normalized = tierKey
                .replace(/^tier(\d)$/, 'tier-$1')
                .replace(/^(\d)$/, 'tier-$1');

            // Filled the way GET /v1/agents/me/handbook fills them. This door returned the raw
            // text, so an agent read "You are AIMEAT agent {{gaii}} on node {{node_id}}".
            const gaii = getAgentGaii();
            const agent = gaii ? await storage.getAgent(gaii) : null;
            const fill = (content: string) => substituteVariables(content, {
                node_url: config.baseUrl,
                node_id: config.nodeId,
                gaii,
                agent_name: parseGaiiLoose(gaii).agent || 'unknown',
                trust_score: agent?.trustScore ?? 50,
                daily_allowance: config.dailyAllowance,
            });

            const record = await storage.getSystemPrompt(normalized);
            if (!record || !record.active) {
                // Try the original key as a fallback
                const fallback = await storage.getSystemPrompt(tierKey);
                if (!fallback || !fallback.active) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: `Prompt not found or not active: ${tierKey}`,
                        }],
                        isError: true,
                    };
                }

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            id: fallback.id,
                            name: fallback.name,
                            description: fallback.description,
                            content: fill(fallback.content),
                            group: fallback.group,
                            variables: fallback.variables,
                        }, null, 2),
                    }],
                };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: record.id,
                        name: record.name,
                        description: record.description,
                        content: fill(record.content),
                        group: record.group,
                        variables: record.variables,
                    }, null, 2),
                }],
            };
        },
    );
}
