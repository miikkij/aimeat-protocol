/**
 * @file companies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for the company registry — a thin layer over the same service core the
 *   REST /v1/companies routes use, so both surfaces enforce identical rules (slug arbitration,
 *   "the front-page app must be YOURS", the portfolio size cap).
 *
 *   Identity: companies belong to the OWNER, so every call resolves the agent's owner GHII and
 *   never a client-supplied id — an agent manages the same companies its owner does, and can
 *   reach no one else's. Absent and not-yours answer identically.
 *
 * @structure registerCompanyTools(mcp, storage, config, getAgentGaii, scopes, caller) — registers
 *   aimeat_company_list, _create, _update, _front_page, _portfolio_publish.
 * @usage import { registerCompanyTools } from './companies.js';
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-18 — aimeat_company_front_page takes `access` (who may open the front page; `kind` may be left
 *     out to change only that), and a company answers `front_page_access` (V3.10).
 *   2026-10-18 — aimeat_company_front_page and aimeat_company_portfolio_publish pass the publish gate
 *     (services/company/company-publish-gate.ts): an agent without publish:public pointing an address that serves
 *     nothing at a page gets `publish_request`, the page stored and the address left as it was (V4).
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   2026-10-08 — aimeat_company_portfolio_publish passes the agent as the page's writer (AI provenance).
 *   2026-10-05 — aimeat_company_create and aimeat_company_update take ai_provenance and ai_provenance_id
 *     for the description and answer the record (secaudit 2026-10, M3 follow-up; the developer's decision).
 *     The update no longer sends the current description back, so only a new one gets a new record.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-08 — Initial: the company setup an AI chat can drive end to end.
 *   v1.0.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { withCaughtError } from './tool-fault.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CompanyRecord } from '../models/company-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { localAccountName } from '../utils/gaii.js';
import {
    CompanyError, createCompany, updateCompany, requireOwnCompany, companyAddress,
    type CompanyProvenanceInput,
} from '../services/company/company-service.js';
import { toDeclaredProvenance, type AiProvenanceToolInput } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { setCompanyFrontPageGated, publishCompanyPortfolioGated } from '../services/company/company-publish-gate.js';
import { publishAskedFields } from '../services/app-publish-gate.js';
import type { CallerContext } from '../services/caller-context.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { IDENTITY_FIELDS } from '../tool-catalog/definitions/companies.js';
import { parsePageAccessInput, pageAccessOf } from '../services/page-access.js';
import { toolError } from './tool-error.js';

type IdentityInput = { [K in keyof typeof IDENTITY_FIELDS]?: string };

/**
 * Wire names → record names. Only keys the caller actually sent are returned, so an update
 * never blanks a field the conversation did not mention.
 */
function toRecordFields(input: IdentityInput): Record<string, string> {
    const map: Record<keyof IdentityInput, string> = {
        description: 'description', organism_id: 'organismId',
        business_id: 'businessId', vat_id: 'vatId',
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
    /** The session's scopes: declaring how a description was made needs provenance:write there too. */
    scopes: readonly string[],
    /** The session's caller, for the publish gate a front page passes (services/company/company-publish-gate.ts). */
    caller: () => CallerContext,
): void {
    /** The description's provenance input, for the agent writing it. */
    const provenanceOf = (ai_provenance: AiProvenanceToolInput | undefined, ai_provenance_id: string | undefined): CompanyProvenanceInput => ({
        config, principal: getAgentGaii(), scopes, pipeline: 'mcp.company',
        ...(ai_provenance ? { declared: toDeclaredProvenance(ai_provenance) } : {}),
        ...(ai_provenance_id ? { declaredId: ai_provenance_id } : {}),
    });

    /** Companies belong to the OWNER — resolve the agent's owner GHII, never a client-supplied id. */
    const ownerGhii = (): string => {
        const owner = localAccountName(getAgentGaii());
        return owner.includes('@') ? owner : `${owner}@${config.nodeId}`;
    };

    const wire = (c: CompanyRecord): Record<string, unknown> => ({
        ...c, address: companyAddress(config, c), co_origin_enabled: config.coOriginEnabled,
        front_page_access: pageAccessOf(c.frontPageAccess),
    });

    /** CompanyError carries the code the REST surface reports; keep the same words here. */
    const fail = (e: unknown): { content: { type: 'text'; text: string }[]; isError: true } => withCaughtError({
        content: [{
            type: 'text' as const,
            text: e instanceof CompanyError
                ? `${e.code}: ${e.message}`
                : ((e as Error)?.message || 'Company operation failed'),
        }],
        isError: true as const,
    }, e);
    const ok = (payload: unknown): { content: { type: 'text'; text: string }[] } => ({
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    });

    // ── aimeat_company_list ──
    mcp.registerTool(
        'aimeat_company_list',
        {
            description: descriptionFor('aimeat_company_list'),
            inputSchema: zodShapeFor('aimeat_company_list'),
            annotations: annotationsFor('aimeat_company_list'),
        },
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
    mcp.registerTool(
        'aimeat_company_create',
        {
            description: descriptionFor('aimeat_company_create'),
            inputSchema: zodShapeFor('aimeat_company_create'),
            annotations: annotationsFor('aimeat_company_create'),
        },
        async ({ name, slug, ai_provenance, ai_provenance_id, ...identity }) => {
            try {
                // routes/companies.ts emits on every mutation, and the companies tab re-fetches
                // only when the change carries this domain (companies-tab.js). Without it a company
                // an agent registered was invisible on the owner's screen until a reload.
                emitChange('companies');
                const company = await createCompany(storage, ownerGhii(), {
                    name, slug, ...toRecordFields(identity as IdentityInput),
                } as never, provenanceOf(ai_provenance, ai_provenance_id));
                return ok({ company: wire(company), ...(await writeProvenanceEcho(storage, config, company.descriptionProvenanceId ?? undefined)) });
            } catch (e) { return fail(e); }
        },
    );

    // ── aimeat_company_update ──
    mcp.registerTool(
        'aimeat_company_update',
        {
            description: descriptionFor('aimeat_company_update'),
            inputSchema: zodShapeFor('aimeat_company_update'),
            annotations: annotationsFor('aimeat_company_update'),
        },
        async ({ company_id, name, ai_provenance, ai_provenance_id, ...identity }) => {
            try {
                // Merge onto the CURRENT record so unmentioned fields keep their value: an update
                // that gathers details over several turns must not blank what an earlier turn set.
                const current = await requireOwnCompany(storage, ownerGhii(), company_id);
                const patch = toRecordFields(identity as IdentityInput);
                emitChange('companies');
                // The description is left out unless the caller sent one: the service keeps a field it
                // is not given, and a description it IS given gets a new provenance record.
                const company = await updateCompany(storage, ownerGhii(), company_id, {
                    name: name ?? current.name,
                    organismId: current.organismId,
                    businessId: current.businessId, vatId: current.vatId,
                    streetAddress: current.streetAddress, postalCode: current.postalCode,
                    city: current.city, country: current.country,
                    email: current.email, phone: current.phone,
                    iban: current.iban, bic: current.bic,
                    einvoiceAddress: current.einvoiceAddress, einvoiceOperator: current.einvoiceOperator,
                    ...patch,
                } as never, provenanceOf(ai_provenance, ai_provenance_id));
                const wroteDescription = 'description' in patch;
                return ok({
                    company: wire(company), updated_fields: Object.keys(patch),
                    ...(wroteDescription ? await writeProvenanceEcho(storage, config, company.descriptionProvenanceId ?? undefined) : {}),
                });
            } catch (e) { return fail(e); }
        },
    );

    // ── aimeat_company_front_page ──
    mcp.registerTool(
        'aimeat_company_front_page',
        {
            description: descriptionFor('aimeat_company_front_page'),
            inputSchema: zodShapeFor('aimeat_company_front_page'),
            annotations: annotationsFor('aimeat_company_front_page'),
        },
        async ({ company_id, kind, target, access: accessIn }) => {
            try {
                if (kind === undefined && accessIn === undefined) return toolError('INVALID_FRONT_PAGE', 'Send kind, access, or both.');
                // Who may open the front page (services/page-access.ts), checked for the owner before any write.
                const access = accessIn === undefined ? undefined : await parsePageAccessInput(storage, accessIn, { identity: ownerGhii() });
                if (access && 'refusal' in access) return toolError(access.refusal.code, access.refusal.message);
                // Through the publish gate, as PUT /v1/companies/:id/front-page (services/company/company-publish-gate.ts).
                const { company, asked } = await setCompanyFrontPageGated({ storage, config }, { caller: caller() },
                    ownerGhii(), company_id, kind ? { kind, target: target ?? '' } : null, access?.store);
                return ok({ company: wire(company), ...publishAskedFields(asked) });
            } catch (e) { return fail(e); }
        },
    );

    // ── aimeat_company_portfolio_publish ──
    mcp.registerTool(
        'aimeat_company_portfolio_publish',
        {
            description: descriptionFor('aimeat_company_portfolio_publish'),
            inputSchema: zodShapeFor('aimeat_company_portfolio_publish'),
            annotations: annotationsFor('aimeat_company_portfolio_publish'),
        },
        async ({ company_id, html }) => {
            try {
                const { company, status, asked } = await publishCompanyPortfolioGated({ storage, config }, { caller: caller() },
                    ownerGhii(), company_id, html,
                    { principal: getAgentGaii(), pipeline: 'mcp.company_portfolio_publish' },
                );
                return ok({ company: wire(company), portfolio: status, ...publishAskedFields(asked) });
            } catch (e) { return fail(e); }
        },
    );
}
