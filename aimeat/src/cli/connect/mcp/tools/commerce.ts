/**
 * @file commerce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the commerce tools — parity with the server MCP
 *   (src/mcp/commerce.ts) so `aimeat connect serve --surface service|agent` exposes seller PSP
 *   credentials, sellable app-tool manifests, offer pricing and buyer checkout locally. Thin REST
 *   proxies: dedicated /v1/commerce/checkout-sessions routes for checkout; the whole-doc PUT
 *   /v1/agents/:name/offers for offer pricing; and the generic /v1/memory routes (memory:write authz
 *   unchanged) for the commerce.psp / apps.{id}.tools records the server MCP writes directly.
 * @version-history
 *   2026-10-06 — aimeat_app_tools_publish, aimeat_app_tools_get, aimeat_offer_price_set and aimeat_checkout_list
 *     run their dispatch definition (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 -- 2026-09-16 -- psp_set, psp_status and psp_delete go through /v1/commerce/payout. Through
 *     the generic memory routes psp_set stored the Stripe key in plain text and psp_status returned it.
 *   v1.1.0 -- 2026-07-30 -- Beneficiary splits: declare/list/withdraw, earnings + obligations, release,
 *     operator approval and payout quote/settle. The server registered these six; the connector did
 *     not, so `--surface service` was six tools short of what it claims to serve.
 *   v1.0.0 -- 2026-07-19 -- Initial: psp set/status/delete, app_tools publish/get, offer_price_set,
 *     checkout open/complete/list — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerCommerceTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  // Beneficiary splits — a seller declares who else earns from a sale, releases what accrued and pays
  // it out; a beneficiary reads its own earnings. The connector proxies /v1/commerce/beneficiary*;
  // the arithmetic, the verification gate and the ledger all stay on the node.
  const q = (params: Record<string, string | number | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };

  mcp.tool('aimeat_commerce_beneficiary_split_set', descriptionFor('aimeat_commerce_beneficiary_split_set'), zodShapeFor('aimeat_commerce_beneficiary_split_set'), annotationsFor('aimeat_commerce_beneficiary_split_set'), async (args) => {
    return out(await client.post('/v1/commerce/beneficiary-splits', args));
  });

  mcp.tool('aimeat_commerce_beneficiary_splits', descriptionFor('aimeat_commerce_beneficiary_splits'), zodShapeFor('aimeat_commerce_beneficiary_splits'), annotationsFor('aimeat_commerce_beneficiary_splits'), async ({ remove_ext, remove_action }) => {
    if (remove_ext || remove_action) {
      if (!remove_ext || !remove_action) {
        return out({ ok: false, data: { error: 'INVALID_INPUT: withdrawing needs both remove_ext and remove_action' } });
      }
      return out(await client.delete(`/v1/commerce/beneficiary-splits${q({ ext: remove_ext, action: remove_action })}`));
    }
    return out(await client.get('/v1/commerce/beneficiary-splits'));
  });

  mcp.tool('aimeat_commerce_beneficiary_earnings', descriptionFor('aimeat_commerce_beneficiary_earnings'), zodShapeFor('aimeat_commerce_beneficiary_earnings'), annotationsFor('aimeat_commerce_beneficiary_earnings'), async ({ role, status, limit }) => {
    const path = role === 'provider' ? 'obligations' : 'earnings';
    return out(await client.get(`/v1/commerce/beneficiary/${path}${q({ status, limit })}`));
  });

  mcp.tool('aimeat_commerce_beneficiary_release', descriptionFor('aimeat_commerce_beneficiary_release'), zodShapeFor('aimeat_commerce_beneficiary_release'), annotationsFor('aimeat_commerce_beneficiary_release'), async ({ tracking_code, beneficiary }) => {
    return out(await client.post('/v1/commerce/beneficiary/release', { tracking_code, beneficiary }));
  });

  mcp.tool('aimeat_commerce_beneficiary_approve', descriptionFor('aimeat_commerce_beneficiary_approve'), zodShapeFor('aimeat_commerce_beneficiary_approve'), annotationsFor('aimeat_commerce_beneficiary_approve'), async ({ ghii, state, method, subject, evidence }) => {
    if (!state) return out(await client.get(`/v1/commerce/beneficiary/approvals${q({ ghii })}`));
    return out(await client.post('/v1/commerce/beneficiary/approvals', { ghii, state, method, subject, evidence }));
  });

  mcp.tool('aimeat_commerce_beneficiary_payout', descriptionFor('aimeat_commerce_beneficiary_payout'), zodShapeFor('aimeat_commerce_beneficiary_payout'), annotationsFor('aimeat_commerce_beneficiary_payout'), async ({ beneficiary, currency, payment }) => {
    if (!payment) return out(await client.get(`/v1/commerce/beneficiary/payout${q({ beneficiary, currency })}`));
    return out(await client.post('/v1/commerce/beneficiary/payout', { beneficiary, currency, payment }));
  });
}
