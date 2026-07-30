/**
 * @file commerce.ts
 * @description Connector MCP registrations for the commerce tools — parity with the server MCP
 *   (src/mcp/commerce.ts) so `aimeat connect serve --surface service|agent` exposes seller PSP
 *   credentials, sellable app-tool manifests, offer pricing and buyer checkout locally. Thin REST
 *   proxies: dedicated /v1/commerce/checkout-sessions routes for checkout; the whole-doc PUT
 *   /v1/agents/:name/offers for offer pricing; and the generic /v1/memory routes (memory:write authz
 *   unchanged) for the commerce.psp / apps.{id}.tools records the server MCP writes directly.
 * @version-history
 *   v1.1.0 -- 2026-07-30 -- Beneficiary splits: declare/list/withdraw, earnings + obligations, release,
 *     operator approval and payout quote/settle. The server registered these six; the connector did
 *     not, so `--surface service` was six tools short of what it claims to serve.
 *   v1.0.0 -- 2026-07-19 -- Initial: psp set/status/delete, app_tools publish/get, offer_price_set,
 *     checkout open/complete/list — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerCommerceTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  // Seller PSP credentials — server MCP writes/masks commerce.psp; the connector runs as the owner so
  // it reads/writes that private owner record directly via the generic memory routes.
  mcp.tool('aimeat_commerce_psp_set', descriptionFor('aimeat_commerce_psp_set'), {
    provider: z.string().describe('PSP identifier, e.g. "stripe".'),
    secret_key: z.string().describe('The PSP secret credential.'),
  }, annotationsFor('aimeat_commerce_psp_set'), async ({ provider, secret_key }) => {
    return out(await client.post('/v1/memory', { key: 'commerce.psp', value: { provider, secretKey: secret_key }, visibility: 'private', tags: ['commerce'] }));
  });

  mcp.tool('aimeat_commerce_psp_status', descriptionFor('aimeat_commerce_psp_status'), {}, annotationsFor('aimeat_commerce_psp_status'), async () => {
    return out(await client.get('/v1/memory/commerce.psp'));
  });

  mcp.tool('aimeat_commerce_psp_delete', descriptionFor('aimeat_commerce_psp_delete'), {}, annotationsFor('aimeat_commerce_psp_delete'), async () => {
    return out(await client.delete('/v1/memory/commerce.psp'));
  });

  // Publish the sellable tool manifest — server MCP validates + writes apps.{id}.tools; the connector
  // writes that public owner record via POST /v1/memory.
  mcp.tool('aimeat_app_tools_publish', descriptionFor('aimeat_app_tools_publish'), {
    app_id: z.string().describe('The app\'s published filename (manifest key is apps.{app_id}.tools).'),
    tools: z.array(z.record(z.string(), z.unknown())).describe('Full tool list: [{ name, description?, inputSchema?, action_id?, agent?, price?, priceMoney? }].'),
  }, annotationsFor('aimeat_app_tools_publish'), async ({ app_id, tools }) => {
    return out(await client.post('/v1/memory', {
      key: `apps.${app_id}.tools`,
      value: { version: 1, updatedAt: new Date().toISOString(), tools },
      visibility: 'public',
      tags: ['commerce', 'app-tools'],
    }));
  });

  mcp.tool('aimeat_app_tools_get', descriptionFor('aimeat_app_tools_get'), {
    app_id: z.string().describe('The app\'s published filename.'),
    owner: z.string().optional().describe('App owner GHII (owner@node) for a cross-owner public read. Default: your own owner.'),
  }, annotationsFor('aimeat_app_tools_get'), async ({ app_id, owner: ownerArg }) => {
    const key = `apps.${app_id}.tools`;
    // Own manifest: GET /v1/memory/:key. Cross-owner needs a full GHII (owner@node) — GET
    // /v1/memory/:gaii/:key (public only); a bare owner falls back to own (the connector has no nodeId).
    const resp = ownerArg && ownerArg.includes('@')
      ? await client.get(`/v1/memory/${encodeURIComponent(ownerArg)}/${encodeURIComponent(key)}`)
      : await client.get(`/v1/memory/${encodeURIComponent(key)}`);
    return out(resp);
  });

  // Set/clear one offer's price — no single-field route; read the whole offers doc, patch the one offer,
  // and PUT it back (the same whole-doc contract the server MCP uses; agent-role authz unchanged).
  mcp.tool('aimeat_offer_price_set', descriptionFor('aimeat_offer_price_set'), {
    agent_name: z.string().describe('Bare name of your agent that publishes the offer.'),
    offer_id: z.string().describe('The offer id inside agents.{agent_name}.offers.'),
    price_morsels: z.number().int().positive().optional().describe('Morsel price per call.'),
    money_amount_micros: z.number().int().positive().optional().describe('Money price in integer 6-decimal micro-units.'),
    money_currency: z.enum(['EUR', 'USD']).optional().describe('Currency for money_amount_micros.'),
    clear_morsels: z.boolean().optional().describe('Remove the morsel price.'),
    clear_money: z.boolean().optional().describe('Remove the money price.'),
    visibility: z.enum(['private', 'unlisted', 'public']).optional().describe('Offer visibility.'),
  }, annotationsFor('aimeat_offer_price_set'), async ({ agent_name, offer_id, price_morsels, money_amount_micros, money_currency, clear_morsels, clear_money, visibility }) => {
    const current = await client.get(`/v1/agents/${encodeURIComponent(agent_name)}/offers`);
    if (current.ok === false) return out(current);
    const data = current.data as { offers?: Array<Record<string, unknown>> } | undefined;
    const offers = Array.isArray(data?.offers) ? data!.offers : [];
    const offer = offers.find(o => o.id === offer_id);
    if (!offer) return { content: [{ type: 'text' as const, text: `OFFER_NOT_FOUND: ${offer_id} on agent ${agent_name}` }], isError: true };
    if (price_morsels !== undefined) offer.price = { morsels: price_morsels, unit: (offer.price as { unit?: string } | undefined)?.unit ?? 'per-call' };
    if (clear_morsels) offer.price = null;
    if (money_amount_micros !== undefined) offer.priceMoney = { amount: money_amount_micros, currency: money_currency ?? 'EUR' };
    if (clear_money) offer.priceMoney = null;
    if (visibility) offer.visibility = visibility;
    return out(await client.put(`/v1/agents/${encodeURIComponent(agent_name)}/offers`, { offers }));
  });

  mcp.tool('aimeat_checkout_open', descriptionFor('aimeat_checkout_open'), {
    items: z.array(z.record(z.string(), z.unknown())).describe('[{ kind?, agent?, offer_id?, app?, tool?, input?, quantity? }].'),
    note: z.string().optional().describe('Buyer note delivered with the order.'),
    currency: z.string().optional().describe('"morsel" (default) or a money code (EUR/USD).'),
  }, annotationsFor('aimeat_checkout_open'), async ({ items, note, currency }) => {
    const payload: Record<string, unknown> = { items };
    if (note) payload.note = note;
    if (currency) payload.currency = currency;
    return out(await client.post('/v1/commerce/checkout-sessions', payload));
  });

  mcp.tool('aimeat_checkout_complete', descriptionFor('aimeat_checkout_complete'), {
    session_id: z.string().describe('The open session id from aimeat_checkout_open.'),
    handler: z.string().optional().describe('Payment handler id (default io.aimeat.morsels).'),
  }, annotationsFor('aimeat_checkout_complete'), async ({ session_id, handler }) => {
    return out(await client.post(`/v1/commerce/checkout-sessions/${encodeURIComponent(session_id)}/complete`, handler ? { handler } : {}));
  });

  mcp.tool('aimeat_checkout_list', descriptionFor('aimeat_checkout_list'), {
    limit: z.number().int().min(1).max(200).optional().describe('Max sessions to return (default 20, max 200).'),
  }, annotationsFor('aimeat_checkout_list'), async ({ limit }) => {
    return out(await client.get(`/v1/commerce/checkout-sessions${limit ? `?limit=${limit}` : ''}`));
  });

  // Beneficiary splits — a seller declares who else earns from a sale, releases what accrued and pays
  // it out; a beneficiary reads its own earnings. The connector proxies /v1/commerce/beneficiary*;
  // the arithmetic, the verification gate and the ledger all stay on the node.
  const q = (params: Record<string, string | number | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };

  mcp.tool('aimeat_commerce_beneficiary_split_set', descriptionFor('aimeat_commerce_beneficiary_split_set'), {
    ext: z.string().describe('Extension name of the priced coordinate.'),
    action: z.string().describe('Action id of the priced coordinate.'),
    mode: z.enum(['pool', 'roles']).optional().describe('"pool" divides one percentage by weight; "roles" gives each named role its own independent percent.'),
    pool_percent: z.number().min(0).max(100).optional().describe('Pool mode: the share of YOUR cut that goes to beneficiaries.'),
    roles: z.array(z.record(z.string(), z.unknown())).optional().describe('Roles mode: [{ role, percent, ghii?, note? }]. Percents total at most 100 and nobody dilutes anybody.'),
    beneficiaries: z.array(z.record(z.string(), z.unknown())).optional().describe('Pool mode: [{ ghii, weight?, note? }].'),
    dynamic: z.boolean().optional().describe('Let the capability name its beneficiaries per call.'),
    capability: z.string().optional().describe('Human label for the coordinate.'),
    state: z.enum(['active', 'paused']).optional(),
  }, annotationsFor('aimeat_commerce_beneficiary_split_set'), async (args) => {
    return out(await client.post('/v1/commerce/beneficiary-splits', args));
  });

  mcp.tool('aimeat_commerce_beneficiary_splits', descriptionFor('aimeat_commerce_beneficiary_splits'), {
    remove_ext: z.string().optional().describe('Withdraw the split on this coordinate (with remove_action).'),
    remove_action: z.string().optional().describe('Withdraw the split on this coordinate (with remove_ext).'),
  }, annotationsFor('aimeat_commerce_beneficiary_splits'), async ({ remove_ext, remove_action }) => {
    if (remove_ext || remove_action) {
      if (!remove_ext || !remove_action) {
        return out({ ok: false, data: { error: 'INVALID_INPUT: withdrawing needs both remove_ext and remove_action' } });
      }
      return out(await client.delete(`/v1/commerce/beneficiary-splits${q({ ext: remove_ext, action: remove_action })}`));
    }
    return out(await client.get('/v1/commerce/beneficiary-splits'));
  });

  mcp.tool('aimeat_commerce_beneficiary_earnings', descriptionFor('aimeat_commerce_beneficiary_earnings'), {
    role: z.enum(['beneficiary', 'provider']).optional().describe('"beneficiary" (default) is what you are owed; "provider" is what you owe.'),
    status: z.enum(['accrued', 'released', 'paid', 'reversed']).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }, annotationsFor('aimeat_commerce_beneficiary_earnings'), async ({ role, status, limit }) => {
    const path = role === 'provider' ? 'obligations' : 'earnings';
    return out(await client.get(`/v1/commerce/beneficiary/${path}${q({ status, limit })}`));
  });

  mcp.tool('aimeat_commerce_beneficiary_release', descriptionFor('aimeat_commerce_beneficiary_release'), {
    tracking_code: z.string().describe('The tracking code of the accrued share.'),
    beneficiary: z.string().describe('Beneficiary GHII (owner@node-id).'),
  }, annotationsFor('aimeat_commerce_beneficiary_release'), async ({ tracking_code, beneficiary }) => {
    return out(await client.post('/v1/commerce/beneficiary/release', { tracking_code, beneficiary }));
  });

  mcp.tool('aimeat_commerce_beneficiary_approve', descriptionFor('aimeat_commerce_beneficiary_approve'), {
    ghii: z.string().optional().describe('Beneficiary GHII. Omit to read your own state.'),
    state: z.enum(['verified', 'unverified', 'rejected']).optional().describe('Omit to READ. Recording a state is an operator action.'),
    method: z.string().optional().describe('How representation was established, e.g. "contract-on-file". Required to verify.'),
    subject: z.string().optional(),
    evidence: z.string().optional(),
  }, annotationsFor('aimeat_commerce_beneficiary_approve'), async ({ ghii, state, method, subject, evidence }) => {
    if (!state) return out(await client.get(`/v1/commerce/beneficiary/approvals${q({ ghii })}`));
    return out(await client.post('/v1/commerce/beneficiary/approvals', { ghii, state, method, subject, evidence }));
  });

  mcp.tool('aimeat_commerce_beneficiary_payout', descriptionFor('aimeat_commerce_beneficiary_payout'), {
    beneficiary: z.string().describe('Beneficiary GHII to pay.'),
    currency: z.string().optional().describe('Currency of the released entries to settle.'),
    payment: z.record(z.string(), z.unknown()).optional().describe('The signed authorisation. Omit to get a QUOTE: the node never holds a key, so the payer signs.'),
  }, annotationsFor('aimeat_commerce_beneficiary_payout'), async ({ beneficiary, currency, payment }) => {
    if (!payment) return out(await client.get(`/v1/commerce/beneficiary/payout${q({ beneficiary, currency })}`));
    return out(await client.post('/v1/commerce/beneficiary/payout', { beneficiary, currency, payment }));
  });
}
