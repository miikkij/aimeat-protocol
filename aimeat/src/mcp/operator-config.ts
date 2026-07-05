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
 *   v1.0.0 -- 2026-07-05 -- Initial: agent-configure with propose-then-confirm.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../services/operator-confirm.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';

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
            const targetGaii = `${agent_name}#${callerOwner}@${config.nodeId}`;
            const agent = await storage.getAgent(targetGaii);
            if (!agent) return err(`No agent "${agent_name}" under owner ${callerOwner}`);

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
            if (proposed.scopes) {
                const granted = new Set((agent as { defaultScopes?: string[] }).defaultScopes ?? []);
                const added = proposed.scopes.filter(s => !granted.has(s));
                if (added.length > 0 && !granted.has('*')) {
                    return err(`Scope additions are not allowed through this tool (requested new: ${added.join(', ')}). Adding scopes is an owner approval in the profile UI; this tool can only narrow.`);
                }
            }

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

            const updates: Partial<AgentRecord> = {};
            if (proposed.display_name !== undefined) updates.displayName = proposed.display_name;
            if (proposed.description !== undefined) updates.description = proposed.description;
            if (proposed.mode !== undefined) (updates as { mode?: string }).mode = proposed.mode;
            if (proposed.tags !== undefined) updates.tags = proposed.tags;
            if (proposed.scopes !== undefined) (updates as { defaultScopes?: string[] }).defaultScopes = proposed.scopes;

            const updated = await storage.updateAgent(targetGaii, updates);
            if (!updated) return err('Update failed — agent disappeared mid-flight');
            logger.info(`Operator-configure applied to ${targetGaii}`, { by: agentGaii, fields: Object.keys(diff) });
            emitChange('agents', `${callerOwner}@${config.nodeId}`);
            return ok({ mode: 'applied', agent: agent_name, applied: diff, current: currentView(updated) });
        },
    );
}
