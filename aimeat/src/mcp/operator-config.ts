/**
 * @file operator-config.ts
 * @description Operator config-enactment MCP tools (Claude-as-operator, Phase 3).
 *   Every WRITE follows PROPOSE-THEN-CONFIRM: called without confirm_token the tool
 *   applies nothing — it returns { current, proposed, diff, confirm_token } for the
 *   human to review; called again with the token (bound to the exact proposed payload,
 *   single-use, 10 min TTL) it applies. Server MCP surface only (not the connector CLI).
 *
 *   Tool: aimeat_operator_agent_configure — update a SAME-OWNER agent's display_name /
 *   description / mode / tags / scopes. Scope changes may only NARROW the granted set
 *   (drop scopes); adding scopes stays an owner-approval action in the profile UI, so
 *   an agent can never talk itself into more privilege through this tool.
 * @structure registerOperatorConfigTools() — registers the tools on an McpServer
 * @usage
 *   import { registerOperatorConfigTools } from './operator-config.js';
 * @version-history
 *   v1.3.0 -- 2026-08-11 -- aimeat_operator_agent_configure writes through
 *     services/agent-profile-write.ts, which the two REST doors for these fields already call.
 *     Three things the shared writer does and this tool did not. Tags were stored verbatim, so
 *     "Ops Team!" landed here and was refused by PATCH /v1/agents/:name/tags and by
 *     aimeat_agent_tags_set, with no cap on how many; they are now trimmed, lowercased,
 *     de-duplicated and capped at 20, and a malformed one refuses the call. A mode change did not
 *     re-derive the Hello Integration step list, so an agent moved to task-runner kept the long
 *     flow and read 7/16 where the truth was 7/7. And an empty scope list was accepted, which left
 *     an agent holding nothing and its whole tool surface filtered away; PATCH
 *     /v1/agents/:name/scopes has always refused that. The field rules now run at PROPOSE time too,
 *     so the diff the owner reads is the value that will be stored, and the SSE wake is the global
 *     'agents' broadcast both REST doors emit rather than an owner-scoped one an operator view
 *     never saw.
 *   v1.2.0 -- 2026-08-11 -- aimeat_operator_ai_config writes through services/memory-write.ts and
 *     resolves its target through routes/memory/owner-target.ts, which is where the reserved-key
 *     guard lives. It wrote `openrouter.settings` straight to storage before, so the one key class
 *     the server itself reads and trusts was reachable here without the memory:write-reserved grant
 *     that /v1/memory demands for it, and without the record's ceilings, archive guard, provenance
 *     stamp or any of the fan-out a memory write sets off. aimeat_operator_agent_configure still
 *     calls storage.updateAgent directly: that is an agent-record write, and its shared home is
 *     services/agent-profile-write.ts.
 *   v1.0.0 -- 2026-07-05 -- Initial: agent-configure with propose-then-confirm.
 *   v1.1.0 -- 2026-08-08 -- The narrow-only guard no longer exempts a target that holds '*'. It did,
 *     because an agent with everything could not gain anything -- true until memory:write-reserved
 *     became the one scope '*' deliberately does not carry, at which point a '*' agent could propose
 *     it for itself and confirm it in the next call (the confirm token binds to the caller, so the
 *     "show the owner" step is instruction text). Coverage now comes from utils/scope-coverage.ts.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../services/operator-confirm.js';
import { logger } from '../utils/logger.js';
import { uncoveredScopes } from '../utils/scope-coverage.js';
import { resolveMcpWriteTarget } from '../routes/memory/owner-target.js';
import { writeMemoryRecord } from '../services/memory-write.js';
import {
    normaliseAgentProfile, resolveAgentTarget, setAgentProfile,
    type AgentProfileFields,
} from '../services/agent-profile-write.js';

const CONFIGURE_ACTION = 'agent_configure';

interface AgentConfigChange {
    display_name?: string;
    description?: string;
    mode?: string;
    tags?: string[];
    scopes?: string[];
}

function currentView(agent: AgentRecord): AgentConfigChange {
    return {
        display_name: agent.displayName,
        description: agent.description,
        mode: (agent as { mode?: string }).mode ?? 'interactive',
        tags: agent.tags ?? [],
        scopes: (agent as { defaultScopes?: string[] }).defaultScopes ?? [],
    };
}

/** The tool's snake_case payload in the field names services/agent-profile-write.ts writes. */
function profileFieldsOf(change: AgentConfigChange): AgentProfileFields {
    return {
        ...(change.display_name !== undefined ? { displayName: change.display_name } : {}),
        ...(change.description !== undefined ? { description: change.description } : {}),
        ...(change.mode !== undefined ? { mode: change.mode } : {}),
        ...(change.tags !== undefined ? { tags: change.tags } : {}),
        ...(change.scopes !== undefined ? { defaultScopes: change.scopes } : {}),
    };
}

function diffOf(current: AgentConfigChange, proposed: AgentConfigChange): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(proposed) as Array<keyof AgentConfigChange>) {
        if (proposed[key] === undefined) continue;
        if (JSON.stringify(current[key]) !== JSON.stringify(proposed[key])) {
            diff[key] = { from: current[key], to: proposed[key] };
        }
    }
    return diff;
}

export function registerOperatorConfigTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's own scopes, for the write-as-owner requirement on the AI settings tool. */
    sessionScopes: string[] = [],
): void {
    const agentGaii = getAgentGaii();
    const callerOwner = parseGAII(agentGaii)?.owner ?? null;

    const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
    const ok = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

    mcp.tool(
        'aimeat_operator_agent_configure',
        descriptionFor('aimeat_operator_agent_configure'),
        {
            agent_name: z.string().describe('Which same-owner agent to configure.'),
            display_name: z.string().optional().describe('New display name.'),
            description: z.string().optional().describe('New description.'),
            mode: z.enum(['interactive', 'autonomous', 'task-runner', 'coordinator', 'workstation']).optional().describe('New agent mode.'),
            tags: z.array(z.string()).optional().describe('Replacement tag list.'),
            scopes: z.array(z.string()).optional().describe('Replacement scope list — may only NARROW the currently granted set (adding scopes stays an owner-UI approval).'),
            confirm_token: z.string().optional().describe('Token from the propose step. Omit to get a proposal + diff without applying anything.'),
        },
        annotationsFor('aimeat_operator_agent_configure'),
        async ({ agent_name, display_name, description, mode, tags, scopes, confirm_token }) => {
            if (!callerOwner) return err('Could not resolve the calling agent\'s owner');
            // One target resolution, the writer's: a bare name becomes a GAII under the CALLER's
            // own owner, and anything already GAII-shaped has to survive the ownership check below
            // before it is read or written. Both doors resolve a name the same way now.
            const targetGaii = resolveAgentTarget(config, callerOwner, agent_name);
            const agent = await storage.getAgent(targetGaii);
            if (!agent || agent.owner !== callerOwner) return err(`No agent "${agent_name}" under owner ${callerOwner}`);

            const proposed: AgentConfigChange = {};
            if (display_name !== undefined) proposed.display_name = display_name;
            if (description !== undefined) proposed.description = description;
            if (mode !== undefined) proposed.mode = mode;
            if (tags !== undefined) proposed.tags = tags;
            if (scopes !== undefined) proposed.scopes = scopes;
            if (Object.keys(proposed).length === 0) {
                return ok({ agent: agent_name, current: currentView(agent), diff: {}, note: 'Nothing proposed — pass the fields to change.' });
            }

            // Privilege guard: scope changes may only narrow. Applies at propose time too,
            // so a widening proposal is rejected before it can even be shown as approvable.
            //
            // This used to skip itself entirely when the target held '*' — `added.length > 0 &&
            // !granted.has('*')` — on the reasoning that an agent with everything cannot gain
            // anything. That held until exactly one scope stopped being covered by '*'. An agent
            // could then propose ['*','memory:write-reserved'] for ITSELF and confirm it in the
            // next call, because the confirm token binds to the caller: the "show this diff to the
            // owner" step below is instruction text, not a gate. The end of that path is writing
            // openrouter.settings into the owner's namespace.
            //
            // So: no escape hatch, and coverage is decided by utils/scope-coverage.ts rather than
            // by testing for '*' here. Anything the target does not already effectively hold is an
            // addition, whatever its current scopes look like.
            if (proposed.scopes) {
                const granted = (agent as { defaultScopes?: string[] }).defaultScopes ?? [];
                const added = uncoveredScopes(granted, proposed.scopes);
                if (added.length > 0) {
                    return err(`Scope additions are not allowed through this tool (requested new: ${added.join(', ')}). Adding scopes is an owner approval in the profile UI; this tool can only narrow.`);
                }
            }

            // The field vocabulary is services/agent-profile-write.ts, and it runs HERE as well as
            // on the write, so a malformed tag or an empty scope list is refused before a token is
            // minted and the diff the owner reads is the value that will be stored. Tags come back
            // trimmed, lowercased and de-duplicated; the token binds to that form, and it has to,
            // because that is what the confirm call will write.
            const normalised = normaliseAgentProfile(config, profileFieldsOf(proposed));
            if (!normalised.ok) return err(`${normalised.code}: ${normalised.message}`);
            if (normalised.updates.tags !== undefined) proposed.tags = normalised.updates.tags;

            const current = currentView(agent);
            const diff = diffOf(current, proposed);
            if (Object.keys(diff).length === 0) {
                return ok({ agent: agent_name, current, diff, note: 'Proposed values equal current state — nothing to apply.' });
            }

            // PROPOSE: no token -> return the plan + a token bound to this exact payload.
            if (!confirm_token) {
                const token = await mintConfirmToken(agentGaii, CONFIGURE_ACTION, { targetGaii, proposed });
                return ok({
                    mode: 'proposal',
                    agent: agent_name,
                    current,
                    proposed,
                    diff,
                    confirm_token: token,
                    expires_in_seconds: 600,
                    instructions: 'Show this diff to the owner. To apply EXACTLY this change, call the tool again with the same arguments plus confirm_token. Any change to the arguments invalidates the token.',
                });
            }

            // CONFIRM: verify the token binds to this exact payload, then apply.
            try {
                await verifyConfirmToken(confirm_token, agentGaii, CONFIGURE_ACTION, { targetGaii, proposed });
            } catch (e) {
                if (e instanceof ConfirmTokenError) return err(`${e.code}: ${e.message}`);
                throw e;
            }

            // ONE implementation. services/agent-profile-write.ts owns the same-owner check, the
            // field rules and the Hello Integration step-list re-derive a mode change owes, the same
            // way PATCH /v1/agents/:name/tags and /mode do. This door used to write the record
            // itself, so a tag nobody else would accept got stored and a mode change left the
            // onboarding flow counting against the wrong denominator.
            const outcome = await setAgentProfile({ storage, config }, callerOwner, agent_name, profileFieldsOf(proposed));
            if (!outcome.ok) return err(`${outcome.code}: ${outcome.message}`);
            logger.info(`Operator-configure applied to ${targetGaii}`, { by: agentGaii, fields: Object.keys(diff) });
            return ok({ mode: 'applied', agent: agent_name, applied: diff, current: currentView(outcome.agent) });
        },
    );

    // ── aimeat_operator_ai_config — the owner's AI routing + budget (NEVER the API key) ──
    // Safe subset of the `openrouter.settings` record: daily budget and model routing.
    // The encrypted key lives in a SEPARATE record (openrouter.apikey) this tool cannot touch.
    const AI_CONFIG_ACTION = 'ai_config';
    const AI_SETTINGS_KEY = 'openrouter.settings';

    interface AiConfigChange {
        daily_budget_usd?: number;
        model?: string;
        reasoning_model?: string;
        execution_model?: string;
    }

    mcp.tool(
        'aimeat_operator_ai_config',
        descriptionFor('aimeat_operator_ai_config'),
        {
            daily_budget_usd: z.number().min(0).max(1000).optional().describe('Daily AI spend cap in USD (0-1000).'),
            model: z.string().optional().describe('Default model id.'),
            reasoning_model: z.string().optional().describe('Model routed for modelRole "reasoning".'),
            execution_model: z.string().optional().describe('Model routed for modelRole "execution".'),
            confirm_token: z.string().optional().describe('Token from the propose step. Omit to get a proposal + diff without applying anything.'),
        },
        annotationsFor('aimeat_operator_ai_config'),
        async ({ daily_budget_usd, model, reasoning_model, execution_model, confirm_token }) => {
            if (!callerOwner) return err('Could not resolve the calling agent\'s owner');
            // This tool writes into the OWNER's namespace, and the platform decides that move in one
            // place: routes/memory/owner-target.ts. It answers two questions this door used to
            // answer for itself, or not at all. memory:write-as-owner was checked here by hand. The
            // reserved-key guard was not checked anywhere: `openrouter.settings` is one of the keys
            // the server itself reads and trusts (the URL a decrypted AI key is sent to lives in
            // it), so writing it on the owner's behalf costs the separate memory:write-reserved
            // grant that sits outside every wildcard — the same refusal /v1/memory has always given.
            const target = resolveMcpWriteTarget({
                agentGaii, ownerName: callerOwner, nodeId: config.nodeId,
                scopes: sessionScopes, key: AI_SETTINGS_KEY, ownerScope: true,
            });
            if ('deny' in target) return err(`${target.deny.error}: ${target.deny.message} ${target.deny.how_to_fix}`);
            const ownerGhii = target.gaii;
            const record = await storage.getMemory(ownerGhii, AI_SETTINGS_KEY);
            const settings = (record?.value ?? {}) as Record<string, unknown>;

            const proposed: AiConfigChange = {};
            if (daily_budget_usd !== undefined) proposed.daily_budget_usd = daily_budget_usd;
            if (model !== undefined) proposed.model = model;
            if (reasoning_model !== undefined) proposed.reasoning_model = reasoning_model;
            if (execution_model !== undefined) proposed.execution_model = execution_model;
            if (Object.keys(proposed).length === 0) {
                return ok({
                    current: {
                        daily_budget_usd: settings.daily_budget_usd ?? 1.0,
                        model: settings.model ?? null,
                        reasoning_model: settings.reasoningModel ?? null,
                        execution_model: settings.executionModel ?? null,
                    },
                    note: 'Nothing proposed — pass the fields to change.',
                });
            }

            const current: AiConfigChange = {
                daily_budget_usd: typeof settings.daily_budget_usd === 'number' ? settings.daily_budget_usd : 1.0,
                model: settings.model as string | undefined,
                reasoning_model: settings.reasoningModel as string | undefined,
                execution_model: settings.executionModel as string | undefined,
            };
            const diff: Record<string, { from: unknown; to: unknown }> = {};
            for (const key of Object.keys(proposed) as Array<keyof AiConfigChange>) {
                if (JSON.stringify(current[key] ?? null) !== JSON.stringify(proposed[key] ?? null)) {
                    diff[key] = { from: current[key] ?? null, to: proposed[key] };
                }
            }
            if (Object.keys(diff).length === 0) {
                return ok({ current, diff, note: 'Proposed values equal current state — nothing to apply.' });
            }

            if (!confirm_token) {
                const token = await mintConfirmToken(agentGaii, AI_CONFIG_ACTION, proposed);
                return ok({
                    mode: 'proposal',
                    current,
                    proposed,
                    diff,
                    confirm_token: token,
                    expires_in_seconds: 600,
                    instructions: 'Show this diff to the owner. To apply EXACTLY this change, call again with the same arguments plus confirm_token.',
                });
            }

            try {
                await verifyConfirmToken(confirm_token, agentGaii, AI_CONFIG_ACTION, proposed);
            } catch (e) {
                if (e instanceof ConfirmTokenError) return err(`${e.code}: ${e.message}`);
                throw e;
            }

            const merged: Record<string, unknown> = { ...settings };
            if (proposed.daily_budget_usd !== undefined) merged.daily_budget_usd = proposed.daily_budget_usd;
            if (proposed.model !== undefined) merged.model = proposed.model;
            if (proposed.reasoning_model !== undefined) merged.reasoningModel = proposed.reasoning_model;
            if (proposed.execution_model !== undefined) merged.executionModel = proposed.execution_model;
            // ONE implementation. services/memory-write.ts owns the record shape, the ceilings, the
            // archive guard, the provenance stamp and everything a write sets off, the same way
            // POST /v1/memory does — this door used to reach storage itself, so a change to the
            // owner's AI settings landed with none of it and nothing else on the node heard about it.
            const written = await writeMemoryRecord({ storage, config }, {
                principal: agentGaii, targetGaii: ownerGhii, scopes: sessionScopes, roles: ['agent'],
            }, {
                key: AI_SETTINGS_KEY,
                value: merged,
                visibility: record?.visibility ?? 'private',
                tags: record?.tags ?? ['openrouter'],
                pipeline: 'mcp.operator_ai_config',
                ownerScoped: true,
                // The word the owner ticked for this door (mcp/catalog/scopes.ts), rather than a
                // memory:write that nobody granting an operator agent was asked about.
                authorisingScope: 'memory:write-reserved',
            });
            if (!written.ok) return err(`${written.code}: ${written.message}`);
            logger.info(`Operator ai-config applied for ${callerOwner}`, { by: agentGaii, fields: Object.keys(diff) });
            return ok({ mode: 'applied', applied: diff });
        },
    );
}
