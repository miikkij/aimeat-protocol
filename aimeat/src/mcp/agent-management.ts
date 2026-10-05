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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.9.0 -- 2026-10-02 -- aimeat_agent_runtime_report takes `llm` ('node' | 'machine'), and an agent
 *     reports its own runtime without agent:write (scope-exempt, the sibling check in the handler).
 *   v1.8.0 -- 2026-10-02 -- aimeat_agent_tags_set: an agent sets its own tags without agent:write,
 *     and another agent's still need it. The tool moves to SCOPE_EXEMPT_TOOLS so an agent without
 *     the word sees it, and the sibling check sits in the handler.
 *   v1.7.0 -- 2026-10-02 -- aimeat_agent_propose answers with `approval_url` and the service's own
 *     next_step sentence, the same two the REST answer gives.
 *   v1.6.1 -- 2026-09-26 -- The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.6.0 -- 2026-09-08 -- aimeat_agent_propose, which aimeat_agent_basics_get's own description
 *     had been telling agents to call since 2026-09-02 without it existing. Creates nothing: the
 *     approve door stays the owner in person. The registration now takes the session's scopes,
 *     because the ceiling this applies is "no more than the caller holds".
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII, localAccountName, agentGaiiFromIdentifier } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { toolError } from './tool-error.js';
import { setAgentTags, setAgentMode, setAgentRunMode, setAgentRuntimeSource, setAgentDescription, setAgentConsoleUrl } from '../services/agent-profile-write.js';
import { describeBasicAgents, requestBasicAgents } from '../services/basic-agents.js';
import { proposeAgent, proposalApprovalUrl, proposalNextStep } from '../services/agent-proposals.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export function registerAgentManagementTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** What THIS session was granted. The proposal ceiling reads it: an agent may not propose a
     *  principal that can do more than the agent proposing it. */
    sessionScopes: string[] = [],
): void {
    const agentGaii = getAgentGaii();

    // ── Tool: aimeat_agent_tags_set ──
    // Replaces the owner-managed tag list on a same-owner agent. Convention:
    // 'crew:<name>', 'source:<name>', 'role:<name>', 'project:<name>'. Any
    // lowercase alphanumeric-plus-`._-` string is accepted, max 20 tags.
    mcp.tool(
        'aimeat_agent_tags_set',
        descriptionFor('aimeat_agent_tags_set'),
        zodShapeFor('aimeat_agent_tags_set'),
        annotationsFor('aimeat_agent_tags_set'),
        async ({ target_agent_name, tags }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            // Its own tags need no agent:write; a sibling's do (auth/self-or-scope.ts, the same rule
            // as PATCH /v1/agents/:name/tags). The tool is scope-exempt so an agent without the word
            // still sees it, which puts the sibling check here.
            const self = agentGaiiFromIdentifier(target_agent_name, localAccountName(agentGaii), config.nodeId) === agentGaii;
            if (!self && !scopeIsCovered(sessionScopes, 'agent:write')) {
                return toolError('SCOPE_DENIED', 'Scope "agent:write" required to set another agent\'s tags. An agent may set its own without it.');
            }

            const outcome = await setAgentTags({ storage, config }, localAccountName(agentGaii), target_agent_name, tags);
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

    // ── Tool: aimeat_agent_description_set ──
    // The sentence a stranger reads on the A2A card. Write-once until 2026-09-03; the NAME stays
    // immutable because it is part of the GAII, and a description carries no identity.
    mcp.tool(
        'aimeat_agent_description_set',
        descriptionFor('aimeat_agent_description_set'),
        zodShapeFor('aimeat_agent_description_set'),
        annotationsFor('aimeat_agent_description_set'),
        async ({ target_agent_name, description }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            const outcome = await setAgentDescription({ storage, config }, localAccountName(agentGaii), target_agent_name, description);
            if (!outcome.ok) return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii: outcome.agent.gaii, name: outcome.agent.name, description: outcome.agent.description ?? '' }, null, 2) }] };
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
        zodShapeFor('aimeat_agent_run_mode_set'),
        annotationsFor('aimeat_agent_run_mode_set'),
        async ({ target_agent_name, run_mode }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            const outcome = await setAgentRunMode({ storage, config }, localAccountName(agentGaii), target_agent_name, run_mode);
            if (!outcome.ok) return { content: [{ type: 'text' as const, text: outcome.message }], isError: true };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii: outcome.agent.gaii, name: outcome.agent.name, run_mode: outcome.agent.runMode ?? null }, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_runtime_report ──
    // What code backs the agent. Recorded, never checked — the node does not run the process.
    mcp.tool(
        'aimeat_agent_runtime_report',
        descriptionFor('aimeat_agent_runtime_report'),
        zodShapeFor('aimeat_agent_runtime_report'),
        annotationsFor('aimeat_agent_runtime_report'),
        async ({ target_agent_name, ...src }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            // Its own report needs no agent:write; a sibling's does (auth/self-or-scope.ts, the same rule
            // as PATCH /v1/agents/:name/runtime-source). Scope-exempt, so the sibling check is here.
            const self = agentGaiiFromIdentifier(target_agent_name, localAccountName(agentGaii), config.nodeId) === agentGaii;
            if (!self && !scopeIsCovered(sessionScopes, 'agent:write')) {
                return toolError('SCOPE_DENIED', 'Scope "agent:write" required to report another agent\'s runtime. An agent may report its own without it.');
            }
            const outcome = await setAgentRuntimeSource({ storage, config }, localAccountName(agentGaii), target_agent_name, src);
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
        zodShapeFor('aimeat_agent_mode_set'),
        annotationsFor('aimeat_agent_mode_set'),
        async ({ target_agent_name, mode }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentMode({ storage, config }, localAccountName(agentGaii), target_agent_name, mode);
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
        zodShapeFor('aimeat_agent_basics_get'),
        annotationsFor('aimeat_agent_basics_get'),
        async () => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            // Same function the HTTP route calls, so the two surfaces cannot answer differently.
            const view = await describeBasicAgents(config, storage, localAccountName(agentGaii));
            return { content: [{ type: 'text' as const, text: JSON.stringify(view, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_basics_request ──
    // The other half of the chat path, and it still creates nothing: it puts one line on the
    // owner's open-items list, and that line retires itself once they press.
    mcp.tool(
        'aimeat_agent_basics_request',
        descriptionFor('aimeat_agent_basics_request'),
        zodShapeFor('aimeat_agent_basics_request'),
        annotationsFor('aimeat_agent_basics_request'),
        async ({ note }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            const out = await requestBasicAgents(config, storage, localAccountName(agentGaii), agentGaii, note);
            if (!out.ok) return { content: [{ type: 'text' as const, text: out.message }], isError: true };
            const data: Record<string, unknown> = { ...out };
            delete data.ok;
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        },
    );

    // ── Tool: aimeat_agent_propose ──
    // The chat road to a NEW agent, and it creates nothing either. The approve door is
    // requireOwnerPrincipal(); this writes a proposal and one line on the owner's open items. The
    // tool's own description told agents to call this from 2026-09-02, and it did not exist until
    // 2026-09-08, so every agent that followed the advice got an unknown-tool error.
    mcp.tool(
        'aimeat_agent_propose',
        descriptionFor('aimeat_agent_propose'),
        zodShapeFor('aimeat_agent_propose'),
        annotationsFor('aimeat_agent_propose'),
        async (input) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            // The SCOPES AND ROLES OF THIS TOKEN, not the agent record's defaults: the ceiling this
            // service applies is "no more than the caller holds", and the caller is this session.
            const out = await proposeAgent({ config, storage }, {
                sub: agentGaii,
                owner: localAccountName(agentGaii),
                roles: ['agent'],
                scopes: sessionScopes,
            }, input as Parameters<typeof proposeAgent>[2]);
            if (!out.ok) return { content: [{ type: 'text' as const, text: out.message }], isError: true };
            const approvalUrl = proposalApprovalUrl(config.baseUrl);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        proposal: out.proposal,
                        created: false,
                        already_waiting: out.alreadyWaiting ?? false,
                        approval_url: approvalUrl,
                        next_step: proposalNextStep(out.proposal.display_name, approvalUrl, out.alreadyWaiting ?? false),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool: aimeat_agent_console_set ──
    // Where a same-owner agent is managed by whatever hosts it. The caller for this is normally the
    // sibling that just created the agent somewhere the node cannot see, reporting the address back
    // so the owner's profile can link to it.
    mcp.tool(
        'aimeat_agent_console_set',
        descriptionFor('aimeat_agent_console_set'),
        zodShapeFor('aimeat_agent_console_set'),
        annotationsFor('aimeat_agent_console_set'),
        async ({ target_agent_name, console_url }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }

            const outcome = await setAgentConsoleUrl({ storage, config }, localAccountName(agentGaii), target_agent_name, console_url);
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
