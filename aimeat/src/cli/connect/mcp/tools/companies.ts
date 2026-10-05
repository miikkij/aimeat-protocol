/**
 * @file companies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the OWNER's companies — parity with the server MCP
 *   (src/mcp/companies.ts) so `aimeat connect serve --surface agent` exposes the same five tools
 *   locally. Thin proxies over the shared /v1/companies routes, so both surfaces enforce the same
 *   rules (slug arbitration, "the front-page app must be YOURS", the portfolio size cap).
 *
 *   The company tools joined the 'agent' surface without a connector half, so an agent served
 *   locally could not set its owner's company up at all while the same agent could over /v2/mcp —
 *   caught by test/unit/connector-surfaces.ts, which is what that test is for.
 * @structure registerCompanyTools(mcp, registry) — list · create · update · front_page ·
 *   portfolio_publish
 * @usage import { registerCompanyTools } from './companies.js';
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-08 — Initial: connector-surface coverage for the company registry.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

/** Wire name → the record field the GET returns, for the merge below. */
const RECORD_FIELD: Record<string, string> = {
  description: 'description', organism_id: 'organismId',
  business_id: 'businessId', vat_id: 'vatId',
  street_address: 'streetAddress', postal_code: 'postalCode', city: 'city', country: 'country',
  email: 'email', phone: 'phone', iban: 'iban', bic: 'bic',
  einvoice_address: 'einvoiceAddress', einvoice_operator: 'einvoiceOperator',
};

type IdentityInput = Record<string, string | undefined>;

/** Only the keys the caller actually sent, so nothing unmentioned is carried as an empty string. */
function sentFields(input: IdentityInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const wire of Object.keys(RECORD_FIELD)) {
    const v = input[wire];
    if (v !== undefined) out[wire] = v;
  }
  return out;
}

export function registerCompanyTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_company_list', descriptionFor('aimeat_company_list'), zodShapeFor('aimeat_company_list'), annotationsFor('aimeat_company_list'), async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set('page', String(page));
    if (per_page !== undefined) params.set('per_page', String(per_page));
    const qs = params.toString();
    return out(await client.get(`/v1/companies${qs ? '?' + qs : ''}`));
  });

  mcp.tool('aimeat_company_create', descriptionFor('aimeat_company_create'), zodShapeFor('aimeat_company_create'), annotationsFor('aimeat_company_create'), async ({ name, slug, ...identity }) => {
    return out(await client.post('/v1/companies', {
      name, ...(slug ? { slug } : {}), ...sentFields(identity as IdentityInput),
    }));
  });

  mcp.tool('aimeat_company_update', descriptionFor('aimeat_company_update'), zodShapeFor('aimeat_company_update'), annotationsFor('aimeat_company_update'), async ({ company_id, name, ...identity }) => {
    // PUT replaces, so read the current record and merge onto it — an update that gathers details
    // over several turns must not blank what an earlier turn set. The server MCP does the same;
    // sending only the mentioned fields here would make the two surfaces disagree about the
    // dangerous direction (a one-field correction wiping an IBAN).
    const current = await client.get(`/v1/companies/${encodeURIComponent(company_id)}`);
    if (current.ok === false) return out(current);
    const company = ((current.data as { company?: Record<string, unknown> })?.company) ?? {};
    const body: Record<string, unknown> = { name: name ?? company.name };
    for (const [wireName, recordName] of Object.entries(RECORD_FIELD)) {
      const v = company[recordName];
      if (v !== undefined && v !== null) body[wireName] = v;
    }
    const patch = sentFields(identity as IdentityInput);
    Object.assign(body, patch);
    const resp = await client.put(`/v1/companies/${encodeURIComponent(company_id)}`, body);
    if (resp.ok === false) return out(resp);
    return out({ ...resp, data: { ...(resp.data as object), updated_fields: Object.keys(patch) } });
  });

  mcp.tool('aimeat_company_front_page', descriptionFor('aimeat_company_front_page'), zodShapeFor('aimeat_company_front_page'), annotationsFor('aimeat_company_front_page'), async ({ company_id, kind, target }) => {
    return out(await client.put(`/v1/companies/${encodeURIComponent(company_id)}/front-page`, {
      kind, ...(target !== undefined ? { target } : {}),
    }));
  });

  mcp.tool('aimeat_company_portfolio_publish', descriptionFor('aimeat_company_portfolio_publish'), zodShapeFor('aimeat_company_portfolio_publish'), annotationsFor('aimeat_company_portfolio_publish'), async ({ company_id, html }) => {
    return out(await client.put(`/v1/companies/${encodeURIComponent(company_id)}/portfolio`, { html }));
  });
}
