/**
 * @file compliance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the operator's compliance tools, so
 *   `aimeat connect serve` covers them locally as well as the node's own MCP surface.
 *
 *   THIN PROXIES OVER THE REST DOORS, deliberately. The node MCP versions call the services
 *   directly because they run inside the node; the connector runs outside it and has an HTTP client,
 *   so it calls the same routes a browser would. Both therefore land on requireOperatorPrincipal()
 *   and the same zod schemas — there is no third place where "what is a valid register" is decided.
 *
 *   THE GATE IS THE NODE'S, NOT THIS FILE'S. Nothing here checks who the caller is, on purpose: the
 *   route does, and a second opinion here could only ever be a weaker one. What the connector adds
 *   is the door, not the policy.
 * @structure registerComplianceTools(mcp, registry)
 * @usage registered from cli/connect/mcp/tools/index.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerComplianceTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_compliance_report', descriptionFor('aimeat_compliance_report'), {
    agent_name: agentNameSchema,
    scope: z.enum(['mine', 'node']).optional()
      .describe('Whose report. "mine" (the default) is your own owner\'s slice; "node" is the whole installation and is operator-only.'),
    since_days: z.number().int().min(1).max(3650).optional()
      .describe('Rolling window in days (default 30). Ignored when month is given.'),
    month: z.string().optional().describe('A whole calendar month, YYYY-MM. Wins over since_days.'),
  }, annotationsFor('aimeat_compliance_report'), async ({ agent_name, scope, since_days, month }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    else if (since_days !== undefined) params.set('since_days', String(since_days));
    const qs = params.toString() ? `?${params}` : '';
    // Two doors, because they are two reports with two gates: the owner slice needs no permission,
    // and the whole installation needs an operator account plus the exact word.
    const path = scope === 'node' ? '/v1/admin/compliance/report' : '/v1/compliance/report/mine';
    return text(await client.get(`${path}${qs}`));
  });

  mcp.tool('aimeat_compliance_register_read', descriptionFor('aimeat_compliance_register_read'), {
    agent_name: agentNameSchema,
    part: z.enum(['usecases', 'questionnaire']).describe('Which document to read.'),
  }, annotationsFor('aimeat_compliance_register_read'), async ({ agent_name, part }) => {
    const { client } = pickAgent(registry, agent_name);
    return text(await client.get(`/v1/admin/compliance/${part}`));
  });

  mcp.tool('aimeat_compliance_register_write', descriptionFor('aimeat_compliance_register_write'), {
    agent_name: agentNameSchema,
    part: z.enum(['usecases', 'questionnaire']).describe('Which document to replace.'),
    value: z.record(z.string(), z.unknown()).describe('The whole document — this replaces, it does not merge.'),
  }, annotationsFor('aimeat_compliance_register_write'), async ({ agent_name, part, value }) => {
    const { client } = pickAgent(registry, agent_name);
    return text(await client.put(`/v1/admin/compliance/${part}`, value));
  });
}
