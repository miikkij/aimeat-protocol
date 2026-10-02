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
 *   v1.2.0 — 2026-10-02 — aimeat_package_sale gains offer, claim, catalogue, price, requests and decide;
 *     aimeat_package_claim over POST /v1/package-claims (package sale design, phase 3).
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
    action: z.enum(['needs', 'grant', 'revoke', 'offer', 'claim', 'catalogue', 'price', 'requests', 'decide']).describe('needs: the questions to ask; grant: serve (or change, or end the updates of) a customer node; revoke: stop serving it; offer: the author\'s terms; claim: a code for a node not known yet; catalogue: what this node sells; price: put a package on sale here at this node\'s price, or change it; requests: sales waiting for approval; decide: approve or refuse one.'),
    repository: z.string().optional().describe('The package repository\'s node id. Not for catalogue, requests or decide.'),
    repository_link: z.object({ url: z.string(), public_key: z.string() }).optional().describe('The first time only: { url, public_key } of the repository, to link it as a peer of this node.'),
    group_id: z.string().optional().describe('The package or install bundle group id on the repository.'),
    node_id: z.string().optional().describe('For grant and revoke: the customer node.'),
    node: z.object({ url: z.string(), public_key: z.string() }).optional().describe('For grant: { url, public_key } of a customer node the repository does not know yet.'),
    updates_until: z.string().optional().describe('For grant and claim: versions published after this ISO date-time are not served.'),
    channel: z.enum(['stable', 'beta']).optional().describe('For grant and claim: stable (the default) or beta.'),
    note: z.string().optional().describe('For grant and claim: the order it came from.'),
    terms_id: z.string().optional().describe('For grant and claim: the author\'s terms the sale was made on (from action offer).'),
    price: z.object({ amount: z.number(), currency: z.string() }).nullable().optional().describe('For price: this node\'s one-time price in micro-units (1 EUR = 1000000), or null for an offer that grants without money.'),
    renewal: z.object({ amount: z.number(), currency: z.string(), period_days: z.number() }).nullable().optional().describe('For price: this node\'s renewal price and period, or null for none.'),
    title: z.string().optional().describe('For price: the name buyers see.'),
    state: z.enum(['on_sale', 'paused', 'ended']).optional().describe('For price: on_sale, paused (renewals only) or ended.'),
    request_id: z.string().optional().describe('For decide: the request.'),
    decision: z.enum(['approve', 'refuse']).optional().describe('For decide.'),
  }, annotationsFor('aimeat_package_sale'), async (input) => {
    const { client } = pickAgent(registry, input.agent_name);
    const { action } = input;
    if (action === 'catalogue') return text(await client.get('/v1/package-sales/catalogue'));
    if (action === 'requests') return text(await client.get('/v1/package-sales/requests'));
    if (action === 'decide') {
      return text(await client.post(`/v1/package-sales/requests/${encodeURIComponent(input.request_id ?? '')}/decision`, { decision: input.decision }));
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
  mcp.tool('aimeat_package_claim', descriptionFor('aimeat_package_claim'), {
    agent_name: agentNameSchema,
    repository: z.string().describe('The package repository\'s node id.'),
    repository_link: z.object({ url: z.string(), public_key: z.string() }).optional().describe('The first time only: { url, public_key } of the repository, to link it as a peer of this node.'),
    group_id: z.string().describe('The package or install bundle group id on the repository.'),
    code: z.string().describe('The claim code the seller gave (pkgc_…).'),
  }, annotationsFor('aimeat_package_claim'), async ({ agent_name, repository, repository_link, group_id, code }) => {
    const { client } = pickAgent(registry, agent_name);
    return text(await client.post('/v1/package-claims', {
      repository: repository_link ? { node_id: repository, ...repository_link } : repository, group_id, code,
    }));
  });
}
