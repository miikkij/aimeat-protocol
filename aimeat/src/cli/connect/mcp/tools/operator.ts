/**
 * @file operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the operator config-enactment tools
 *   (aimeat_operator_agent_configure, aimeat_operator_ai_config) so `aimeat connect serve --surface
 *   agent` covers the full agent surface locally. The SERVER MCP versions run a propose-then-confirm
 *   flow and write storage directly (there is no single dedicated REST route). The connector cannot
 *   replicate propose-then-confirm over REST, so these shell proxies APPLY DIRECTLY through the
 *   per-field REST routes that already exist (same-owner / owner authz unchanged): agent mode/tags/
 *   scopes for agent-configure, and POST /v1/ai/settings for the owner AI budget. Fields with no REST
 *   route (agent display_name/description; AI model routing) are reported as shell-unsupported — use the
 *   server MCP tool or the profile UI for those.
 * @version-history
 *   v1.0.0 -- 2026-07-19 -- Initial: connector coverage for operator_agent_configure + operator_ai_config.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerOperatorTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_operator_agent_configure', descriptionFor('aimeat_operator_agent_configure'), {
    agent_name: agentNameSchema,
    target_agent_name: z.string().optional().describe('Which same-owner agent to configure (defaults to the calling agent).'),
    display_name: z.string().optional().describe('New display name (shell-unsupported — no REST route).'),
    description: z.string().optional().describe('New description (shell-unsupported — no REST route).'),
    mode: z.enum(['interactive', 'autonomous', 'task-runner', 'coordinator', 'workstation']).optional().describe('New agent mode.'),
    tags: z.array(z.string()).optional().describe('Replacement tag list.'),
    scopes: z.array(z.string()).optional().describe('Replacement scope list (owner-only; may only narrow).'),
  }, annotationsFor('aimeat_operator_agent_configure'), async ({ agent_name, target_agent_name, display_name, description, mode, tags, scopes }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const target = target_agent_name ?? agent;
    const applied: Record<string, unknown> = {};
    const unsupported: string[] = [];
    if (mode !== undefined) applied.mode = (await client.patch(`/v1/agents/${encodeURIComponent(target)}/mode`, { mode })).data ?? 'ok';
    if (tags !== undefined) applied.tags = (await client.patch(`/v1/agents/${encodeURIComponent(target)}/tags`, { tags })).data ?? 'ok';
    if (scopes !== undefined) applied.scopes = (await client.patch(`/v1/agents/${encodeURIComponent(target)}/scopes`, { scopes })).data ?? 'ok';
    if (display_name !== undefined) unsupported.push('display_name');
    if (description !== undefined) unsupported.push('description');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agent: target, applied,
          ...(unsupported.length ? { unsupported, note: 'These fields have no REST route — set them via the server MCP tool or the profile UI.' } : {}),
        }, null, 2),
      }],
    };
  });

  mcp.tool('aimeat_operator_ai_config', descriptionFor('aimeat_operator_ai_config'), {
    agent_name: agentNameSchema,
    daily_budget_usd: z.number().min(0).max(1000).optional().describe('Daily AI spend cap in USD (0-1000).'),
    model: z.string().optional().describe('Default model id (shell-unsupported — set via the profile UI).'),
    reasoning_model: z.string().optional().describe('Reasoning-role model (shell-unsupported — set via the profile UI).'),
    execution_model: z.string().optional().describe('Execution-role model (shell-unsupported — set via the profile UI).'),
  }, annotationsFor('aimeat_operator_ai_config'), async ({ agent_name, daily_budget_usd, model, reasoning_model, execution_model }) => {
    const { client } = pickAgent(registry, agent_name);
    const applied: Record<string, unknown> = {};
    const unsupported: string[] = [];
    if (daily_budget_usd !== undefined) applied.ai_settings = (await client.post('/v1/ai/settings', { daily_budget_usd })).data ?? 'ok';
    for (const [k, v] of Object.entries({ model, reasoning_model, execution_model })) if (v !== undefined) unsupported.push(k);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          applied,
          ...(unsupported.length ? { unsupported, note: 'Model routing has no REST route — set it via the profile UI or the server MCP tool.' } : {}),
        }, null, 2),
      }],
    };
  });
}
