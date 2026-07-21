/**
 * @file exchange.ts
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
 *   v1.0.0 — 2026-07-20 — Initial EXCHANGE MCP tool definitions (10 tools)
 */
import type { AimeatToolDefinition, ToolVisibility } from './types.js';
import { agentEverywhere } from './types.js';

/** The "act on EXCHANGE" tools (invoke/work/proposals) are on BOTH MCP surfaces so ANY agent can act: the
 *  PUBLIC /v1/mcp (hosted clients like Claude chat — the server tool threads the session token so app-tool
 *  invoke can run the backing capability) AND the CONNECTOR MCP (`aimeat connect serve` — tunnelled fleet
 *  agents get them as thin REST proxies over the same routes). Not a CLI fallback. */
const agentMcp: ToolVisibility = { publicMcp: true, connectorMcp: true, cliFallback: false };

export const exchangeTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_exchange_offerings',
        description: 'Browse the EXCHANGE marketplace supply side — data-service OFFERINGs (a provider capability = an extension action, priced authoritatively from the action). With `q` (free text) or an exact `ext`+`action` it matches; otherwise it lists every listed offering, cheapest base price first. `stats:true` folds in each offering\'s usage/reputation (active contracts, calls, distinct consumers) — the "is this actually used?" signal. Public: reading needs no ownership. Read one in full with aimeat_exchange_offering_get, then accept a contract with aimeat_exchange_accept.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            q: { type: 'string', required: false, description: 'Free-text match over title/description/ext/action/tags.' },
            ext: { type: 'string', required: false, description: 'Exact extension name to match (pair with `action`).' },
            action: { type: 'string', required: false, description: 'Exact action id to match (pair with `ext`).' },
            stats: { type: 'boolean', required: false, description: 'Fold in per-offering usage/reputation stats (default false).' },
        },
    },
    {
        name: 'aimeat_exchange_offering_get',
        description: 'One offering in full — everything needed to decide and integrate: the offering record (pricing, plans, provenance, usage terms), the underlying capability\'s I/O SCHEMA (input_schema / output_schema / toll_morsels), a CALL RECIPE (the accepted contract IS the access — you call POST /v1/ext/{ext}/{action} as yourself, no separate API key), and usage STATS (reputation). Public.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            offering_id: { type: 'string', required: true, description: 'The offering id (e.g. "off-…"), from aimeat_exchange_offerings.' },
        },
    },
    {
        name: 'aimeat_exchange_accept',
        description: 'Accept a contract on an offering → mint a durable METERED ENTITLEMENT for YOU (the caller\'s own identity is the consumer — you can never accept on someone else\'s behalf). The per-call PRICE is read AUTHORITATIVELY from the provider\'s extension action, so you cannot undercut the provider or be charged a price you did not accept; you choose only your BUDGET cap (your own spend ceiling) and a contract ref. Re-accepting the same capability carries prior spend forward (renegotiation, not a meter reset). Morsels are integers; money is 6-decimal micro-units. After this, calling /v1/ext/{ext}/{action} is metered against the budget.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ext: { type: 'string', required: true, description: 'The provider extension name.' },
            action: { type: 'string', required: true, description: 'The action id on that extension (must be priced).' },
            contract_ref: { type: 'string', required: false, description: 'Your reference for this contract. Omit to auto-generate one (mcp:<uuid>).' },
            cap_units: { type: 'number', required: false, description: 'Budget ceiling in the action\'s unit (morsels or money micro-units). Must cover one charge. Omit = uncapped.' },
            plan_id: { type: 'string', required: false, description: 'A provider-declared plan id (bundle/subscription). Omit = per_call.' },
            app_id: { type: 'string', required: false, description: 'The consuming app id ("owner/filename") when this contract powers an app — surfaces on the per-app cost view.' },
        },
    },
    {
        name: 'aimeat_exchange_contracts',
        description: 'List every METERED ENTITLEMENT (contract) YOU hold as the consumer — capability, provider, unit, per-call price, rake, contract ref, state (active/paused/revoked), and budget (cap / spent / remaining / calls). The consumer-side ledger of what you are contracted to consume and how much you have spent.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_exchange_contract_off',
        description: 'Your consumer off-switch for ONE of your own contracts: `pause` (reversible — stops metering until resumed by re-accepting) or `revoke` (terminal — the contract no longer authorises and must be re-minted). Only the entitlement\'s own consumer may. Identify the contract by its (ext, action).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            ext: { type: 'string', required: true, description: 'The contracted extension name.' },
            action: { type: 'string', required: true, description: 'The contracted action id.' },
            mode: { type: 'string', required: true, description: 'pause (reversible) or revoke (terminal).', enum: ['pause', 'revoke'] },
        },
    },
    {
        name: 'aimeat_exchange_needs',
        description: 'Browse the EXCHANGE demand side — open NEEDs (a consumer/app\'s wanted capability + budget + minimum-output spec that providers bid on). `open:true` for open needs only; `mine:true` for your own needs (any state). Public. Post one with aimeat_exchange_need_post; bid on one with aimeat_exchange_bid.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            open: { type: 'boolean', required: false, description: 'Only open (unmatched, unclosed) needs.' },
            mine: { type: 'boolean', required: false, description: 'Only needs YOU posted (any state).' },
        },
    },
    {
        name: 'aimeat_exchange_need_post',
        description: 'Post a NEED to the marketplace — an open call for a data-service capability. Describe what you want; optionally pin a target `ext`+`action`, a minimum-output `spec` (the shape a fulfilment MUST return, so a provider/AI can judge fit), a `budget_cap` in `budget_unit`, and `autonomy` (supervised = you approve a bid; auto = an agent may close it). Providers browse open needs and BID; the response also surfaces offerings that already satisfy it (accept directly, no bid needed).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            description: { type: 'string', required: true, description: 'What you need, in plain language.' },
            ext: { type: 'string', required: false, description: 'A desired extension name (when you know the exact capability).' },
            action: { type: 'string', required: false, description: 'A desired action id (pair with `ext`).' },
            spec: { type: 'object', required: false, description: 'Minimum output shape: { requiredFields: string[], format?, sample?, notes? }.' },
            budget_unit: { type: 'string', required: false, description: 'Budget unit for `budget_cap`.', enum: ['morsels', 'money'] },
            budget_cap: { type: 'number', required: false, description: 'Budget ceiling (integer; morsels or money micro-units).' },
            app_id: { type: 'string', required: false, description: 'The app this need belongs to ("owner/filename").' },
            autonomy: { type: 'string', required: false, description: 'supervised (default) or auto.', enum: ['supervised', 'auto'] },
        },
    },
    {
        name: 'aimeat_exchange_bid',
        description: 'Bid on an open NEED with an action YOUR OWN extension provides (you must own the extension — pricing stays authoritative from your action). Optionally link an existing `offering_id`, pick a `plan_id`, and add a `note`. The requester accepts one bid (aimeat_exchange_bid_accept), which mints the entitlement with you as provider.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            need_id: { type: 'string', required: true, description: 'The open need id (e.g. "need-…").' },
            ext: { type: 'string', required: true, description: 'Your extension name (you must own it).' },
            action: { type: 'string', required: true, description: 'The action id on your extension.' },
            plan_id: { type: 'string', required: false, description: 'A plan id declared on your action (bundle/subscription).' },
            note: { type: 'string', required: false, description: 'A note to the requester.' },
            offering_id: { type: 'string', required: false, description: 'Link an existing offering of yours.' },
        },
    },
    {
        name: 'aimeat_exchange_bid_accept',
        description: 'As the NEED\'s requester, accept a bid → mint the metered entitlement (consumer = you, provider = the bidder). Price + unit are read authoritatively from the bidder\'s action; you may set `cap_units` (defaults to the need\'s budget cap). Marks the bid accepted and the need matched.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            need_id: { type: 'string', required: true, description: 'Your need id.' },
            bid_id: { type: 'string', required: true, description: 'The open bid to accept.' },
            cap_units: { type: 'number', required: false, description: 'Budget ceiling for the minted contract (defaults to the need\'s budget cap).' },
        },
    },
    {
        name: 'aimeat_exchange_consumers',
        description: 'Provider data-lineage for one of YOUR offerings: who holds a contract against it, how many calls they made, how much settled, contract state, and last use — "where is my data used, by whom, and how much?". Provider-only (you must own the offering).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            offering_id: { type: 'string', required: true, description: 'One of your own offering ids.' },
        },
    },
    {
        name: 'aimeat_app_tool_invoke',
        description: 'CALL an app\'s offered tool (a method like getCompanyBrief) through YOUR metered contract — the generic "one app/agent calls another app\'s function" channel. You must already hold a contract for this app-tool (accept its offering with aimeat_exchange_accept). The call is metered + charged to your budget at the provider price (+ platform rake), routed to the pinned interface version\'s backing capability; the provider\'s own upstream API keys stay server-side (you never see or need them). Returns the tool\'s result. If the invocation throws you are refunded.',
        caller: 'agent',
        visibility: agentMcp,
        input: {
            owner: { type: 'string', required: true, description: 'The provider app\'s owner (bare name or GHII).' },
            app: { type: 'string', required: true, description: 'The provider app filename (e.g. "company-brief").' },
            tool: { type: 'string', required: true, description: 'The tool name to call (e.g. "getCompanyBrief").' },
            input: { type: 'object', required: false, description: 'The tool input object (matching the offering\'s input_schema).' },
        },
    },
    {
        name: 'aimeat_exchange_work',
        description: 'Start an async AGENT-WORK task under a contract you hold: the provider agent performs it out-of-band and DELIVERS later, and you are charged the per-task price ON DELIVERY (metered + rake). Requires an active contract for the agent-work offering (accept it first with aimeat_exchange_accept). Nothing is charged now. Track it with aimeat_exchange_work_list.',
        caller: 'agent',
        visibility: agentMcp,
        input: {
            offering_id: { type: 'string', required: true, description: 'The agent-work offering id you hold a contract for.' },
            input: { type: 'object', required: false, description: 'The task input (matching the offering\'s task input_schema).' },
            note: { type: 'string', required: false, description: 'An optional note to the provider.' },
        },
    },
    {
        name: 'aimeat_exchange_work_deliver',
        description: 'As the PROVIDER of an agent-work task, deliver the result → settle ON DELIVERY: charge the consumer the per-task price, credit you, route the rake, decrement their budget. Only the work\'s own provider may. A budget/rate failure leaves the work open and unpaid (you are told why).',
        caller: 'agent',
        visibility: agentMcp,
        input: {
            work_id: { type: 'string', required: true, description: 'The open work item to deliver (from aimeat_exchange_work_list role=provider).' },
            output: { type: 'object', required: false, description: 'The delivered result (matching the offering\'s task output_schema).' },
            note: { type: 'string', required: false, description: 'An optional delivery note.' },
        },
    },
    {
        name: 'aimeat_exchange_work_list',
        description: 'List your AGENT-WORK items — as the consumer (tasks you started, default) or the provider (`role:"provider"` — tasks to deliver + delivered), newest first, with input/output, state, and what was charged on delivery.',
        caller: 'agent',
        visibility: agentMcp,
        input: {
            role: { type: 'string', required: false, description: 'consumer (default — your started tasks) or provider (tasks to deliver).', enum: ['consumer', 'provider'] },
        },
    },
    {
        name: 'aimeat_exchange_proposals',
        description: 'List the contract-RENEGOTIATION proposals you are party to (incoming to accept/decline, and your own outgoing), with the proposed new price/cap, a snapshot of the current terms, who proposed it, and status. Decide one with aimeat_exchange_proposal_decide.',
        caller: 'agent',
        visibility: agentMcp,
        input: {},
    },
    {
        name: 'aimeat_exchange_proposal_decide',
        description: 'Decide a renegotiation proposal: `accept` (as the counterparty → supersede the live contract at the agreed terms; the old one is archived to history), `decline` (as the counterparty → no change), or `withdraw` (as the proposer → cancel your own pending proposal). Mutual consent is the authority — a proposed price only binds once the OTHER party accepts.',
        caller: 'agent',
        visibility: agentMcp,
        input: {
            proposal_id: { type: 'string', required: true, description: 'The pending proposal id (from aimeat_exchange_proposals).' },
            decision: { type: 'string', required: true, description: 'accept / decline (counterparty) or withdraw (proposer).', enum: ['accept', 'decline', 'withdraw'] },
        },
    },
];
