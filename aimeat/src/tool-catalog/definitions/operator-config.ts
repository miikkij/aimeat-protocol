/**
 * @file operator-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog metadata for the operator propose-then-confirm tools (mcp/operator-config.ts):
 *   aimeat_operator_agent_configure and aimeat_operator_ai_config. Moved unchanged out of
 *   ./capabilities-groups-skills.ts (max-file-lines); re-assembled right after it in definitions.ts,
 *   so the catalog order is the same.
 * @structure operatorConfigTools — the two definitions
 * @usage imported by catalog/definitions.ts into CLI_FALLBACK_TOOL_DEFINITIONS
 * @version-history
 *   2026-10-29 — aimeat_operator_agent_configure says when it adds scopes: agent:permissions-add, from the
 *     caller's own (wish-omistajan-ai-voi-lis-t-agenttien-oikeuksia-kun-omistaja-niin).
 *   2026-10-29 — Moved unchanged out of ./capabilities-groups-skills.ts (max-file-lines).
 */
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';

export const operatorConfigTools = [
    {
        name: 'aimeat_operator_agent_configure',
        description: 'Configure a same-owner agent with PROPOSE-THEN-CONFIRM. Without confirm_token nothing is applied: the tool returns the current state, the proposed state, a field-level diff, and a single-use confirm_token (10 min TTL) bound to exactly this change — show the diff to the owner. Calling again with the same arguments plus the token applies it; changing anything invalidates the token. Configurable: display_name, description, mode, tags, scopes, clearance. Scope changes narrow the granted set; they add a permission only when you hold agent:permissions-add (the owner gives it on your page, signed in themselves), and then only permissions you hold yourself, never agent:permissions-add and never to yourself. The owner is told of every addition on their account feed and in the bell. clearance (the highest classification the agent may read) may only be LOWERED here; raising or removing it is the owner\'s, in person, and no agent changes its own. (Connector/CLI apply directly through the per-field routes, which ask the same words and the same rule for adding scopes; display_name/description are shell-unsupported.)',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Configure Agent (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Rewriting an agent's PERMISSIONS is its own word, and no wildcard carries it. PATCH
        // /v1/agents/:name/scopes asks an agent the same two words and lets it narrow, and add only
        // with agent:permissions-add on top (QA audit D2-02; services/agent-scope-add.ts, asked in the
        // handler), and the propose-then-confirm dance here binds the
        // token to the CALLER — so the same agent mints and redeems it in two consecutive calls, and
        // the "show this diff to the owner" text is instruction rather than a gate.
        // The words PATCH /v1/agents/:name/mode asks (secaudit 2026-10 follow-up, A4).
        scope: ['agent:permissions', 'agent:write'],
        surfaces: ['agent', 'admin'],
        input: {
            agent_name: { type: 'string', required: true, description: 'Which same-owner agent to configure.' },
            display_name: { type: 'string', description: 'New display name.' },
            description: { type: 'string', description: 'New description.' },
            mode: { type: 'string', enum: ['interactive', 'autonomous', 'task-runner', 'coordinator', 'workstation'], description: 'New agent mode.' },
            tags: { type: 'array', description: 'Replacement tag list.', zod: z.array(z.string().max(INPUT_LIMITS.name)) },
            scopes: { type: 'array', description: 'Replacement scope list. Narrowing always; adding only with agent:permissions-add, from the permissions you hold yourself.', zod: z.array(z.string().max(INPUT_LIMITS.id)) },
            clearance: { type: 'string', description: 'The highest classification the agent may read, as the classification\'s id (for example sisainen); content classified higher is hidden from it while classification is on. Lowering only: you can set a lower one, or one where there was none. Raising it or null (no limit) is the owner\'s decision on the agent\'s page, and you cannot change your own.', zod: z.string().max(40).nullable() },
            confirm_token: { type: 'string', description: 'On the node\'s own MCP: the token from the propose step; omit it to propose and see the change first. The shell and the connector apply directly, because the REST routes take no token.' },
        },
    },
    {
        name: 'aimeat_operator_ai_config',
        description: 'Inspect or change the owner\'s AI routing + daily budget with PROPOSE-THEN-CONFIRM. With no fields: returns the current safe view (daily_budget_usd, model, reasoning_model, execution_model). With fields but no confirm_token: applies NOTHING — returns current/proposed/diff + a single-use token (10 min) bound to exactly this change; show the diff to the owner. With the token: applies. The API key is stored separately and can NEVER be read or changed through this tool. (Connector/CLI apply the daily budget directly through POST /v1/ai/settings, which asks an agent the same words (memory:write-reserved and memory:write-as-owner); model routing is shell-unsupported.)',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Configure AI Routing & Budget (Propose-then-Confirm)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Writes keys the server itself trusts (openrouter.*, ai-usage.*, profile.*).
        scope: 'memory:write-reserved',
        surfaces: ['agent', 'admin'],
        input: {
            daily_budget_usd: { type: 'number', description: 'Daily AI spend cap in USD (0-1000).', zod: z.number().min(0).max(1000) },
            model: { type: 'string', description: 'Default model id.' },
            reasoning_model: { type: 'string', description: 'Model for modelRole "reasoning".' },
            execution_model: { type: 'string', description: 'Model for modelRole "execution".' },
            confirm_token: { type: 'string', description: 'On the node\'s own MCP: the token from the propose step; omit it to propose and see the change first. The shell and the connector apply directly, because the REST routes take no token.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
