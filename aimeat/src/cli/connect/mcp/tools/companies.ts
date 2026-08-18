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
 *   v1.0.0 — 2026-08-08 — Initial: connector-surface coverage for the company registry.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

/** Optional identity fields, shared by create and update — the server MCP's shape, verbatim. */
const identityShape = {
  description: z.string().optional().describe('One or two sentences about what the company does'),
  business_id: z.string().optional().describe('Company registration number (Finnish Y-tunnus)'),
  vat_id: z.string().optional().describe('VAT number'),
  street_address: z.string().optional().describe('Street address'),
  postal_code: z.string().optional().describe('Postal code'),
  city: z.string().optional().describe('City'),
  country: z.string().optional().describe('ISO 3166-1 alpha-2 country code (two letters)'),
  email: z.string().optional().describe('Contact email'),
  phone: z.string().optional().describe('Contact phone'),
  iban: z.string().optional().describe('Bank account (IBAN) an invoice tells the buyer to pay'),
  bic: z.string().optional().describe('Bank BIC/SWIFT'),
  einvoice_address: z.string().optional().describe('E-invoice address (OVT identifier)'),
  einvoice_operator: z.string().optional().describe('E-invoice operator id (often a bank BIC)'),
};

/** Wire name → the record field the GET returns, for the merge below. */
const RECORD_FIELD: Record<string, string> = {
  description: 'description', business_id: 'businessId', vat_id: 'vatId',
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

  mcp.tool('aimeat_company_list', descriptionFor('aimeat_company_list'), {
    page: z.number().optional().describe('Page number (default 1)'),
    per_page: z.number().optional().describe('Companies per page (default 50, max 100)'),
  }, annotationsFor('aimeat_company_list'), async ({ page, per_page }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set('page', String(page));
    if (per_page !== undefined) params.set('per_page', String(per_page));
    const qs = params.toString();
    return out(await client.get(`/v1/companies${qs ? '?' + qs : ''}`));
  });

  mcp.tool('aimeat_company_create', descriptionFor('aimeat_company_create'), {
    name: z.string().describe('Trade name as it should appear on invoices'),
    slug: z.string().optional().describe('Address label; defaults to a normalised form of the name'),
    ...identityShape,
  }, annotationsFor('aimeat_company_create'), async ({ name, slug, ...identity }) => {
    return out(await client.post('/v1/companies', {
      name, ...(slug ? { slug } : {}), ...sentFields(identity as IdentityInput),
    }));
  });

  mcp.tool('aimeat_company_update', descriptionFor('aimeat_company_update'), {
    company_id: z.string().describe('Company id from aimeat_company_list'),
    name: z.string().optional().describe('Trade name (the address is not renamed by this)'),
    ...identityShape,
  }, annotationsFor('aimeat_company_update'), async ({ company_id, name, ...identity }) => {
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

  mcp.tool('aimeat_company_front_page', descriptionFor('aimeat_company_front_page'), {
    company_id: z.string().describe('Company id from aimeat_company_list'),
    kind: z.enum(['app', 'portfolio', 'redirect', 'none']).describe('What the address serves'),
    target: z.string().optional().describe('"owner/file.html" for app; an absolute URL for redirect'),
  }, annotationsFor('aimeat_company_front_page'), async ({ company_id, kind, target }) => {
    return out(await client.put(`/v1/companies/${encodeURIComponent(company_id)}/front-page`, {
      kind, ...(target !== undefined ? { target } : {}),
    }));
  });

  mcp.tool('aimeat_company_portfolio_publish', descriptionFor('aimeat_company_portfolio_publish'), {
    company_id: z.string().describe('Company id from aimeat_company_list'),
    html: z.string().describe('The complete HTML document to serve at the company address'),
  }, annotationsFor('aimeat_company_portfolio_publish'), async ({ company_id, html }) => {
    return out(await client.put(`/v1/companies/${encodeURIComponent(company_id)}/portfolio`, { html }));
  });
}
