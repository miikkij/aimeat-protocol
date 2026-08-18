/**
 * @file companies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entries for the company registry tools. A company on AIMEAT is a
 *   first-class entity the way an app is: registering one reserves {slug}.co.<apex>, and the
 *   record carries the legal identity every invoice prefills its seller party from.
 *
 *   These exist so an AI chat with the AIMEAT MCP can do the whole setup conversationally —
 *   register the company, fill in the business id / VAT id / address / bank details, publish a
 *   page, and point the address at it — instead of the founder retyping the same nine fields
 *   into a form. The copy-prompt buttons in the profile's Companies tab hand a chat exactly
 *   this workflow.
 *
 * @structure companyTools: AimeatToolDefinition[]
 * @usage import { companyTools } from './definitions/companies.js';
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial: list/get/create/update/front_page/portfolio_publish.
 */
import type { AimeatToolDefinition } from './types.js';

/** Shared across create and update — the seller-party snapshot an invoice reads. */
const IDENTITY_FIELDS: AimeatToolDefinition['input'] = {
    business_id: { type: 'string', description: 'Company registration number (Finnish Y-tunnus, e.g. "1234567-8").' },
    vat_id: { type: 'string', description: 'VAT number (e.g. "FI12345678").' },
    street_address: { type: 'string', description: 'Street address of the registered office.' },
    postal_code: { type: 'string', description: 'Postal code.' },
    city: { type: 'string', description: 'City.' },
    country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code, exactly two letters (e.g. "FI").' },
    email: { type: 'string', description: 'Contact email shown to customers.' },
    phone: { type: 'string', description: 'Contact phone.' },
    iban: { type: 'string', description: 'Bank account in IBAN form — this is what an invoice tells the buyer to pay into.' },
    bic: { type: 'string', description: 'Bank BIC/SWIFT.' },
    einvoice_address: { type: 'string', description: 'E-invoice address (Finnish OVT identifier) if the company receives e-invoices.' },
    einvoice_operator: { type: 'string', description: 'E-invoice operator/intermediary id (often a bank BIC, e.g. "NDEAFIHH").' },
    description: { type: 'string', description: 'One or two sentences about what the company does.' },
};

export const companyTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_company_list',
        description: "The owner's registered companies, each with its id, slug, public address ({slug}.co.<apex>), front-page setting, and legal-identity fields. Start here: every other company tool takes the id from this list. An empty list means the owner has not registered a company yet — aimeat_company_create is the first step.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            page: { type: 'number', description: 'Page number (default 1).' },
            per_page: { type: 'number', description: 'Companies per page (default 50, max 100).' },
        },
    },
    {
        name: 'aimeat_company_create',
        description: "Register a company, which immediately reserves its public address {slug}.co.<apex> — the same way publishing an app reserves an apps subdomain. The slug is derived from the name unless given; a taken name answers SLUG_TAKEN and a reserved infrastructure label answers SLUG_RESERVED, so pick another and retry rather than treating it as a failure. Supplying the legal-identity fields here saves a follow-up aimeat_company_update, and they are what every later invoice prefills its seller party from.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            name: { type: 'string', required: true, description: 'Trade name as it should appear on invoices (e.g. "Perustaja Oy").' },
            slug: { type: 'string', description: 'Address label. Defaults to a normalised form of the name (ä→a, ö→o, spaces→hyphens).' },
            ...IDENTITY_FIELDS,
        },
    },
    {
        name: 'aimeat_company_update',
        description: "Fill in or correct a company's details. Every field is optional and only the ones passed are written, so this is safe to call repeatedly as a conversation gathers information — ask the owner for what is missing, then write just that. Passing an empty string clears a field. These values become the seller party on every invoice and the supplier block in the Finvoice e-invoice, so they must be the real registered details rather than plausible-looking ones: leave a field out when the owner has not stated it.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            company_id: { type: 'string', required: true, description: 'Company id from aimeat_company_list.' },
            name: { type: 'string', description: 'Trade name (the address is not renamed by this).' },
            ...IDENTITY_FIELDS,
        },
    },
    {
        name: 'aimeat_company_front_page',
        description: "Choose what the company's address serves: 'app' serves one of the OWNER'S OWN published apps (target \"owner/file.html\"; someone else's answers FRONT_PAGE_NOT_YOURS), 'portfolio' serves the page published with aimeat_company_portfolio_publish, 'redirect' sends visitors to an absolute http(s) URL, and 'none' keeps the address reserved while serving nothing. Choosing 'portfolio' before a page exists answers NO_PORTFOLIO — publish first.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            company_id: { type: 'string', required: true, description: 'Company id from aimeat_company_list.' },
            kind: { type: 'string', required: true, enum: ['app', 'portfolio', 'redirect', 'none'], description: 'What the address serves.' },
            target: { type: 'string', description: '"owner/file.html" for kind app; an absolute URL for kind redirect; omit for portfolio and none.' },
        },
    },
    {
        name: 'aimeat_company_portfolio_publish',
        description: "Publish a standalone HTML page as the company's public front page and point the address at it in one act. Send the WHOLE document (doctype through </html>) — it is served as-is on an isolated, session-less origin, so everything it needs must be inside it or loaded from this node. Style it with the node's theme variables rather than hardcoded colours so it follows light and dark mode, and keep it under the node's portfolio size limit (512KB by default). Re-publishing replaces the previous page.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            company_id: { type: 'string', required: true, description: 'Company id from aimeat_company_list.' },
            html: { type: 'string', required: true, description: 'The complete HTML document to serve at the company address.' },
        },
    },
    {
        name: 'aimeat_portfolio_publish',
        description: "Publish this person's own welcome page — the page at their address, which is also their portfolio. Use it when they ask you to make their page, improve it, or change what it says: you write the HTML and publish it, they never copy or paste anything. Send the WHOLE document (doctype through </html>); it is served as-is on an isolated, session-less origin, so everything it needs must be inside it or loaded from this node. Style it with the node's theme variables rather than hardcoded colours so it follows light and dark mode. Re-publishing replaces the previous page, so read what is there first if they asked for a change rather than a rewrite. This is the person's page; the company equivalent is aimeat_company_portfolio_publish.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        input: {
            html: { type: 'string', required: true, description: "The complete HTML document to serve as this person's welcome page." },
        },
    },
];
