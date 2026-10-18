/**
 * @file src/tool-dispatch/tool-call-defs-companies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's companies and the two public pages on the CLI dispatch (`aimeat connect
 *   call` and `POST /local/call/<tool>`): list, register, fill in the details, choose what the
 *   company address serves, publish the company page, and publish the person's own welcome page.
 *   Thin REST proxies over /v1/companies/* (src/routes/companies.ts) and PUT /v1/portfolio/upload
 *   (src/routes/portfolio.ts), so both interfaces enforce the same rules: slug arbitration, "the
 *   front-page app must be YOURS", the page size cap.
 *
 *   Until 2026-10-12 these six tools had a handler only on the connector MCP
 *   (src/cli/connect/mcp/tools/companies.ts and portfolio.ts), so a fleet daemon and crew code could
 *   not call them. The handlers moved here unchanged in what they send; the connector MCP runs them
 *   through dispatch-tools.ts.
 * @structure companyCliTools[] — the handler table, spread by index.ts
 * @usage import { companyCliTools } from './tool-call-defs-companies.js';
 * @version-history
 *   v1.1.1 — 2026-10-18 — aimeat_portfolio_publish without `html` lets the node answer the missing page.
 *   v1.1.0 — 2026-10-18 — aimeat_company_front_page and aimeat_portfolio_publish forward `access` (who may
 *     open the page); without `html` the welcome-page tool writes it through PUT /v1/portfolio/config (V3.10).
 *   v1.0.0 — 2026-10-12 — Moved from the connector MCP modules (wish: every MCP tool on aimeat connect serve).
 */
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { query, requiredString, optionalNumber, withProvenanceFields } from './tool-call-helpers.js';

/** Wire name → the record field the GET returns, for the merge in aimeat_company_update. */
const RECORD_FIELD: Record<string, string> = {
    description: 'description', organism_id: 'organismId',
    business_id: 'businessId', vat_id: 'vatId',
    street_address: 'streetAddress', postal_code: 'postalCode', city: 'city', country: 'country',
    email: 'email', phone: 'phone', iban: 'iban', bic: 'bic',
    einvoice_address: 'einvoiceAddress', einvoice_operator: 'einvoiceOperator',
};

/** Only the keys the caller actually sent, so nothing unmentioned is carried as an empty string. */
function sentFields(input: JsonObject): JsonObject {
    const out: JsonObject = {};
    for (const wire of Object.keys(RECORD_FIELD)) {
        const v = input[wire];
        if (v !== undefined) out[wire] = v;
    }
    return out;
}

export const companyCliTools: ConnectCliToolDefinition[] = [
    {
        // → GET /v1/companies
        name: 'aimeat_company_list',
        handler: ({ client }, input) => client.get(`/v1/companies${query({
            page: optionalNumber(input, 'page'),
            per_page: optionalNumber(input, 'per_page'),
        })}`),
    },
    {
        // → POST /v1/companies — the route records how the description was made (a
        //   recorded-by-route carrier in ai-provenance-carry.ts), so the declaration goes in the body.
        name: 'aimeat_company_create',
        handler: ({ client }, input) => {
            const slug = input.slug;
            return client.post('/v1/companies', withProvenanceFields({
                name: requiredString(input, 'name'),
                ...(slug ? { slug } : {}),
                ...sentFields(input),
            }, input));
        },
    },
    {
        // → GET then PUT /v1/companies/:id. PUT replaces, so the current record is read and the
        //   sent fields are merged onto it: an update that gathers details over several turns must
        //   not blank what an earlier turn set. The node MCP tool does the same merge; sending only
        //   the mentioned fields here would make the interfaces disagree in the dangerous direction
        //   (a one-field correction removing an IBAN).
        name: 'aimeat_company_update',
        handler: async ({ client }, input) => {
            const id = encodeURIComponent(requiredString(input, 'company_id'));
            const current = await client.get(`/v1/companies/${id}`);
            if (current.ok === false) return current;
            const company = ((current.data as { company?: Record<string, unknown> })?.company) ?? {};
            let body: JsonObject = { name: input.name ?? company.name };
            for (const [wireName, recordName] of Object.entries(RECORD_FIELD)) {
                // The description travels only when the caller wrote one: a description sent is a
                // new one, and the route records its provenance (the node keeps a field it is not sent).
                if (wireName === 'description') continue;
                const v = company[recordName];
                if (v !== undefined && v !== null) body[wireName] = v;
            }
            const patch = sentFields(input);
            Object.assign(body, patch);
            if ('description' in patch) body = withProvenanceFields(body, input);
            const resp = await client.put(`/v1/companies/${id}`, body);
            if (resp.ok === false) return resp;
            return { ...resp, data: { ...(resp.data as object), updated_fields: Object.keys(patch) } };
        },
    },
    {
        // → PUT /v1/companies/:id/front-page
        name: 'aimeat_company_front_page',
        handler: ({ client }, input) => client.put(`/v1/companies/${encodeURIComponent(requiredString(input, 'company_id'))}/front-page`, {
            ...(input.kind !== undefined ? { kind: input.kind } : {}),
            ...(input.target !== undefined ? { target: input.target } : {}),
            ...(input.access !== undefined ? { access: input.access } : {}),
        }),
    },
    {
        // → PUT /v1/companies/:id/portfolio — publishes the page and points the address at it.
        name: 'aimeat_company_portfolio_publish',
        handler: ({ client }, input) => client.put(`/v1/companies/${encodeURIComponent(requiredString(input, 'company_id'))}/portfolio`, {
            html: requiredString(input, 'html'),
        }),
    },
    {
        // → PUT /v1/portfolio/upload — the person's own welcome page. The route validates the
        //   document, stores it as the owner's portfolio.html and enables the page unless `enable`
        //   is false, so the page has one rule on every interface.
        name: 'aimeat_portfolio_publish',
        //   Without `html` it changes only who may open the page: PUT /v1/portfolio/config with `access`.
        handler: ({ client }, input) => {
            const access = input.access !== undefined ? { access: input.access } : {};
            if (input.html === undefined && input.access !== undefined) return client.put('/v1/portfolio/config', access);
            // Without html the node answers the missing page itself (400), as it does on the node MCP.
            const html = input.html === undefined ? {} : { html: requiredString(input, 'html') };
            return client.put('/v1/portfolio/upload', { ...html, ...(input.enable === undefined ? {} : { enable: input.enable }), ...access });
        },
    },
];
