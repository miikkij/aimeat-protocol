/**
 * @file install-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for aimeat_admin_install_set, so `aimeat connect serve`
 *   covers it locally as well as the node's own MCP surface (install packages, phase 4).
 *
 *   A THIN PROXY OVER THE REST ENDPOINTS, like the compliance tools: the node checks who the caller
 *   is (requireOperatorPrincipal with operator:admin), and the connector adds the tool, not a policy.
 * @structure registerInstallSetTools(mcp, registry)
 * @usage registered from cli/connect/mcp/tools/index.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, payloadResult, pickAgent } from './_registry.js';
import type { ApiResponse } from '../../api-client.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

const text = (resp: ApiResponse) => payloadResult(resp, resp);

export function registerInstallSetTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_admin_install_set', descriptionFor('aimeat_admin_install_set'), {
    agent_name: agentNameSchema,
    action: z.enum(['plan', 'apply', 'list']).describe('plan: what the set would make, and every problem, writing nothing. apply: make it. list: the sets applied on this node.'),
    install_set: z.record(z.string(), z.unknown()).optional().describe('For plan and apply: the install set, a JSON object with spec "aimeat.install-set/1".'),
    secrets: z.record(z.string(), z.unknown()).optional().describe('For plan and apply: secret config values, { <package group id>: { <component id>: { <field>: value } } }. Never stored in the record.'),
  }, annotationsFor('aimeat_admin_install_set'), async ({ agent_name, action, install_set, secrets }) => {
    const { client } = pickAgent(registry, agent_name);
    if (action === 'list') return text(await client.get('/v1/install-sets'));
    return text(await client.post('/v1/install-sets/apply', {
      install_set, dry_run: action === 'plan', ...(secrets !== undefined ? { secrets } : {}),
    }));
  });
}
