/**
 * @file agent-management.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public MCP tools for owner-managed agent attributes (mode, tags, console address).
 *   Mirrors the connector-side module at src/cli/connect/mcp/tools/agent-management.ts
 *   so Claude Desktop and other public MCP clients have parity with what
 *   aimeat-crewai liaisons see via the local connector.
 *
 *   These tools let the calling agent modify another same-owner agent's
 *   classification metadata (mode, tags). The caller must be authenticated
 *   as an agent; same-owner ownership is enforced before any mutation.
 * @structure
 *   - registerAgentManagementTools() -- registers aimeat_agent_mode_set, aimeat_agent_tags_set and
 *     aimeat_agent_console_set
 * @usage
 *   import { registerAgentManagementTools } from './agent-management.js';
 *   registerAgentManagementTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.5.0 -- 2026-08-31 -- aimeat_agent_basics_get: the chat road to the one-press basic agents.
 *     Read-only on purpose. The creating door is requireOwnerPrincipal() and stays there, so the
 *     tool tells the agent what to say and where to send the person, and the person presses.
 *   v1.0.0 -- 2026-05-29 -- Initial creation. Closes public/connector parity drift
 *     for mode_set + tags_set (connector-only since 1.12.1).
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-06-24 -- Tag pattern allows ':' (faceted prefix:value tags compose with
 *     aimeat_discover's tags filter); '@' stays excluded.
 *   v1.4.0 -- 2026-08-13 -- aimeat_agent_console_set: where an agent's HOST manages it. An agent
 *     created by a sibling in a fleet runtime the node cannot see left the owner with a card and no
 *     way through to the thing itself; the sibling that built it is the party that knows the address.
 *   v1.3.0 -- 2026-08-11 -- Both writes go through services/agent-profile-write.ts, shared with
 *     PATCH /v1/agents/:name/tags and PATCH /v1/agents/:name/mode. The mode copy here never
 *     re-derived the Hello Integration step list, so a crew self-setting task-runner through this
 *     tool, which is the caller the HTTP handler's comment names, kept the full flow and read
 *     7/16 where 7/7 was the truth.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { setAgentTags, setAgentMode, setAgentRunMode, setAgentRuntimeSource, setAgentConsoleUrl } from '../services/agent-profile-write.js';
import { describeBasicAgents, requestBasicAgents } from '../services/basic-agents.js';
import { VALID_MODES } from '../routes/agents/constants.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerAgentManagementTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool: aimeat_agent_tags_set ──
    // Replaces the owner-managed tag list on a same-owner agent. Convention:
    // 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>'. Any
    // lowercase alphanumeric-plus-`._-` string is accepted, max 20 tags.
    mcp.tool(
        'aimeat_agent_tags_set',
        descriptionFor('aimeat_agent_tags_set'),
        {
            target_agent_name: z.string().describe('Agent whose tags to update (must be owned by the same owner as the calling agent).'),
            tags: z.array(z.string()).describe('Replacement tag list. Empty array clears all tags.'),
        },
        annotationsFor('aimeat_agent_tags_set'),
        async ({ target_agent_name, tags }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentTags({ storage, config }, callerParsed.owner, target_agent_name, tags);
            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: outcome.agent.gaii,
                        name: outcome.agent.name,
                        tags: outcome.agent.tags ?? [],
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool: aimeat_agent_run_mode_set ──
    // How the agent is meant to be RUN, which is the NODE's switch and not a definition's: a queued
    // task auto-activates only for a task-runner (agent-task-rules.ts), and a spawner's roster is
    // GET /v1/agents?run_mode=spawn. Works on any agent the owner has, whatever runs it — a crew
    // whose behaviour lives in Python was locked out of that whole path while this had no tool, and
    // an owner with a browser was the only party who could set it.
    mcp.tool(
        'aimeat_agent_run_mode_set',
        descriptionFor('aimeat_agent_run_mode_set'),
        {
            target_agent_name: z.string().describe('Agent whose run mode to set (same owner as the caller).'),
            run_mode: z.enum(['spawn', 'resident']).nullable().describe("'spawn' = started per job; 'resident' = kept running; null = nobody has said, and a spawner leaves it alone."),
        },
        annotationsFor('aimeat_agent_run_mode_set'),
        async ({ target_agent_name, run_mode }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            const outcome = await setAgentRunMode({ storage, config }, callerParsed.owner, target_agent_name, run_mode);
            if (!outcome.ok) return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii: outcome.agent.gaii, name: outcome.agent.name, run_mode: outcome.agent.runMode ?? null }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_runtime_report ──
    // What code backs the agent. Recorded, never checked — the node does not run the process.
    mcp.tool(
        'aimeat_agent_runtime_report',
        descriptionFor('aimeat_agent_runtime_report'),
        {
            target_agent_name: z.string().describe('Agent this is about (same owner as the caller).'),
            kind: z.string().describe("What kind of thing runs, e.g. 'python' or 'crew-def'."),
            file: z.string().optional().describe('Path to the file that runs, relative to your own root.'),
            sha256: z.string().optional().describe("Hash of that file's contents."),
            commit: z.string().optional().describe('Commit the file came from.'),
            runtime: z.string().optional().describe("Which runtime read it, e.g. 'crewaimeat 0.7.0'."),
            definition_revision: z.number().optional().describe('For a JSON crew: which definition revision was live.'),
        },
        annotationsFor('aimeat_agent_runtime_report'),
        async ({ target_agent_name, ...src }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            const outcome = await setAgentRuntimeSource({ storage, config }, callerParsed.owner, target_agent_name, src);
            if (!outcome.ok) return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii: outcome.agent.gaii, name: outcome.agent.name, runtime_source: outcome.agent.runtimeSource ?? null }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_mode_set ──
    // Owner sets a same-owner agent's operational mode. The mode affects the
    // Hello Integration step set: task-runner gets a reduced 7-step flow,
    // workstation the narrowest 4-step flow; others get the full 13 steps.
    mcp.tool(
        'aimeat_agent_mode_set',
        descriptionFor('aimeat_agent_mode_set'),
        {
            target_agent_name: z.string().describe('Agent whose mode to update (must be owned by the same owner as the calling agent).'),
            mode: z.enum(VALID_MODES).describe('New mode.'),
        },
        annotationsFor('aimeat_agent_mode_set'),
        async ({ target_agent_name, mode }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentMode({ storage, config }, callerParsed.owner, target_agent_name, mode);
            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: outcome.agent.gaii,
                        name: outcome.agent.name,
                        mode: outcome.agent.mode ?? 'interactive',
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool: aimeat_agent_basics_get ──
    // The chat road to the basic agents. It reads and it does not create: the creating door is
    // requireOwnerPrincipal() and stays that way, because an agent calling in the owner's NAME is
    // not the owner, and creating agents is the account changing. So this hands the agent what to
    // say and where to send the person, and the person presses.
    mcp.tool(
        'aimeat_agent_basics_get',
        descriptionFor('aimeat_agent_basics_get'),
        {},
        annotationsFor('aimeat_agent_basics_get'),
        async () => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            // Same function the HTTP route calls, so the two surfaces cannot answer differently.
            const view = await describeBasicAgents(config, storage, callerParsed.owner);
            return { content: [{ type: 'text' as const, text: JSON.stringify(view, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_basics_request ──
    // The other half of the chat path, and it still creates nothing: it puts one line on the
    // owner's open-items list, and that line retires itself once they press.
    mcp.tool(
        'aimeat_agent_basics_request',
        descriptionFor('aimeat_agent_basics_request'),
        { note: z.string().max(300).optional().describe('One short phrase on why you are asking, shown to the person with the request.') },
        annotationsFor('aimeat_agent_basics_request'),
        async ({ note }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            const out = await requestBasicAgents(config, storage, callerParsed.owner, agentGaii, note);
            if (!out.ok) return { content: [{ type: 'text' as const, text: out.message }], isError: true };
            const data: Record<string, unknown> = { ...out };
            delete data.ok;
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_console_set ──
    // Where a same-owner agent is managed by whatever hosts it. The caller for this is normally the
    // sibling that just created the agent somewhere the node cannot see, reporting the address back
    // so the owner's profile can link to it.
    mcp.tool(
        'aimeat_agent_console_set',
        descriptionFor('aimeat_agent_console_set'),
        {
            target_agent_name: z.string().describe('Agent whose console address to set (must be owned by the same owner as the calling agent).'),
            console_url: z.string().describe("Absolute http(s) URL of that agent's page in its host, or '' to clear it."),
        },
        annotationsFor('aimeat_agent_console_set'),
        async ({ target_agent_name, console_url }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentConsoleUrl({ storage, config }, callerParsed.owner, target_agent_name, console_url);
            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: outcome.agent.gaii,
                        name: outcome.agent.name,
                        console_url: outcome.agent.consoleUrl ?? null,
                    }, null, 2),
                }],
            };
        },
    );
}
