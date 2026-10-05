/**
 * @file commerce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog definitions for the MCP commerce tools (TARGET-033/034 over MCP): seller
 *   PSP credential management (masked — the secret NEVER returns), app-tool manifest publishing +
 *   pricing, agent-offer money pricing, and buyer-side checkout sessions. Every tool wraps an
 *   EXISTING commerce mechanism (commerce.psp / apps.{appId}.tools memory records, the offers
 *   document, src/commerce/session-service.ts) — no new business logic. Money amounts are integer
 *   6-decimal MICRO-UNITS (1 EUR = 1_000_000), morsels are plain integers; the two never mix.
 * @usage import { commerceTools } from './definitions/commerce.js';
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-10-01 — aimeat_commerce_psp_set is screen-only: it refuses and returns the Wallet page link (decision D5).
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.3.1 — 2026-09-27 — aimeat_app_tools_publish: app_id without its extension lands under the app's filename.
 *   v1.3.0 — 2026-09-13 — aimeat_app_tools_publish states the developer's two decisions: a tool and the
 *     extension action it calls list once (DUPLICATE_OF, unless lockedInput), and a publish that makes
 *     an ODPS field too long is refused with ODPS_FIELD_TOO_LONG while unchanged stored text publishes.
 *   v1.2.0 — 2026-09-13 — aimeat_app_tools_publish: `exchange: true` lists an unbound tool with an agent
 *     too (the description said action_id was required), the answer's `exchange` block is named with its
 *     skip reasons and warnings, and the ODPS length caps and SLA units a provider trips over are stated.
 *   v1.1.0 — 2026-07-30 — Beneficiary splitting: declare who shares what a capability earns, read
 *     what you are owed and what you owe, release a share, and record the approval that gates a
 *     payout. The REST surface shipped without an agent surface, so the only way to configure any
 *     of it from a chat was a hand-rolled bearer token.
 *   v1.0.0 — 2026-07-14 — Initial commerce MCP tool definitions (9 tools)
 */
import { BENEFICIARIES_MAX } from '../../models/tool-input-vocabulary.js';
import { itemShape } from '../input-schemas.js';
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const commerceTools = [
    // ── Beneficiary splitting: the SECOND RAKE, out of the seller's own cut ───────
    {
        name: 'aimeat_commerce_beneficiary_split_set',
        description: 'Declare who shares what one of YOUR capabilities earns. A second rake, shaped like the platform one: the platform rake takes a percent of what the BUYER pays, this takes a percent of what YOU earn and routes it to other accounts by weight. The pool comes out of your cut, after the platform rake, NEVER out of the buyer\'s price - declaring a split makes nothing more expensive for anyone, it makes your own revenue land somewhere else. `pool_percent` is how much of your cut leaves you; `weight` divides that pool (two rows at weight 1 split it evenly, 3 and 1 split it 75/25). Set `dynamic: true` when WHO deserves a share depends on what the call was about: the capability then names destinations per call by returning a `_revenue` key, which the node strips before the buyer sees it. That key names destinations ONLY, so it can redirect a share you already committed and can never enlarge its own payout. Always written against YOUR OWN revenue. The coordinate is the metered pair: an extension name, `apptool:{owner}/{appId}`, or `agentwork:{owner}/{agent}`, plus the action id, tool name or task type.',
        caller: 'agent',
        // MCP-server only: no connector REST twin and no CLI handler, so the catalog says so
        // rather than promising surfaces that would 404. (audit-mcp-tools enforces the parity.)
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Declare a Revenue Split', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // aimeat_app_tools_get is intentionally ungated — it reads PUBLIC manifests (own always).
        // Beneficiary splitting. Declaring who shares your revenue, and paying one of them, both move
        // value out of the owner's own pocket, so they sit with the rest of the seller-side config.
        // READING what you are owed is a wallet question, not a selling one: a beneficiary is usually
        // not a seller at all, and gating their own receivables behind commerce:sell would mean an
        // account could be owed money it had no way to see.
        // The word REST asks for on the same four operations (routes/commerce-beneficiaries.ts:187,
        // :250, :314, :444). They used to ask for commerce:sell here — not stricter or looser, simply a
        // different gate, so an owner who withheld exchange:beneficiary still had an agent that could
        // give their revenue away, and an agent granted exchange:beneficiary could not see the tools.
        // services/scope-vocabulary-migration.ts hands the word to agents already holding commerce:sell,
        // so nothing loses a tool it had and nothing gains one it did not.
        scope: 'exchange:beneficiary',
        // On `commerce`: Beneficiary splits: a seller declares who else earns from a sale, releases what accrued
        // and pays it out; the beneficiary reads its own earnings. Selling-side, same as the rest.
        // On `service`: Beneficiary splits: a seller declares who else earns from a sale, releases what accrued
        // and pays it out; the beneficiary reads its own earnings. Selling-side, same as the rest.
        surfaces: ['service', 'commerce'],
        input: {
            ext: { type: 'string', required: true, description: 'Metered coordinate: extension name, apptool:{owner}/{appId}, or agentwork:{owner}/{agent}', zod: z.string().min(1).max(200) },
            action: { type: 'string', required: true, description: 'The action id, tool name, or task type', zod: z.string().min(1).max(200) },
            pool_percent: { type: 'number', description: '0-100: the share of YOUR cut routed to beneficiaries', zod: z.number().min(0).max(100) },
            beneficiaries: { type: 'array', required: false, description: 'Standing beneficiaries: [{ ghii, weight?, note? }]. May be empty when dynamic is true.', zod: z.array(z.object({
                ghii: z.string().min(3).max(200),
                weight: z.number().positive().optional(),
                note: z.string().max(2_000).optional(),
            })).max(BENEFICIARIES_MAX) },
            dynamic: { type: 'boolean', required: false, description: 'Let the capability name destinations per call via the _revenue key' },
            capability: { type: 'string', required: false, description: 'Human label; defaults to "{ext}/{action}"', zod: z.string().max(2_000) },
            state: { type: 'string', required: false, description: 'active (default) or paused', zod: z.enum(['active', 'paused']) },
            roles: { type: 'array', description: 'Roles mode: [{ role, percent, ghii?, note? }]. Percents total at most 100 and nobody dilutes anybody.', zod: z.array(z.object({
                role: z.string().min(1).max(80),
                percent: z.number().positive().max(100),
                ghii: z.string().min(3).max(200).nullable().optional(),
                note: z.string().max(2_000).optional(),
            })).max(BENEFICIARIES_MAX) },
            mode: { type: 'string', description: '"pool" divides one percentage by weight; "roles" gives each named role its own independent percent.', zod: z.enum(['pool', 'roles']) },
        },
    },
    {
        name: 'aimeat_commerce_beneficiary_splits',
        description: 'Every beneficiary split YOU have declared, with its pool percent, whether it accepts per-call destinations, and who shares it. Owner-scoped: your own only, never another seller\'s. Pass `remove_ext` + `remove_action` to WITHDRAW one instead. Future calls then keep your whole cut, while shares already accrued still stand, because what was earned does not un-happen when the arrangement ends.',
        caller: 'agent',
        // MCP-server only: no connector REST twin and no CLI handler, so the catalog says so
        // rather than promising surfaces that would 404. (audit-mcp-tools enforces the parity.)
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Your Revenue Splits', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'exchange:beneficiary',
        surfaces: ['service', 'commerce'],
        input: {
            remove_ext: { type: 'string', required: false, description: 'With remove_action: withdraw this split instead of listing', zod: z.string().max(200) },
            remove_action: { type: 'string', required: false, description: 'With remove_ext: withdraw this split instead of listing', zod: z.string().max(200) },
        },
    },
    {
        name: 'aimeat_commerce_beneficiary_earnings',
        description: 'What YOU have been given a share of, and whether it can be paid yet. A share is owed by the PROVIDER whose call it came from, out of what they earned, not by the buyer. `accrued` means booked and unpaid; the `verification` block is the honest answer to "when do I get this" - false means the amount is real and booked but no operator has verified your account, and it stays booked until one does. Totals are keyed per unit and NEVER summed: a currency code for real money in integer micro-units, and `morsels` for the node\'s pacing meter, which is capacity to call things rather than income. Set `role: "provider"` to see the other side instead: what YOU owe your beneficiaries, each with the tracking code a release needs.',
        caller: 'agent',
        // MCP-server only: no connector REST twin and no CLI handler, so the catalog says so
        // rather than promising surfaces that would 404. (audit-mcp-tools enforces the parity.)
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Beneficiary Shares Owed', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'wallet:read',
        surfaces: ['service', 'commerce'],
        input: {
            role: { type: 'string', required: false, description: 'beneficiary (default) = what you are owed; provider = what you owe', zod: z.enum(['beneficiary', 'provider']) },
            status: { type: 'string', required: false, description: 'accrued | released | reversed', zod: z.enum(['accrued', 'released', 'paid', 'reversed']) },
            limit: { type: 'number', required: false, description: 'Max entries (default 200, max 1000)', zod: z.number().int().min(1).max(1000) },
        },
    },
    {
        name: 'aimeat_commerce_beneficiary_release',
        description: 'Pay one accrued share you owe. Only the provider who owes it can, and only their own obligations. GATED: refuses with BENEFICIARY_UNVERIFIED until an operator has recorded that the beneficiary may be paid, because paying a party nobody has checked is how a self-declared claimant collects on somebody else\'s identity. What release DOES differs by rail, and `settled_here` reports which happened: a morsel share transfers from your balance to theirs and COMPLETES here, because morsels are the node\'s own pacing meter; a money share is booked onto their payable book and the fiat leg is invoiced off-node, because a node that pushed fiat would first have to hold it. Read `settled_here` as "is there anything left to do", never as "which rail is the real one". Idempotent: releasing the same share twice is refused.',
        caller: 'agent',
        // MCP-server only: no connector REST twin and no CLI handler, so the catalog says so
        // rather than promising surfaces that would 404. (audit-mcp-tools enforces the parity.)
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Release a Beneficiary Share', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:beneficiary',
        surfaces: ['service', 'commerce'],
        input: {
            tracking_code: { type: 'string', required: true, description: 'From aimeat_commerce_beneficiary_earnings with role=provider', zod: z.string().min(1).max(200) },
            beneficiary: { type: 'string', required: true, description: 'The beneficiary owner GHII', zod: z.string().min(3).max(200) },
        },
    },
    {
        name: 'aimeat_commerce_beneficiary_approve',
        description: 'OPERATOR ONLY. Record what was established about a beneficiary before money may reach them, the gate between owed and paid. A gate a provider could open for their own payees would not be a gate. `method` says HOW representation was established (suomifi-valtuudet, manual-operator, contract-on-file) and is REQUIRED when verifying: the node keeps no list of acceptable methods, because which evidence suffices is a legal judgement that varies by jurisdiction. `subject` optionally names the external identity the approval attests the account may act for (e.g. fi-ytunnus:3323553-5) and is opaque to the node. Absence of an approval means unverified: the gate fails closed. Omit `state` to READ the current approval instead of setting one; anyone may read their own, another account needs the operator role.',
        caller: 'agent',
        // MCP-server only: no connector REST twin and no CLI handler, so the catalog says so
        // rather than promising surfaces that would 404. (audit-mcp-tools enforces the parity.)
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Approve a Beneficiary for Payout', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The approval gate is operator-only at the handler; the scope keeps a narrow agent from even
        // seeing the tool, so it is not offered to somebody who could never use it.
        // This one tool covers BOTH halves: reading an approval state and recording one. REST splits
        // them (GET wants wallet:read, POST wants the operator role), so the registration gate stays on
        // the read word and the write word is checked inside the handler on the write branch only.
        // Gating the whole tool on the write word would have made an account unable to see whether it
        // may be paid, which is not the thing anyone meant to restrict.
        scope: 'wallet:read',
        surfaces: ['service', 'commerce'],
        input: {
            ghii: { type: 'string', required: false, description: 'Beneficiary owner GHII. Defaults to you when reading.', zod: z.string().min(3).max(200) },
            state: { type: 'string', required: false, description: 'verified | unverified | rejected. Omit to read.', zod: z.enum(['verified', 'unverified', 'rejected']) },
            method: { type: 'string', required: false, description: 'How representation was established. Required when verifying.', zod: z.string().max(120) },
            subject: { type: 'string', required: false, description: 'Namespaced external identity the approval attests to, opaque to the node', zod: z.string().max(200) },
            evidence: { type: 'string', required: false, description: 'Case number, document reference, mandate id', zod: z.string().max(10_000) },
        },
    },
    {
        name: 'aimeat_commerce_beneficiary_payout',
        description: 'Pay a beneficiary what you owe them, onchain. The last leg, and the one no existing payout could do: neither money handler can push a provider\'s funds to a third party (Stripe has no Connect platform here by design, and x402\'s payout is a no-op because the money moved buyer-to-seller at collect time), so a provider-to-beneficiary transfer is a DIFFERENT payment that its payer has to authorise. Call with no `payment` to QUOTE: you get what is owed plus the x402 exact-scheme requirements to sign with the wallet that holds the funds. Sign them, then call again with the signed `payment` to settle. AGGREGATED across everything released and unpaid in one currency, so one signature clears the balance instead of paying gas on every sub-euro share. The quote is rebuilt server-side on settle, so a signature can only move what is genuinely owed at that instant. Entries become `paid` only after the facilitator confirms, so a failed settlement leaves them payable and a confirmation arriving twice cannot pay twice. A beneficiary who has set no payout address returns BENEFICIARY_NO_ADDRESS and the obligation simply stays owed, which is what an unpaid invoice is. The node holds no key and no funds at any instant.',
        caller: 'agent',
        // MCP-server only: no connector REST twin and no CLI handler, so the catalog says so
        // rather than promising surfaces that would 404. (audit-mcp-tools enforces the parity.)
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        annotations: { title: 'Pay a Beneficiary Onchain', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Paying moves value out of the owner's own wallet, so it sits with the seller-side config
        // rather than with the reads.
        // POST /v1/commerce/beneficiary/payout asks for exchange:beneficiary (:444); the quote GET asks
        // for wallet:read (:411). One tool covers both, so it takes the write word — a caller who may
        // only read a quote can use the earnings tool, which is already gated on wallet:read.
        scope: 'exchange:beneficiary',
        surfaces: ['service', 'commerce'],
        input: {
            beneficiary: { type: 'string', required: true, description: 'The beneficiary owner GHII you owe.', zod: z.string().min(3).max(200) },
            currency: { type: 'string', required: false, description: 'Defaults to EUR.', zod: z.string().max(10) },
            payment: { type: 'object', required: false, description: 'The signed x402 exact-scheme payload. Omit to quote.' },
        },
    },
    {
        name: 'aimeat_commerce_psp_set',
        description: 'SCREEN ONLY: refuses for an agent, and returns the link to the Wallet page where the owner enters their payment-provider secret themselves (a key that moves money never passes through a chat). Call it only to get that link; do not ask the owner for the key. Money sales always settle on the SELLER\'s own PSP account, never the node\'s. aimeat_commerce_psp_status shows whether one is set, as a masked hint. Morsel-only selling needs no PSP.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Set Seller PSP Credentials', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Commerce (TARGET-033/034 over MCP). NOTE: the REST commerce routes are requireAuth-only
        // today — these MCP tools are gated STRICTER than REST on purpose (selling config touches
        // PSP secrets; buying spends the owner's balance). commerce:sell = seller-side config (PSP,
        // app-tool manifests, offer pricing); commerce:buy = spending through checkout sessions.
        // Owner-attached '*' agents get both; granular agents opt in per scope.
        // The seller's payment credentials: an agent that can rewrite these can repoint the payouts.
        // PUT/DELETE /v1/commerce/payout/stripe are owner-only.
        scope: 'commerce:psp',
        // On `service`: Commerce, both sides: a marketplace/provider agent sells (PSP credentials, app-tool
        // manifests, offer pricing) and buys (checkout) on the same commerce core.
        surfaces: ['service', 'commerce'],
        input: {
            provider: { type: 'string', required: true, description: 'PSP identifier, e.g. "stripe"', zod: z.string().min(1).max(60) },
            secret_key: { type: 'string', required: true, description: 'The PSP secret credential (stored, never echoed back)', zod: z.string().min(4).max(500) },
            webhook_secret: { type: 'string', required: false, description: 'Stripe endpoint signing secret for this seller\'s webhook. Stored encrypted, never echoed back', zod: z.string().max(500) },
        },
    },
    {
        name: 'aimeat_commerce_psp_status',
        description: 'Check whether YOUR OWNER has PSP credentials configured for money selling. Returns configured true/false, the provider name, and a masked key hint (last 4 characters) — NEVER the secret itself.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Check PSP Status (masked)', readOnlyHint: true },
        scope: 'commerce:sell',
        surfaces: ['service', 'commerce'],
        input: {},
    },
    {
        name: 'aimeat_commerce_psp_delete',
        description: 'Delete YOUR OWNER\'s stored PSP credentials (commerce.psp). Money-currency checkouts of your offers/app-tools stop working until new credentials are set; morsel selling is unaffected.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Seller PSP Credentials', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'commerce:psp',
        surfaces: ['service', 'commerce'],
        input: {},
    },
    {
        name: 'aimeat_app_tools_publish',
        description: 'Publish or replace the sellable TOOL MANIFEST of one of your owner\'s apps (the public memory record apps.{app_id}.tools) so agents can buy tool calls through the commerce checkout. Each tool: name (sku segment), description, inputSchema, price {morsels} and/or priceMoney {amount in 6-decimal MICRO-UNITS (1 EUR = 1000000), currency EUR|USD}, and a fulfillment binding — action_id (a capability id, runs instantly on purchase) or agent (bare name of your owner\'s agent that receives the order TASK; neither = the task lands in the owner\'s task space). Set `exchange: true` on a tool to list it on the EXCHANGE marketplace: it lists when it has a non-empty inputSchema AND outputSchema, a price, and either action_id (sold per call) or agent (sold per delivered task). The answer\'s `exchange` block says what became of every flagged tool: `listed` with the offering id, `skipped` with the reason (SCHEMA_REQUIRED, NOT_PRICED, NO_ASSIGNEE, ASSIGNEE_NOT_FOUND, DUPLICATE_OF), and `warnings`. One call is listed ONCE: when a tool calls an extension action that is flagged for EXCHANGE too, the tool lists and the action\'s own listing is withdrawn (it appears in `skipped` as DUPLICATE_OF {app}/{tool}, and contracts already signed on it keep their agreed price), unless the tool fixes part of its input with `lockedInput`, which makes it a different product: then both list and each carries an ALSO_LISTED_AS warning. Read that block before saying a tool is on the market. PUBLISHING AN APP: fill the ODPS descriptor in the same call — per-tool `odps` (valueProposition, categories, standards, useCases, contentSample URL, productType, SLA + dataQuality commitments) plus app-level `odps`/`provenance` defaults inherited by every tool (dataHolder legal entity, logoURL, brandSlogan, governanceProfile, portfolioPriority, licence jurisdiction). Those become the tool\'s Open Data Product Specification v4.1 document at /v1/exchange/offerings/{id}/odps.yaml, which is how outside catalogues and negotiating agents read the listing. ODPS caps some of it: valueProposition 512 characters, the other licence texts and dataHolder description 512, dataHolder legalName and slogan 256, and license restrictions 255, which holds the node\'s own usage-terms sentences (up to 120 characters) followed by usageTerms.note and odps.license.restrictions. A publish that makes one of those too long is REFUSED with ODPS_FIELD_TOO_LONG and nothing is saved; the refusal names the field you wrote, the ODPS field, its length, the cap and the room you have, and the node never shortens the text for you. Text already stored that way keeps publishing, with an ODPS_FIELD_TOO_LONG warning, until you change it. SLA units come from the ODPS list (percent, milliseconds, seconds, minutes, days, weeks, months, years, never, date) and it has no hours unit, so 3 hours is written as 180 minutes. State provenance from what you KNOW about the data; where a legal basis or a legal entity is not established, leave it out for the owner to state. Priced tools list in /v1/commerce/feed, /v1/commerce/tools, the MCP Server Card, and the WebMCP interface. Replaces the whole manifest — read it first (aimeat_app_tools_get) to edit incrementally.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Publish App Tool Manifest', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // commerce:sell, and the word POST /v1/memory asks, where the tool manifest is written (secaudit 2026-10 follow-up, A4).
        scope: ['commerce:sell', 'memory:write'],
        surfaces: ['service', 'commerce'],
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename (e.g. "shop.html") — the manifest key is apps.{app_id}.tools. A name without the extension ("shop") is stored under your app "shop.html" when you have one, and the answer names the filename.' },
            tools: { type: 'array', required: true, description: 'Full tool list: [{ name, description?, inputSchema?, outputSchema?, action_id?, agent?, exchange?, price?: {morsels, unit?}, priceMoney?: {amount /* micro-units */, currency}, usageTerms?, provenance?, odps? }]' },
            odps: { type: 'object', required: false, description: 'APP-LEVEL ODPS defaults inherited by every tool: { language, dataHolder: {legalName, businessID, email, URL, addressCountry}, logoURL, brandSlogan, governanceProfile, portfolioPriority, license: {geographicalArea, applicableLaws} }. A tool\'s own `odps` overrides these field by field.' },
            provenance: { type: 'object', required: false, description: 'APP-LEVEL provenance defaults inherited by every tool: { source, legalBasis, consentStatus, retention, transformations, snapshotHash (SHA-256 hex), lineage: [{source, transform, at}] }. State only what you know.' },
        },
    },
    {
        name: 'aimeat_app_tools_get',
        description: 'Read an app\'s sellable tool manifest (apps.{app_id}.tools). Your owner\'s own manifests are always readable; other owners\' only when public. Returns the tools with prices (morsels; money in 6-decimal micro-units), fulfillment mode (call | task), and the checkout skus.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read App Tool Manifest', readOnlyHint: true },
        // On `agent`: Commerce, buyer side: the owner's personal agent buys priced offers/app-tools.
        surfaces: ['agent', 'service', 'commerce'],
        input: {
            app_id: { type: 'string', required: true, description: 'The app\'s published filename', zod: z.string().min(1).max(120) },
            owner: { type: 'string', required: false, description: 'App owner (bare name). Default: your own owner', zod: z.string().min(1).max(100) },
        },
    },
    {
        name: 'aimeat_offer_price_set',
        description: 'Set or clear the price of one offer on YOUR OWNER\'s agent (the agents.{name}.offers document): morsel price (integer) and/or money price (amount in 6-decimal MICRO-UNITS — 1 EUR = 1000000, 0.002 EUR = 2000 — plus currency EUR|USD; needs the seller\'s PSP configured to actually settle), and optionally the offer\'s visibility (public = listed in the commerce feed). Cross-owner purchase requires a price; your owner\'s own use stays free.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Price an Agent Offer', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'commerce:sell',
        surfaces: ['service', 'commerce'],
        input: {
            agent_name: { type: 'string', required: true, description: 'Bare name of your owner\'s agent that publishes the offer' },
            offer_id: { type: 'string', required: true, description: 'The offer id inside agents.{agent_name}.offers' },
            price_morsels: { type: 'number', required: false, description: 'Morsel price per call (integer, >0). Omit to leave unchanged' },
            money_amount_micros: { type: 'number', required: false, description: 'Money price in integer 6-decimal MICRO-UNITS (never cents/floats). Omit to leave unchanged' },
            money_currency: { type: 'string', required: false, description: 'ISO code for money_amount_micros: EUR or USD', enum: ['EUR', 'USD'] },
            clear_morsels: { type: 'boolean', required: false, description: 'Remove the morsel price' },
            clear_money: { type: 'boolean', required: false, description: 'Remove the money price' },
            visibility: { type: 'string', required: false, description: 'Offer visibility: private | unlisted | public', enum: ['private', 'unlisted', 'public'] },
        },
    },
    {
        name: 'aimeat_checkout_open',
        description: 'Open a checkout session as a BUYER (your owner\'s balance pays — one morsel balance per human). Line items: agent offers ({agent: GAII or bare own name, offer_id}) or app-tools ({kind: "app-tool", app: "ownerName/appId", tool, input? — one call per line item}). All items must share one seller. currency: omit for morsels, or EUR/USD when the item has a money price and the node has a settling handler. Returns the open session with the quoted total; complete it with aimeat_checkout_complete.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Open Checkout Session', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'commerce:buy',
        surfaces: ['agent', 'service', 'commerce'],
        input: {
            items: { type: 'array', required: true, description: '[{ kind?, agent?, offer_id?, app?, tool?, input?, quantity? }] — offer items need agent+offer_id; app-tool items need kind:"app-tool"+app+tool', zod: itemShape },
            note: { type: 'string', required: false, description: 'Buyer note delivered with the order', zod: z.string().max(2000) },
            currency: { type: 'string', required: false, description: '"morsel" (default) or a money code (EUR/USD)', zod: z.string().min(3).max(10) },
        },
    },
    {
        name: 'aimeat_checkout_complete',
        description: 'Pay + fulfill an open checkout session. Charges your owner\'s balance (or a money handler when specified), then fulfills: offers and unbound app-tools queue a TASK for the seller; a callable app-tool runs instantly and its result returns on fulfillment.results. A failed callable invoke refunds automatically and leaves the session open. Returns the completed session with the receipt {charged, earned, fee, trackingCode}.',
        caller: 'agent',
        visibility: agentEverywhere,
        // destructiveHint: spends the owner's balance (irreversible financial action); openWorldHint:
        // a callable app-tool's fulfillment may invoke sandboxed/third-party capability code.
        annotations: { title: 'Complete Checkout (pay + fulfill)', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        scope: 'commerce:buy',
        surfaces: ['agent', 'service', 'commerce'],
        input: {
            session_id: { type: 'string', required: true, description: 'The open session id from aimeat_checkout_open', zod: z.string().min(1).max(120) },
            handler: { type: 'string', required: false, description: 'Payment handler id (default io.aimeat.morsels)', zod: z.string().max(100) },
        },
    },
    {
        name: 'aimeat_checkout_list',
        description: 'List your owner\'s checkout sessions (purchases), newest first — status, items, totals, receipts, and fulfillment (task ids / callable results).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List My Checkout Sessions', readOnlyHint: true },
        scope: 'commerce:buy',
        surfaces: ['agent', 'service', 'commerce'],
        input: {
            limit: { type: 'number', required: false, description: 'Max sessions to return (default 20, max 200)', zod: z.number().int().min(1).max(200) },
        },
        supportsResponseFormat: true,
        conciseFields: ['id', 'status', 'total', 'currency', 'sellerOwner', 'createdAt'],
    },
] as const satisfies readonly AimeatToolDefinition[];
