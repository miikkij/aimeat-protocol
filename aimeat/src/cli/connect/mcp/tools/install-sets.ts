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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-10-02 — aimeat_package_sale action review (POST /v1/package-sales/catalogue/review).
 *   v1.2.0 — 2026-10-02 — aimeat_package_sale gains offer, claim, catalogue, price, requests and decide;
 *     aimeat_package_claim over POST /v1/package-claims (package sale design, phase 3).
 *   v1.1.0 — 2026-09-29 — aimeat_package_sale (GET, PUT, DELETE /v1/package-sales/...).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, payloadResult, pickAgent } from './_registry.js';
import type { ApiResponse } from '../../api-client.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

const text = (resp: ApiResponse) => payloadResult(resp, resp);

export function registerInstallSetTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_admin_install_set', descriptionFor('aimeat_admin_install_set'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_admin_install_set') }, annotationsFor('aimeat_admin_install_set'), async ({ agent_name, action, install_set, secrets }) => {
    const { client } = pickAgent(registry, agent_name);
    if (action === 'list') return text(await client.get('/v1/install-sets'));
    return text(await client.post('/v1/install-sets/apply', {
      install_set, dry_run: action === 'plan', ...(secrets !== undefined ? { secrets } : {}),
    }));
  });

  mcp.tool('aimeat_package_sale', descriptionFor('aimeat_package_sale'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_package_sale') }, annotationsFor('aimeat_package_sale'), async (input) => {
    const { client } = pickAgent(registry, input.agent_name);
    const { action } = input;
    if (action === 'catalogue') return text(await client.get('/v1/package-sales/catalogue'));
    if (action === 'requests') return text(await client.get('/v1/package-sales/requests'));
    if (action === 'decide') {
      return text(await client.post(`/v1/package-sales/requests/${encodeURIComponent(input.request_id ?? '')}/decision`, { decision: input.decision }));
    }
    if (action === 'review') {
      return text(await client.post('/v1/package-sales/catalogue/review', { repository: input.repository, group_id: input.group_id }));
    }
    if (action === 'price') {
      const body: Record<string, unknown> = { repository: input.repository, group_id: input.group_id };
      for (const key of ['price', 'renewal', 'title', 'state'] as const) if (input[key] !== undefined) body[key] = input[key];
      return text(await client.put('/v1/package-sales/catalogue', body));
    }
    const repository = input.repository ?? '';
    const groupId = input.group_id ?? '';
    const qs = (extra: Record<string, string>) => new URLSearchParams({ repository, group_id: groupId, ...extra }).toString();
    if (action === 'needs') return text(await client.get(`/v1/package-sales/config-needs?${qs({})}`));
    if (action === 'offer') return text(await client.get(`/v1/package-sales/author-offer?${qs({})}`));
    if (action === 'revoke') return text(await client.delete(`/v1/package-sales/entitlements?${qs({ node_id: input.node_id ?? '' })}`));
    const body: Record<string, unknown> = { repository: input.repository_link ? { node_id: repository, ...input.repository_link } : repository, group_id: groupId };
    for (const key of ['updates_until', 'channel', 'note', 'terms_id'] as const) if (input[key] !== undefined) body[key] = input[key];
    if (action === 'claim') return text(await client.put('/v1/package-sales/claims', body));
    body.node_id = input.node_id;
    if (input.node !== undefined) body.node = input.node;
    return text(await client.put('/v1/package-sales/entitlements', body));
  });

  // The buying node's operator redeems a claim code with this node's own key (POST /v1/package-claims).
  mcp.tool('aimeat_package_claim', descriptionFor('aimeat_package_claim'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_package_claim') }, annotationsFor('aimeat_package_claim'), async ({ agent_name, repository, repository_link, group_id, code }) => {
    const { client } = pickAgent(registry, agent_name);
    return text(await client.post('/v1/package-claims', {
      repository: repository_link ? { node_id: repository, ...repository_link } : repository, group_id, code,
    }));
  });
}
