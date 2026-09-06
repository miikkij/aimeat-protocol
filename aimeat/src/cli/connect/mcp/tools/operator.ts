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
import { agentNameSchema, pickAgent, payloadResult } from './_registry.js';
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
    // THE SAME `.data ?? 'ok'` AS BELOW, three times. A refused PATCH left the literal word "ok"
    // beside the field it had not changed, under a successful tool call — so an owner narrowing an
    // agent's scopes was told it had worked when the node had refused every one of them.
    let refused = false;
    const patch = async (field: string, path: string, body: Record<string, unknown>) => {
      const resp = await client.patch(path, body);
      if (resp.ok === false) { refused = true; applied[field] = resp.error ?? resp; return; }
      applied[field] = resp.data ?? 'ok';
    };
    const enc = encodeURIComponent(target);
    if (mode !== undefined) await patch('mode', `/v1/agents/${enc}/mode`, { mode });
    if (tags !== undefined) await patch('tags', `/v1/agents/${enc}/tags`, { tags });
    if (scopes !== undefined) await patch('scopes', `/v1/agents/${enc}/scopes`, { scopes });
    if (display_name !== undefined) unsupported.push('display_name');
    if (description !== undefined) unsupported.push('description');
    return payloadResult({
      agent: target, applied,
      ...(unsupported.length ? { unsupported, note: 'These fields have no REST route — set them via the server MCP tool or the profile UI.' } : {}),
    }, { ok: !refused });
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
    // `.data ?? 'ok'` was the whole record of what the node said, so a refusal became the literal
    // word "ok" under a successful tool call — the budget unchanged, and nothing anywhere saying so.
    let refused = false;
    if (daily_budget_usd !== undefined) {
      const resp = await client.post('/v1/ai/settings', { daily_budget_usd });
      refused = resp.ok === false;
      applied.ai_settings = refused ? (resp.error ?? resp) : (resp.data ?? 'ok');
    }
    for (const [k, v] of Object.entries({ model, reasoning_model, execution_model })) if (v !== undefined) unsupported.push(k);
    return payloadResult({
      applied,
      ...(unsupported.length ? { unsupported, note: 'Model routing has no REST route — set it via the profile UI or the server MCP tool.' } : {}),
    }, { ok: !refused });
  });
}
