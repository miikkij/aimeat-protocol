/**
 * @file exchange.ts
 * @description Connector MCP registrations for the EXCHANGE marketplace tools — parity with the server
 *   MCP (src/mcp/exchange.ts) so `aimeat connect serve --surface service|agent` exposes offering
 *   browse/detail, contract acceptance + list + pause/revoke, need post/browse, bidding, bid-accept and
 *   provider lineage locally. Thin REST proxies over the /v1/exchange/* routes (src/routes/exchange.ts +
 *   exchange-market.ts) — server-side authz + authoritative pricing unchanged.
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial: offerings, offering_get, accept, contracts, contract_off, needs,
 *     need_post, bid, bid_accept, consumers — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerExchangeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });
  const qs = (params: Record<string, string | number | boolean | undefined>): string => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
    const out = s.toString();
    return out ? `?${out}` : '';
  };

  mcp.tool('aimeat_exchange_offerings', descriptionFor('aimeat_exchange_offerings'), {
    q: z.string().optional().describe('Free-text match over title/description/ext/action/tags.'),
    ext: z.string().optional().describe('Exact extension name (pair with action).'),
    action: z.string().optional().describe('Exact action id (pair with ext).'),
    stats: z.boolean().optional().describe('Fold in per-offering usage/reputation stats.'),
  }, annotationsFor('aimeat_exchange_offerings'), async ({ q, ext, action, stats }) => {
    return out(await client.get(`/v1/exchange/offerings${qs({ q, ext, action, stats: stats ? '1' : undefined })}`));
  });

  mcp.tool('aimeat_exchange_offering_get', descriptionFor('aimeat_exchange_offering_get'), {
    offering_id: z.string().describe('The offering id (e.g. "off-…").'),
  }, annotationsFor('aimeat_exchange_offering_get'), async ({ offering_id }) => {
    return out(await client.get(`/v1/exchange/offerings/${encodeURIComponent(offering_id)}`));
  });

  mcp.tool('aimeat_exchange_accept', descriptionFor('aimeat_exchange_accept'), {
    ext: z.string().describe('The provider extension name.'),
    action: z.string().describe('The action id (must be priced).'),
    contract_ref: z.string().optional().describe('Your contract reference. Omit to auto-generate (mcp:<uuid>).'),
    cap_units: z.number().int().nonnegative().optional().describe('Budget ceiling in the action\'s unit. Omit = uncapped.'),
    plan_id: z.string().optional().describe('A provider-declared plan id (bundle/subscription).'),
    app_id: z.string().optional().describe('The consuming app id ("owner/filename").'),
  }, annotationsFor('aimeat_exchange_accept'), async ({ ext, action, contract_ref, cap_units, plan_id, app_id }) => {
    const body: Record<string, unknown> = { ext, action };
    body.contract_ref = contract_ref || `mcp:${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    if (cap_units !== undefined) body.cap_units = cap_units;
    if (plan_id) body.plan_id = plan_id;
    if (app_id) body.app_id = app_id;
    return out(await client.post('/v1/exchange/entitlements', body));
  });

  mcp.tool('aimeat_exchange_contracts', descriptionFor('aimeat_exchange_contracts'), {}, annotationsFor('aimeat_exchange_contracts'), async () => {
    return out(await client.get('/v1/exchange/entitlements'));
  });

  mcp.tool('aimeat_exchange_contract_off', descriptionFor('aimeat_exchange_contract_off'), {
    ext: z.string().describe('The contracted extension name.'),
    action: z.string().describe('The contracted action id.'),
    mode: z.enum(['pause', 'revoke']).describe('pause (reversible) or revoke (terminal).'),
  }, annotationsFor('aimeat_exchange_contract_off'), async ({ ext, action, mode }) => {
    return out(await client.post('/v1/exchange/entitlements/off', { ext, action, mode }));
  });

  mcp.tool('aimeat_exchange_needs', descriptionFor('aimeat_exchange_needs'), {
    open: z.boolean().optional().describe('Only open needs.'),
    mine: z.boolean().optional().describe('Only needs you posted.'),
  }, annotationsFor('aimeat_exchange_needs'), async ({ open, mine }) => {
    return out(await client.get(`/v1/exchange/needs${qs({ open: open ? '1' : undefined, mine: mine ? '1' : undefined })}`));
  });

  mcp.tool('aimeat_exchange_need_post', descriptionFor('aimeat_exchange_need_post'), {
    description: z.string().describe('What you need, in plain language.'),
    ext: z.string().optional().describe('A desired extension name.'),
    action: z.string().optional().describe('A desired action id (pair with ext).'),
    spec: z.record(z.string(), z.unknown()).optional().describe('Minimum output shape: { requiredFields[], format?, sample?, notes? }.'),
    budget_unit: z.enum(['morsels', 'money']).optional().describe('Budget unit for budget_cap.'),
    budget_cap: z.number().int().nonnegative().optional().describe('Budget ceiling (integer).'),
    app_id: z.string().optional().describe('The app this need belongs to ("owner/filename").'),
    autonomy: z.enum(['supervised', 'auto']).optional().describe('supervised (default) or auto.'),
  }, annotationsFor('aimeat_exchange_need_post'), async ({ description, ext, action, spec, budget_unit, budget_cap, app_id, autonomy }) => {
    const body: Record<string, unknown> = { description };
    if (ext) body.ext = ext;
    if (action) body.action = action;
    if (spec) body.spec = spec;
    if (budget_unit) body.budget_unit = budget_unit;
    if (budget_cap !== undefined) body.budget_cap = budget_cap;
    if (app_id) body.app_id = app_id;
    if (autonomy) body.autonomy = autonomy;
    return out(await client.post('/v1/exchange/needs', body));
  });

  mcp.tool('aimeat_exchange_bid', descriptionFor('aimeat_exchange_bid'), {
    need_id: z.string().describe('The open need id.'),
    ext: z.string().describe('Your extension name (you must own it).'),
    action: z.string().describe('The action id on your extension.'),
    plan_id: z.string().optional().describe('A plan id declared on your action.'),
    note: z.string().optional().describe('A note to the requester.'),
    offering_id: z.string().optional().describe('Link an existing offering of yours.'),
  }, annotationsFor('aimeat_exchange_bid'), async ({ need_id, ext, action, plan_id, note, offering_id }) => {
    const body: Record<string, unknown> = { ext, action };
    if (plan_id) body.plan_id = plan_id;
    if (note) body.note = note;
    if (offering_id) body.offering_id = offering_id;
    return out(await client.post(`/v1/exchange/needs/${encodeURIComponent(need_id)}/bids`, body));
  });

  mcp.tool('aimeat_exchange_bid_accept', descriptionFor('aimeat_exchange_bid_accept'), {
    need_id: z.string().describe('Your need id.'),
    bid_id: z.string().describe('The open bid to accept.'),
    cap_units: z.number().int().nonnegative().optional().describe('Budget ceiling for the minted contract.'),
  }, annotationsFor('aimeat_exchange_bid_accept'), async ({ need_id, bid_id, cap_units }) => {
    const body: Record<string, unknown> = {};
    if (cap_units !== undefined) body.cap_units = cap_units;
    return out(await client.post(`/v1/exchange/needs/${encodeURIComponent(need_id)}/bids/${encodeURIComponent(bid_id)}/accept`, body));
  });

  mcp.tool('aimeat_exchange_consumers', descriptionFor('aimeat_exchange_consumers'), {
    offering_id: z.string().describe('One of your own offering ids.'),
  }, annotationsFor('aimeat_exchange_consumers'), async ({ offering_id }) => {
    return out(await client.get(`/v1/exchange/offerings/${encodeURIComponent(offering_id)}/consumers`));
  });
}
