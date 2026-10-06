/**
 * @file exchange.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog definitions for the MCP EXCHANGE marketplace tools (TARGET-045 over MCP): the
 *   two-sided data-service market — browse OFFERINGs, read one offering's full detail (I/O schema +
 *   call-recipe + usage stats), ACCEPT a contract → mint a metered entitlement, list/pause/revoke the
 *   caller's own contracts, post + browse NEEDs, BID on a need, accept a bid, and (provider) see who
 *   holds contracts against an offering. Every tool wraps EXISTING logic — the exchange-market service
 *   (listOfferings/matchOfferings/offeringStats/needs/bids) and the metered-entitlement primitive
 *   (createEntitlement, list/pause/revoke) — mirroring the REST routes in src/routes/exchange*.ts, so
 *   pricing is always AUTHORITATIVE from the provider action (a consumer can never undercut it).
 *   Morsels are plain integers; money is 6-decimal micro-units. The two never mix.
 * @usage import { exchangeTools } from './definitions/exchange.js';
 * @version-history
 *   2026-10-06 — App-tool invocation documents unpriced access and the remaining paid-action checks.
 *   2026-10-06 — aimeat_exchange_accept takes offering_id (ext and action become the other way in), and
 *     aimeat_exchange_need_post takes usage_intent and requires app_id, as their routes do; both carry
 *     the bounds the node's MCP wrote by hand (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.1.2 — 2026-09-19 — aimeat_app_tool_invoke says to read the tool's inputSchema first, and that a
 *     mismatch is refused before charging with every missing field named.
 *   v1.1.1 — 2026-09-03 — Say WHY the six agentMcp tools are off the CLI dispatch, and where a fleet
 *     agent reaches them instead. The bare "Not a CLI fallback" had been read as a missing door twice.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8b: aimeat_exchange_work_deliver documents `ai_provenance`.
 *     The delivered output is the thing the buyer paid for, so how it was made belongs in the terms.
 *   v1.0.0 — 2026-07-20 — Initial EXCHANGE MCP tool definitions (10 tools)
 */
import { z } from 'zod';
import type { AimeatToolDefinition, ToolVisibility } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

/** The "act on EXCHANGE" tools (invoke/work/proposals) are on BOTH MCP surfaces so ANY agent can act: the
 *  PUBLIC /v1/mcp (hosted clients like Claude chat — the server tool threads the session token so app-tool
 *  invoke can run the backing capability) AND the CONNECTOR MCP (`aimeat connect serve` — tunnelled fleet
 *  agents get them as thin REST proxies over the same routes). Not a CLI fallback.
 *
 *  That last sentence is a DECISION, not an omission, and it has been read as a gap twice. These six
 *  are two-sided acts under a metered contract: they charge a budget, settle against a counterparty,
 *  or run a provider's backing capability with the provider's own keys. A fleet agent reaches them
 *  through the connector MCP tool above, which carries the agent's session. `/local/call/<tool>` is
 *  the shell's own dispatch and holds no such session, so a door there would be a second, weaker
 *  implementation of the metering — the one thing `check:mcp-tools` exists to prevent. If a runtime
 *  cannot find `aimeat_app_tool_invoke` on `/local/call/`, it is asking the wrong door: the tool is
 *  registered at src/cli/connect/mcp/tools/exchange.ts. Measured 2026-09-03: 267 of the 300 catalog
 *  entries carry cliFallback and all 267 have a handler; 33 do not, 24 of which are not on the
 *  connector at all, leaving these six plus three owner-account tools. */
const agentMcp: ToolVisibility = { publicMcp: true, connectorMcp: true, cliFallback: false };

export const exchangeTools = [
    {
        name: 'aimeat_exchange_offerings',
        description: 'Browse the EXCHANGE marketplace supply side — data-service OFFERINGs (a provider capability = an extension action, priced authoritatively from the action). With `q` (free text) or an exact `ext`+`action` it matches; otherwise it lists every listed offering, cheapest base price first. `stats:true` folds in each offering\'s usage/reputation (active contracts, calls, distinct consumers) — the "is this actually used?" signal. Public: reading needs no ownership. Read one in full with aimeat_exchange_offering_get, then accept a contract with aimeat_exchange_accept.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Browse Exchange Offerings', readOnlyHint: true },
        // EXCHANGE marketplace (TARGET-045 over MCP). Like commerce, the REST /v1/exchange routes are
        // requireAuth-only today — these MCP tools are gated STRICTER on purpose: accepting/bidding mints
        // durable metered entitlements that authorise (charged) spend on the owner's balance. exchange:read
        // = browse/detail/needs/contracts/lineage; exchange:write = accept/off/post/bid/bid-accept.
        // Owner-attached '*' agents get both; granular agents opt in per scope.
        scope: 'exchange:read',
        // On `service`: EXCHANGE marketplace, both sides: a provider lists/bids/sees lineage; a consumer accepts contracts.
        // On `agent`: EXCHANGE marketplace: browse/accept/post/bid the two-sided data-service market.
        surfaces: ['agent', 'service'],
        input: {
            q: { type: 'string', required: false, description: 'Free-text match over title/description/ext/action/tags.', zod: z.string().max(400) },
            ext: { type: 'string', required: false, description: 'Exact extension name to match (pair with `action`).', zod: z.string().max(120) },
            action: { type: 'string', required: false, description: 'Exact action id to match (pair with `ext`).', zod: z.string().max(120) },
            stats: { type: 'boolean', required: false, description: 'Fold in per-offering usage/reputation stats (default false).' },
        },
    },
    {
        name: 'aimeat_exchange_offering_get',
        description: 'One offering in full — everything needed to decide and integrate: the offering record (pricing, plans, provenance, usage terms), the underlying capability\'s I/O SCHEMA (input_schema / output_schema / toll_morsels), a CALL RECIPE (the accepted contract IS the access — you call POST /v1/ext/{ext}/{action} as yourself, no separate API key), and usage STATS (reputation). Public.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Exchange Offering Detail', readOnlyHint: true },
        scope: 'exchange:read',
        surfaces: ['agent', 'service'],
        input: {
            offering_id: { type: 'string', required: true, description: 'The offering id (e.g. "off-…"), from aimeat_exchange_offerings.', zod: z.string().min(1).max(120) },
        },
    },
    {
        name: 'aimeat_exchange_accept',
        description: 'Accept a contract on an offering → mint a durable METERED ENTITLEMENT for YOU (the caller\'s own identity is the consumer — you can never accept on someone else\'s behalf). The per-call PRICE is read AUTHORITATIVELY from the provider\'s extension action, so you cannot undercut the provider or be charged a price you did not accept; you choose only your BUDGET cap (your own spend ceiling) and a contract ref. Re-accepting the same capability carries prior spend forward (renegotiation, not a meter reset). Morsels are integers; money is 6-decimal micro-units. After this, calling /v1/ext/{ext}/{action} is metered against the budget.',
        caller: 'agent',
        visibility: agentEverywhere,
        // accept mints a durable metered entitlement (idempotent per (consumer, ext, action): re-accepting
        // replaces + carries spend forward, not a new contract each call).
        annotations: { title: 'Accept Exchange Contract', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            // POST /v1/exchange/entitlements and the node's MCP take an offering by id, the way that also
            // reaches an app tool; the catalog named only ext + action, so the connector could not
            // (secaudit 2026-10 follow-up, Part B). One of the two ways is needed.
            offering_id: { type: 'string', required: false, description: 'The offering to accept (aimeat_exchange_offerings lists them). Preferred: it reaches an extension action and an app tool alike. Give this, or ext and action.', zod: z.string().min(1).max(120) },
            ext: { type: 'string', required: false, description: 'The provider extension name, with action, when you accept a raw extension action instead of an offering.', zod: z.string().min(1).max(120) },
            action: { type: 'string', required: false, description: 'The action id on that extension (must be priced). Pair with ext.', zod: z.string().min(1).max(120) },
            contract_ref: { type: 'string', required: false, description: 'Your reference for this contract. Omit to auto-generate one.', zod: z.string().min(1).max(200) },
            cap_units: { type: 'number', required: false, description: 'Budget ceiling in the action\'s unit (morsels or money micro-units). Must cover one charge. Omit = uncapped.', zod: z.number().int().nonnegative() },
            plan_id: { type: 'string', required: false, description: 'A provider-declared plan id (bundle/subscription). Omit = per_call.', zod: z.string().min(1).max(120) },
            app_id: { type: 'string', required: false, description: 'The consuming app id ("owner/filename") when this contract powers an app — shown on the per-app cost view.', zod: z.string().min(1).max(300) },
        },
    },
    {
        name: 'aimeat_exchange_contracts',
        description: 'List every METERED ENTITLEMENT (contract) YOU hold as the consumer — capability, provider, unit, per-call price, rake, contract ref, state (active/paused/revoked), and budget (cap / spent / remaining / calls). The consumer-side ledger of what you are contracted to consume and how much you have spent.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List My Exchange Contracts', readOnlyHint: true },
        scope: 'exchange:read',
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_exchange_contract_off',
        description: 'Your consumer off-switch for ONE of your own contracts: `pause` (reversible — stops metering until resumed by re-accepting) or `revoke` (terminal — the contract no longer authorises and must be re-minted). Only the entitlement\'s own consumer may. Identify the contract by its (ext, action).',
        caller: 'agent',
        visibility: agentEverywhere,
        // pause is reversible; revoke is terminal — the consumer off-switch carries a destructive path.
        annotations: { title: 'Pause / Revoke Exchange Contract', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            ext: { type: 'string', required: true, description: 'The contracted extension name.', zod: z.string().min(1).max(120) },
            action: { type: 'string', required: true, description: 'The contracted action id.', zod: z.string().min(1).max(120) },
            mode: { type: 'string', required: true, description: 'pause (reversible) or revoke (terminal).', enum: ['pause', 'revoke'] },
        },
    },
    {
        name: 'aimeat_exchange_needs',
        description: 'Browse the EXCHANGE demand side — open NEEDs (a consumer/app\'s wanted capability + budget + minimum-output spec that providers bid on). `open:true` for open needs only; `mine:true` for your own needs (any state). Public. Post one with aimeat_exchange_need_post; bid on one with aimeat_exchange_bid.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Browse Exchange Needs', readOnlyHint: true },
        scope: 'exchange:read',
        surfaces: ['agent', 'service'],
        input: {
            open: { type: 'boolean', required: false, description: 'Only open (unmatched, unclosed) needs.' },
            mine: { type: 'boolean', required: false, description: 'Only needs YOU posted (any state).' },
        },
    },
    {
        name: 'aimeat_exchange_need_post',
        description: 'Post a NEED to the marketplace — an open call for a data-service capability. Describe what you want; optionally pin a target `ext`+`action`, a minimum-output `spec` (the shape a fulfilment MUST return, so a provider/AI can judge fit), a `budget_cap` in `budget_unit`, and `autonomy` (supervised = you approve a bid; auto = an agent may close it). Providers browse open needs and BID; the response also lists offerings that already satisfy it (accept directly, no bid needed).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Post Exchange Need', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            description: { type: 'string', required: true, description: 'What you need, in plain language.', zod: z.string().min(1).max(4000) },
            ext: { type: 'string', required: false, description: 'A desired extension name (when you know the exact capability).', zod: z.string().max(120) },
            action: { type: 'string', required: false, description: 'A desired action id (pair with `ext`).', zod: z.string().max(120) },
            spec: { type: 'object', required: false, description: 'Minimum output shape: { requiredFields: string[], format?, sample?, notes? }.' },
            // POST /v1/exchange/needs and the node's MCP read it; the catalog left it out (secaudit 2026-10 follow-up, Part B).
            usage_intent: { type: 'string', required: false, description: 'What you will do with the data, so a provider can judge whether its terms allow it.', zod: z.string().max(2000) },
            budget_unit: { type: 'string', required: false, description: 'Budget unit for `budget_cap`.', enum: ['morsels', 'money'] },
            budget_cap: { type: 'number', required: false, description: 'Budget ceiling (integer; morsels or money micro-units).', zod: z.number().int().nonnegative() },
            // The node's MCP has always required it, and the need is filed under it.
            app_id: { type: 'string', required: true, description: 'The app this need belongs to ("owner/filename").', zod: z.string().min(1).max(300) },
            autonomy: { type: 'string', required: false, description: 'supervised (default) or auto.', enum: ['supervised', 'auto'] },
        },
    },
    {
        name: 'aimeat_exchange_bid',
        description: 'Bid on an open NEED with an action YOUR OWN extension provides (you must own the extension — pricing stays authoritative from your action). Optionally link an existing `offering_id`, pick a `plan_id`, and add a `note`. The requester accepts one bid (aimeat_exchange_bid_accept), which mints the entitlement with you as provider.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Bid on Exchange Need', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            need_id: { type: 'string', required: true, description: 'The open need id (e.g. "need-…").', zod: z.string().min(1).max(120) },
            ext: { type: 'string', required: true, description: 'Your extension name (you must own it).', zod: z.string().min(1).max(120) },
            action: { type: 'string', required: true, description: 'The action id on your extension.', zod: z.string().min(1).max(120) },
            plan_id: { type: 'string', required: false, description: 'A plan id declared on your action (bundle/subscription).', zod: z.string().max(120) },
            note: { type: 'string', required: false, description: 'A note to the requester.', zod: z.string().max(2000) },
            offering_id: { type: 'string', required: false, description: 'Link an existing offering of yours.', zod: z.string().max(120) },
        },
    },
    {
        name: 'aimeat_exchange_bid_accept',
        description: 'As the NEED\'s requester, accept a bid → mint the metered entitlement (consumer = you, provider = the bidder). Price + unit are read authoritatively from the bidder\'s action; you may set `cap_units` (defaults to the need\'s budget cap). Marks the bid accepted and the need matched.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Accept Exchange Bid (mint contract)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            need_id: { type: 'string', required: true, description: 'Your need id.', zod: z.string().min(1).max(120) },
            bid_id: { type: 'string', required: true, description: 'The open bid to accept.', zod: z.string().min(1).max(120) },
            cap_units: { type: 'number', required: false, description: 'Budget ceiling for the minted contract (defaults to the need\'s budget cap).', zod: z.number().int().nonnegative() },
        },
    },
    {
        name: 'aimeat_exchange_consumers',
        description: 'Provider data-lineage for one of YOUR offerings: who holds a contract against it, how many calls they made, how much settled, contract state, and last use — "where is my data used, by whom, and how much?". Provider-only (you must own the offering).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Offering Consumers (provider lineage)', readOnlyHint: true },
        scope: 'exchange:read',
        surfaces: ['agent', 'service'],
        input: {
            offering_id: { type: 'string', required: true, description: 'One of your own offering ids.', zod: z.string().min(1).max(120) },
        },
    },
    {
        name: 'aimeat_app_tool_invoke',
        description: 'CALL a published app tool (a method like getCompanyBrief). Unpriced tools need no contract; priced tools require your contract for this app-tool (accept its offering with aimeat_exchange_accept). Contracted calls are metered and charged to your budget at the provider price (+ platform rake), using the pinned interface version\'s backing capability. A backing action\'s own price still applies to an unpriced tool. The provider\'s upstream API keys stay server-side. Returns the tool\'s result; a failed contracted invocation is refunded. Read inputSchema with aimeat_app_tools_get first: invalid input is refused before charging, with every missing field named.',
        caller: 'agent',
        visibility: agentMcp,
        annotations: { title: 'Invoke App Tool', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'exchange:write',
        // On `service`: Act on EXCHANGE (generic, any MCP client): call an app-tool, run agent-work, renegotiate.
        // On `agent`: Act on EXCHANGE (generic, any MCP client): call an app-tool, run agent-work, renegotiate.
        surfaces: ['agent', 'service'],
        input: {
            owner: { type: 'string', required: true, description: 'The provider app\'s owner (bare name or GHII).', zod: z.string().min(1).max(120) },
            app: { type: 'string', required: true, description: 'The provider app filename (e.g. "company-brief").', zod: z.string().min(1).max(120) },
            tool: { type: 'string', required: true, description: 'The tool name to call (e.g. "getCompanyBrief").', zod: z.string().min(1).max(120) },
            input: { type: 'object', required: false, description: 'The tool input object (matching the offering\'s input_schema).' },
        },
    },
    {
        name: 'aimeat_exchange_work',
        description: 'Start an async AGENT-WORK task under a contract you hold: the provider agent performs it out-of-band and DELIVERS later, and you are charged the per-task price ON DELIVERY (metered + rake). Requires an active contract for the agent-work offering (accept it first with aimeat_exchange_accept). Nothing is charged now. Track it with aimeat_exchange_work_list.',
        caller: 'agent',
        visibility: agentMcp,
        annotations: { title: 'Start Agent Work (async task)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            offering_id: { type: 'string', required: true, description: 'The agent-work offering id you hold a contract for.', zod: z.string().min(1).max(120) },
            input: { type: 'object', required: false, description: 'The task input (matching the offering\'s task input_schema).' },
            note: { type: 'string', required: false, description: 'An optional note to the provider.', zod: z.string().max(2000) },
        },
    },
    {
        name: 'aimeat_exchange_work_deliver',
        description: 'As the PROVIDER of an agent-work task, deliver the result → settle ON DELIVERY: charge the consumer the per-task price, credit you, route the rake, decrement their budget. Only the work\'s own provider may. A budget/rate failure leaves the work open and unpaid (you are told why).' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentMcp,
        annotations: { title: 'Deliver Agent Work (settle on delivery)', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            ...aiProvenanceCatalogInput,
            work_id: { type: 'string', required: true, description: 'The open work item to deliver (from aimeat_exchange_work_list role=provider).', zod: z.string().min(1).max(120) },
            output: { type: 'object', required: false, description: 'The delivered result (matching the offering\'s task output_schema).', zod: z.unknown() },
            note: { type: 'string', required: false, description: 'An optional delivery note.', zod: z.string().max(2000) },
        },
    },
    {
        name: 'aimeat_exchange_work_list',
        description: 'List your AGENT-WORK items — as the consumer (tasks you started, default) or the provider (`role:"provider"` — tasks to deliver + delivered), newest first, with input/output, state, and what was charged on delivery.',
        caller: 'agent',
        visibility: agentMcp,
        annotations: { title: 'List Agent Work Items', readOnlyHint: true },
        // Act-on-exchange (invoke/work/proposals): read = list; write = invoke/start/deliver/decide (spends or changes a contract).
        scope: 'exchange:read',
        surfaces: ['agent', 'service'],
        input: {
            role: { type: 'string', required: false, description: 'consumer (default — your started tasks) or provider (tasks to deliver).', enum: ['consumer', 'provider'] },
        },
    },
    {
        name: 'aimeat_exchange_proposals',
        description: 'List the contract-RENEGOTIATION proposals you are party to (incoming to accept/decline, and your own outgoing), with the proposed new price/cap, a snapshot of the current terms, who proposed it, and status. Decide one with aimeat_exchange_proposal_decide.',
        caller: 'agent',
        visibility: agentMcp,
        annotations: { title: 'List Renegotiation Proposals', readOnlyHint: true },
        scope: 'exchange:read',
        surfaces: ['agent', 'service'],
        input: {},
    },
    {
        name: 'aimeat_exchange_proposal_decide',
        description: 'Decide a renegotiation proposal: `accept` (as the counterparty → supersede the live contract at the agreed terms; the old one is archived to history), `decline` (as the counterparty → no change), or `withdraw` (as the proposer → cancel your own pending proposal). Mutual consent is the authority — a proposed price only binds once the OTHER party accepts.',
        caller: 'agent',
        visibility: agentMcp,
        annotations: { title: 'Decide Renegotiation Proposal', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'exchange:write',
        surfaces: ['agent', 'service'],
        input: {
            proposal_id: { type: 'string', required: true, description: 'The pending proposal id (from aimeat_exchange_proposals).', zod: z.string().min(1).max(120) },
            decision: { type: 'string', required: true, description: 'accept / decline (counterparty) or withdraw (proposer).', enum: ['accept', 'decline', 'withdraw'] },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
