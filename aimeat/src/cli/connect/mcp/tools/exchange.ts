/**
 * @file exchange.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the EXCHANGE marketplace tools — parity with the server
 *   MCP (src/mcp/exchange.ts) so `aimeat connect serve --surface service|agent` exposes offering
 *   browse/detail, contract acceptance + list + pause/revoke, need post/browse, bidding, bid-accept and
 *   provider lineage locally. Thin REST proxies over the /v1/exchange/* routes (src/routes/exchange.ts +
 *   exchange-market.ts) — server-side authz + authoritative pricing unchanged.
 * @version-history
 *   2026-10-06 — aimeat_exchange_accept and aimeat_exchange_need_post run their dispatch definition (secaudit
 *     2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 11: aimeat_exchange_work_deliver carries
 *     `ai_provenance` / `ai_provenance_id` and echoes what was recorded.
 *   v1.1.0 — 2026-07-21 — Act-on-exchange parity (tunnelled fleet agents get the same generic tools as the
 *     server MCP): app_tool_invoke (call an app tool via contract) + work start/deliver/list + proposals +
 *     proposal_decide — thin REST proxies over the app-tool WebMCP invoke, /v1/exchange/work, and proposals routes.
 *   v1.0.0 — 2026-07-20 — Initial: offerings, offering_get, accept, contracts, contract_off, needs,
 *     need_post, bid, bid_accept, consumers — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { provenanceEchoedResult } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerExchangeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  // ── Act-on-exchange (generic, tunnelled fleet parity with the server MCP) ──────────────────────────
  mcp.tool('aimeat_app_tool_invoke', descriptionFor('aimeat_app_tool_invoke'), zodShapeFor('aimeat_app_tool_invoke'), annotationsFor('aimeat_app_tool_invoke'), async ({ owner, app, tool, input }) => {
    const o = owner.split('@')[0];
    return out(await client.post(`/v1/apps/${encodeURIComponent(o)}/${encodeURIComponent(app)}/webmcp/tools/${encodeURIComponent(tool)}`, { input: input ?? {} }));
  });

  mcp.tool('aimeat_exchange_work', descriptionFor('aimeat_exchange_work'), zodShapeFor('aimeat_exchange_work'), annotationsFor('aimeat_exchange_work'), async ({ offering_id, input, note }) => {
    const body: Record<string, unknown> = { offering_id };
    if (input) body.input = input;
    if (note) body.note = note;
    return out(await client.post('/v1/exchange/work', body));
  });

  mcp.tool('aimeat_exchange_work_deliver', descriptionFor('aimeat_exchange_work_deliver'), zodShapeFor('aimeat_exchange_work_deliver'), annotationsFor('aimeat_exchange_work_deliver'), async ({ work_id, output, note, ai_provenance, ai_provenance_id }) => {
    const body: Record<string, unknown> = {};
    if (output !== undefined) body.output = output;
    if (note) body.note = note;
    const resp = await client.post(`/v1/exchange/work/${encodeURIComponent(work_id)}/deliver`, body);
    if (resp.ok === false) return out(resp);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_exchange_work_deliver', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_exchange_work_list', descriptionFor('aimeat_exchange_work_list'), zodShapeFor('aimeat_exchange_work_list'), annotationsFor('aimeat_exchange_work_list'), async ({ role }) => {
    return out(await client.get(`/v1/exchange/work${role ? `?role=${encodeURIComponent(role)}` : ''}`));
  });

  mcp.tool('aimeat_exchange_proposals', descriptionFor('aimeat_exchange_proposals'), zodShapeFor('aimeat_exchange_proposals'), annotationsFor('aimeat_exchange_proposals'), async () => {
    return out(await client.get('/v1/exchange/proposals'));
  });

  mcp.tool('aimeat_exchange_proposal_decide', descriptionFor('aimeat_exchange_proposal_decide'), zodShapeFor('aimeat_exchange_proposal_decide'), annotationsFor('aimeat_exchange_proposal_decide'), async ({ proposal_id, decision }) => {
    return out(await client.post(`/v1/exchange/proposals/${encodeURIComponent(proposal_id)}/${decision}`, {}));
  });
}
