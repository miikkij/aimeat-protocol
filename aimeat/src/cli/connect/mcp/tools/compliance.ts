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
    part: z.enum(['draft', 'usecases', 'questionnaire']).describe('Which document to read. Start with "draft".'),
    since_days: z.number().int().min(1).max(3650).optional()
      .describe('For "draft": how far back to look for activity (default 30).'),
  }, annotationsFor('aimeat_compliance_register_read'), async ({ agent_name, part, since_days }) => {
    const { client } = pickAgent(registry, agent_name);
    const qs = part === 'draft' && since_days !== undefined ? `?since_days=${since_days}` : '';
    return text(await client.get(`/v1/admin/compliance/${part}${qs}`));
  });

  mcp.tool('aimeat_compliance_register_write', descriptionFor('aimeat_compliance_register_write'), {
    agent_name: agentNameSchema,
    part: z.enum(['usecases', 'questionnaire']).describe('Which document to replace.'),
    value: z.record(z.string(), z.unknown()).describe('The whole document — this replaces, it does not merge.'),
    dry_run: z.boolean().optional().describe('Validate and return what would be stored, storing nothing.'),
  }, annotationsFor('aimeat_compliance_register_write'), async ({ agent_name, part, value, dry_run }) => {
    const { client } = pickAgent(registry, agent_name);
    // The preview is a query flag on the same route, so one handler validates both paths and a dry
    // run cannot come to disagree with the write it is previewing.
    return text(await client.put(`/v1/admin/compliance/${part}${dry_run ? '?dry_run=true' : ''}`, value));
  });

  mcp.tool('aimeat_compliance_snapshot', descriptionFor('aimeat_compliance_snapshot'), {
    agent_name: agentNameSchema,
    action: z.enum(['list', 'read', 'save']).describe('What to do. Start with "list".'),
    id: z.string().optional().describe('For "read": which stored report, e.g. 2026-08 or 2026-08-23-1930.'),
    since_days: z.number().int().min(1).max(3650).optional()
      .describe('For "save": the window the snapshot covers (default 30).'),
  }, annotationsFor('aimeat_compliance_snapshot'), async ({ agent_name, action, id, since_days }) => {
    const { client } = pickAgent(registry, agent_name);
    if (action === 'save') {
      return text(await client.post('/v1/admin/compliance/snapshot',
        since_days === undefined ? {} : { since_days }));
    }
    // The id is sent as a query value rather than interpolated into the path: it is caller text,
    // and the route is the one place that decides which id shapes exist. Sent whenever it is given
    // rather than only when action says "read", because the route branches on its presence and a
    // second opinion here could only ever drop a value the caller meant.
    const qs = id ? `?id=${encodeURIComponent(id)}` : '';
    return text(await client.get(`/v1/admin/compliance/reports${qs}`));
  });
}
