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
 *   v1.1.0 — 2026-09-29 — aimeat_package_sale (GET, PUT, DELETE /v1/package-sales/...).
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

  mcp.tool('aimeat_package_sale', descriptionFor('aimeat_package_sale'), {
    agent_name: agentNameSchema,
    action: z.enum(['needs', 'grant', 'revoke']).describe('needs: the questions to ask; grant: serve (or change, or end the updates of) a customer node; revoke: stop serving it.'),
    repository: z.string().describe('The package repository\'s node id.'),
    repository_link: z.object({ url: z.string(), public_key: z.string() }).optional().describe('The first time only: { url, public_key } of the repository, to link it as a peer of this node.'),
    group_id: z.string().describe('The package or install bundle group id on the repository.'),
    node_id: z.string().optional().describe('For grant and revoke: the customer node.'),
    node: z.object({ url: z.string(), public_key: z.string() }).optional().describe('For grant: { url, public_key } of a customer node the repository does not know yet.'),
    updates_until: z.string().optional().describe('For grant: versions published after this ISO date-time are not served.'),
    channel: z.enum(['stable', 'beta']).optional().describe('For grant: stable (the default) or beta.'),
    note: z.string().optional().describe('For grant: the order it came from.'),
  }, annotationsFor('aimeat_package_sale'), async ({ agent_name, action, repository, repository_link, group_id, node_id, node, updates_until, channel, note }) => {
    const { client } = pickAgent(registry, agent_name);
    const qs = (extra: Record<string, string>) => new URLSearchParams({ repository, group_id, ...extra }).toString();
    if (action === 'needs') return text(await client.get(`/v1/package-sales/config-needs?${qs({})}`));
    if (action === 'revoke') return text(await client.delete(`/v1/package-sales/entitlements?${qs({ node_id: node_id ?? '' })}`));
    const body: Record<string, unknown> = { repository: repository_link ? { node_id: repository, ...repository_link } : repository, group_id, node_id };
    if (node !== undefined) body.node = node;
    if (updates_until !== undefined) body.updates_until = updates_until;
    if (channel !== undefined) body.channel = channel;
    if (note !== undefined) body.note = note;
    return text(await client.put('/v1/package-sales/entitlements', body));
  });
}
