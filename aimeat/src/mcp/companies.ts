/**
 * @file companies.ts
 * @description MCP tools for the company registry — a thin layer over the same service core the
 *   REST /v1/companies routes use, so both surfaces enforce identical rules (slug arbitration,
 *   "the front-page app must be YOURS", the portfolio size cap).
 *
 *   Identity: companies belong to the OWNER, so every call resolves the agent's owner GHII and
 *   never a client-supplied id — an agent manages the same companies its owner does, and can
 *   reach no one else's. Absent and not-yours answer identically.
 *
 * @structure registerCompanyTools(mcp, storage, config, getAgentGaii) — registers
 *   aimeat_company_list, _create, _update, _front_page, _portfolio_publish.
 * @usage import { registerCompanyTools } from './companies.js';
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial: the company setup an AI chat can drive end to end.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CompanyRecord } from '../models/company-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import {
    CompanyError, createCompany, updateCompany, setFrontPage, requireOwnCompany, companyAddress,
} from '../services/company/company-service.js';
import { publishCompanyPortfolio } from '../services/company/company-portfolio.js';

/** Optional identity fields, shared by create and update. */
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

type IdentityInput = { [K in keyof typeof identityShape]?: string };

/**
 * Wire names → record names. Only keys the caller actually sent are returned, so an update
 * never blanks a field the conversation did not mention.
 */
function toRecordFields(input: IdentityInput): Record<string, string> {
    const map: Record<keyof IdentityInput, string> = {
        description: 'description', business_id: 'businessId', vat_id: 'vatId',
        street_address: 'streetAddress', postal_code: 'postalCode', city: 'city', country: 'country',
        email: 'email', phone: 'phone', iban: 'iban', bic: 'bic',
        einvoice_address: 'einvoiceAddress', einvoice_operator: 'einvoiceOperator',
    };
    const out: Record<string, string> = {};
    for (const [wire, rec] of Object.entries(map)) {
        const v = input[wire as keyof IdentityInput];
        if (v !== undefined) out[rec] = v;
    }
    return out;
}

export function registerCompanyTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    /** Companies belong to the OWNER — resolve the agent's owner GHII, never a client-supplied id. */
    const ownerGhii = (): string => {
        const owner = parseGaiiLoose(getAgentGaii()).owner || getAgentGaii();
        return owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
    };

    const wire = (c: CompanyRecord): Record<string, unknown> => ({
        ...c, address: companyAddress(config, c), co_origin_enabled: config.coOriginEnabled,
    });

    /** CompanyError carries the code the REST surface reports; keep the same words here. */
    const fail = (e: unknown): { content: { type: 'text'; text: string }[]; isError: true } => ({
        content: [{
            type: 'text' as const,
            text: e instanceof CompanyError
                ? `${e.code}: ${e.message}`
                : ((e as Error)?.message || 'Company operation failed'),
        }],
        isError: true,
    });
    const ok = (payload: unknown): { content: { type: 'text'; text: string }[] } => ({
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    });

    // ── aimeat_company_list ──
    mcp.tool(
        'aimeat_company_list',
        descriptionFor('aimeat_company_list'),
        {
            page: z.number().optional().describe('Page number (default 1)'),
            per_page: z.number().optional().describe('Companies per page (default 50, max 100)'),
        },
        annotationsFor('aimeat_company_list'),
        async ({ page, per_page }) => {
            const p = Math.max(1, page ?? 1);
            const pp = Math.min(100, Math.max(1, per_page ?? 50));
            const owner = ownerGhii();
            const [rows, total] = await Promise.all([
                storage.listCompanies({ ownerGhii: owner, limit: pp, offset: (p - 1) * pp }),
                storage.countCompanies({ ownerGhii: owner }),
            ]);
            return ok({ companies: rows.map(wire), total, page: p, per_page: pp });
        },
    );

    // ── aimeat_company_create ──
    mcp.tool(
        'aimeat_company_create',
        descriptionFor('aimeat_company_create'),
        {
            name: z.string().describe('Trade name as it should appear on invoices'),
            slug: z.string().optional().describe('Address label; defaults to a normalised form of the name'),
            ...identityShape,
        },
        annotationsFor('aimeat_company_create'),
        async ({ name, slug, ...identity }) => {
            try {
                const company = await createCompany(storage, ownerGhii(), {
                    name, slug, ...toRecordFields(identity as IdentityInput),
                } as never);
                return ok({ company: wire(company) });
            } catch (e) { return fail(e); }
        },
    );

    // ── aimeat_company_update ──
    mcp.tool(
        'aimeat_company_update',
        descriptionFor('aimeat_company_update'),
        {
            company_id: z.string().describe('Company id from aimeat_company_list'),
            name: z.string().optional().describe('Trade name (the address is not renamed by this)'),
            ...identityShape,
        },
        annotationsFor('aimeat_company_update'),
        async ({ company_id, name, ...identity }) => {
            try {
                // Merge onto the CURRENT record so unmentioned fields keep their value: an update
                // that gathers details over several turns must not blank what an earlier turn set.
                const current = await requireOwnCompany(storage, ownerGhii(), company_id);
                const patch = toRecordFields(identity as IdentityInput);
                const company = await updateCompany(storage, ownerGhii(), company_id, {
                    name: name ?? current.name,
                    description: current.description, organismId: current.organismId,
                    businessId: current.businessId, vatId: current.vatId,
                    streetAddress: current.streetAddress, postalCode: current.postalCode,
                    city: current.city, country: current.country,
                    email: current.email, phone: current.phone,
                    iban: current.iban, bic: current.bic,
                    einvoiceAddress: current.einvoiceAddress, einvoiceOperator: current.einvoiceOperator,
                    ...patch,
                } as never);
                return ok({ company: wire(company), updated_fields: Object.keys(patch) });
            } catch (e) { return fail(e); }
        },
    );

    // ── aimeat_company_front_page ──
    mcp.tool(
        'aimeat_company_front_page',
        descriptionFor('aimeat_company_front_page'),
        {
            company_id: z.string().describe('Company id from aimeat_company_list'),
            kind: z.enum(['app', 'portfolio', 'redirect', 'none']).describe('What the address serves'),
            target: z.string().optional().describe('"owner/file.html" for app; an absolute URL for redirect'),
        },
        annotationsFor('aimeat_company_front_page'),
        async ({ company_id, kind, target }) => {
            try {
                const company = await setFrontPage(storage, ownerGhii(), company_id, { kind, target: target ?? '' });
                return ok({ company: wire(company) });
            } catch (e) { return fail(e); }
        },
    );

    // ── aimeat_company_portfolio_publish ──
    mcp.tool(
        'aimeat_company_portfolio_publish',
        descriptionFor('aimeat_company_portfolio_publish'),
        {
            company_id: z.string().describe('Company id from aimeat_company_list'),
            html: z.string().describe('The complete HTML document to serve at the company address'),
        },
        annotationsFor('aimeat_company_portfolio_publish'),
        async ({ company_id, html }) => {
            try {
                const { company, status } = await publishCompanyPortfolio(
                    config, storage, ownerGhii(), company_id, html,
                );
                return ok({ company: wire(company), portfolio: status });
            } catch (e) { return fail(e); }
        },
    );
}
