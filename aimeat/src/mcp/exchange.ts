/**
 * @file src/mcp/exchange.ts
 * @description MCP EXCHANGE marketplace tools (TARGET-045 over MCP): the agent-facing surface for the
 *   two-sided data-service market. Consumer side — browse OFFERINGs, read one in full (I/O schema +
 *   call-recipe + stats), ACCEPT a contract (mint a metered entitlement for the CALLER), list the
 *   caller's own contracts, pause/revoke one, post + browse NEEDs, and accept a bid. Provider side —
 *   bid on a need with an action the caller's extension owns, and see who holds contracts against an
 *   offering. Every tool mirrors the REST handlers in src/routes/exchange.ts + exchange-market.ts,
 *   calling the SAME services (exchange-market.ts, metered-entitlements.ts) — no new business logic.
 *   Pricing is ALWAYS authoritative from the provider action (resolveActionPricing), so a consumer can
 *   never undercut the provider. The consumer/requester identity is the caller's resolved GAII (never
 *   from input). Scope gates (exchange:read / exchange:write) are enforced by the per-session
 *   registration filter (catalog/scopes.ts) — stricter than the requireAuth-only REST routes on purpose.
 * @structure registerExchangeTools() — registers 10 tools on an McpServer instance
 * @usage
 *   import { registerExchangeTools } from './exchange.js';
 *   registerExchangeTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.2.0 — 2026-07-21 — need_post carries usage_intent; needs listings enriched with the requesting app's
 *     name/description (enrichNeeds) so a provider can judge who they'd serve.
 *   v1.1.0 — 2026-07-21 — accept by `offering_id` (ext-action AND app-tool kinds, via resolveOfferingPricing);
 *     offering_get surfaces the pinned app-tool interface schema + WebMCP call recipe (Gap 1 cross-app selling).
 *   v1.0.0 — 2026-07-20 — Initial EXCHANGE MCP surface (offerings/accept/contracts/off/needs/bid/consumers)
 */
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { percentFee } from '../commerce/money.js';
import {
    createEntitlement, readEntitlementForCall, listEntitlementsByConsumer,
    pauseEntitlement, revokeEntitlement, type MeteredEntitlement,
} from '../services/metered-entitlements.js';
import {
    type Offering, type Need, type Bid, type ActionCommercial, type NeedSpec,
    resolveActionPricing, resolveOfferingPricing, newNeedId, newBidId,
    getOffering, listOfferings, matchOfferings,
    putNeed, getNeed, listNeeds, putBid, getBid,
    offeringStats, offeringConsumers, enrichNeeds,
} from '../services/exchange-market.js';
import { getInterfaceVersion } from '../services/app-tool-interfaces.js';

function ownerOf(gaii: string): string {
    return gaii.split('@')[0].split('#').pop() ?? gaii;
}

/** Shape a metered entitlement for the consumer-facing view (mirrors src/routes/exchange.ts `view`). */
function entitlementView(config: AimeatConfig, e: MeteredEntitlement) {
    const rakePct = e.rakePercent ?? commerceFeePercent(config);
    return {
        entitlement_id: e.entitlementId,
        consumer_gaii: e.consumerGaii,
        app_id: e.appId,
        provider: e.providerGhii,
        ext: e.ext,
        action: e.action,
        surface: e.surface ?? null,
        capability: e.capabilityLabel,
        unit: e.unit,
        currency: e.currency,
        price_per_call: e.pricePerCall,
        pricing: e.pricing ?? { model: 'per_call' },
        rake_percent: rakePct,
        rake_per_call: percentFee(e.pricePerCall, rakePct),
        contract_ref: e.contractRef,
        escrow_party: e.escrowParty,
        state: e.state,
        budget: {
            cap_units: e.budget.capUnits,
            spent_units: e.budget.spentUnits,
            remaining_units: e.budget.capUnits === null ? null : Math.max(0, e.budget.capUnits - e.budget.spentUnits),
            calls: e.budget.calls,
        },
    };
}

/** Parse a need's minimum-spec from a loose input object (mirrors exchange-market.ts route parseNeedSpec). */
function parseNeedSpec(v: unknown): NeedSpec | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
    const requiredFields = Array.isArray(o.requiredFields) ? (o.requiredFields as unknown[]).filter(f => typeof f === 'string') as string[] : [];
    const spec: NeedSpec = { requiredFields };
    if (typeof o.format === 'string') spec.format = o.format;
    if (typeof o.sample === 'string') spec.sample = o.sample;
    if (typeof o.notes === 'string') spec.notes = o.notes;
    if (isObj(o.inputSchema)) spec.inputSchema = o.inputSchema;
    if (isObj(o.outputSchema)) spec.outputSchema = o.outputSchema;
    return (requiredFields.length || spec.format || spec.sample || spec.notes || spec.inputSchema || spec.outputSchema) ? spec : null;
}

export function registerExchangeTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();
    const owner = parseGaiiLoose(agentGaii).owner;
    // The consumer/requester identity is the CALLER's own resolved GAII (never from input), so a caller
    // can only accept/post/off/bid on their own behalf — the same guarantee resolveIdentity gives REST.
    const consumerGaii = agentGaii;

    const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
    const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true as const });

    // ── Browse offerings (supply) ──────────────────────────────────────────────
    mcp.tool(
        'aimeat_exchange_offerings',
        descriptionFor('aimeat_exchange_offerings'),
        {
            q: z.string().max(400).optional(),
            ext: z.string().max(120).optional(),
            action: z.string().max(120).optional(),
            stats: z.boolean().optional(),
        },
        annotationsFor('aimeat_exchange_offerings'),
        async ({ q, ext, action, stats }) => {
            const offerings = (ext && action) || q
                ? await matchOfferings(storage, { ext: ext || null, action: action || null, text: q || null })
                : await listOfferings(storage);
            if (stats) {
                const withStats = await Promise.all(offerings.map(async o => ({ ...o, stats: await offeringStats(storage, o) })));
                return ok({ offerings: withStats, count: withStats.length });
            }
            return ok({ offerings, count: offerings.length });
        },
    );

    // ── One offering in full (detail + I/O schema + call-recipe + stats) ────────
    mcp.tool(
        'aimeat_exchange_offering_get',
        descriptionFor('aimeat_exchange_offering_get'),
        {
            offering_id: z.string().min(1).max(120),
        },
        annotationsFor('aimeat_exchange_offering_get'),
        async ({ offering_id }) => {
            const o = await getOffering(storage, offering_id);
            if (!o) return fail(`NOT_FOUND: no such offering "${offering_id}"`);
            const stats = await offeringStats(storage, o);

            if (o.kind === 'app-tool' && o.surface) {
                const s = o.surface;
                const iface = await getInterfaceVersion(storage, o.providerGhii, s.appId, s.tool, s.ifaceVersion);
                return ok({
                    offering: o,
                    capability: iface ? {
                        kind: 'app-tool', app: `${s.ownerName}/${s.appId}`, tool: s.tool, iface_version: s.ifaceVersion,
                        input_schema: iface.inputSchema, output_schema: iface.outputSchema,
                    } : null,
                    call_recipe: {
                        method: 'POST',
                        url: `/v1/apps/${encodeURIComponent(s.ownerName)}/${encodeURIComponent(s.appId)}/webmcp/tools/${encodeURIComponent(s.tool)}`,
                        auth: 'Your own AIMEAT token — the accepted contract (metered entitlement) authorises the call; no separate API key is issued.',
                        note: `Metered + charged to your budget. Pinned to interface v${s.ifaceVersion}; the provider may ship newer app versions without breaking your integration.`,
                        body: '{ "input": { … } }',
                    },
                    stats,
                });
            }

            const extRec = await storage.getExtension(o.ext);
            const act = extRec?.actions.find(a => a.id === o.action);
            return ok({
                offering: o,
                capability: act ? {
                    input_schema: act.inputSchema ?? {},
                    output_schema: act.outputSchema ?? {},
                    toll_morsels: act.tollMorsels ?? 0,
                } : null,
                call_recipe: {
                    method: 'POST',
                    url: `/v1/ext/${o.ext}/${o.action}`,
                    auth: 'Your own AIMEAT token — the accepted contract (metered entitlement) authorises the call; no separate API key is issued.',
                    note: 'Each call is metered + charged to your budget at the provider price; the provider’s own upstream keys stay server-side.',
                    mcp: `aimeat_extension_invoke { "name": "${o.ext}", "action": "${o.action}", "input": { … } }`,
                },
                stats,
            });
        },
    );

    // ── Accept a contract → mint a metered entitlement for the caller ───────────
    mcp.tool(
        'aimeat_exchange_accept',
        descriptionFor('aimeat_exchange_accept'),
        {
            offering_id: z.string().min(1).max(120).optional(),
            ext: z.string().min(1).max(120).optional(),
            action: z.string().min(1).max(120).optional(),
            contract_ref: z.string().min(1).max(200).optional(),
            cap_units: z.number().int().nonnegative().optional(),
            plan_id: z.string().min(1).max(120).optional(),
            app_id: z.string().min(1).max(300).optional(),
        },
        annotationsFor('aimeat_exchange_accept'),
        async ({ offering_id, ext, action, contract_ref, cap_units, plan_id, app_id }) => {
            const capUnits = cap_units !== undefined ? Math.floor(cap_units) : null;

            // Preferred: accept an OFFERING by id (works for ext-action AND app-tool kinds).
            if (offering_id) {
                const o = await getOffering(storage, offering_id);
                if (!o || o.state !== 'listed') return fail('NOT_FOUND: no such listed offering');
                const priced = await resolveOfferingPricing(storage, o, plan_id ?? null);
                if (!priced.ok) return fail(`${priced.code}: ${priced.message}`);
                const minCharge = priced.pricing?.model === 'bundle' ? priced.pricing.blockPrice : priced.pricing?.model === 'subscription' ? priced.pricing.periodPrice : priced.pricePerCall;
                if (capUnits !== null && capUnits < minCharge) {
                    return fail(`BUDGET_TOO_LOW: budget cap (${capUnits}) is below the ${minCharge}-${priced.unit === 'money' ? priced.currency : 'morsel'} minimum charge`);
                }
                const existing = await readEntitlementForCall(storage, consumerGaii, priced.ext, priced.action);
                const ent = await createEntitlement(storage, {
                    consumerGaii, appId: app_id ?? null, providerGhii: priced.providerGhii, ext: priced.ext, action: priced.action,
                    capabilityLabel: priced.capabilityLabel, unit: priced.unit, pricePerCall: priced.pricePerCall,
                    currency: priced.currency, pricing: priced.pricing, capUnits, contractRef: contract_ref || `offering:${offering_id}`,
                    surface: priced.surface, createdBy: owner, carrySpend: existing,
                });
                return ok({ entitlement: entitlementView(config, ent) });
            }

            // Legacy: accept a raw ext-action directly.
            if (!ext || !action) return fail('BAD_REQUEST: pass offering_id, or both ext and action');
            const contractRef = contract_ref || `mcp:${randomUUID()}`;
            const extRec = await storage.getExtension(ext);
            if (!extRec) return fail(`NOT_FOUND: extension "${ext}" not found`);
            const act = extRec.actions.find(a => a.id === action);
            if (!act) return fail(`NOT_FOUND: action "${action}" not found on "${ext}"`);

            // AUTHORITATIVE price + unit + (optional plan) pricing — shared resolver, so a consumer can
            // never undercut the provider. `plan_id` picks a provider-declared plan; none → per_call.
            const priced = resolveActionPricing(act.commercial as ActionCommercial | undefined, plan_id ?? null);
            if (!priced.ok) return fail(`${priced.code}: action "${ext}/${action}": ${priced.message}`);
            const { unit, pricePerCall, currency, pricing } = priced;
            const minCharge = pricing?.model === 'bundle' ? pricing.blockPrice : pricing?.model === 'subscription' ? pricing.periodPrice : pricePerCall;
            if (capUnits !== null && capUnits < minCharge) {
                return fail(`BUDGET_TOO_LOW: budget cap (${capUnits}) is below the ${minCharge}-${unit === 'money' ? currency : 'morsel'} minimum charge`);
            }
            const providerGhii = `${extRec.installedBy}@${config.nodeId}`;

            // Carry spend forward on re-acceptance (renegotiation) so a new contract does not reset the meter.
            const existing = await readEntitlementForCall(storage, consumerGaii, ext, action);
            const ent = await createEntitlement(storage, {
                consumerGaii, appId: app_id ?? null, providerGhii, ext, action, capabilityLabel: `${ext}/${action}`,
                unit, pricePerCall, currency, pricing, capUnits, contractRef, createdBy: owner, carrySpend: existing,
            });
            return ok({ entitlement: entitlementView(config, ent) });
        },
    );

    // ── List the caller's own contracts (consumer side) ────────────────────────
    mcp.tool(
        'aimeat_exchange_contracts',
        descriptionFor('aimeat_exchange_contracts'),
        {},
        annotationsFor('aimeat_exchange_contracts'),
        async () => {
            const mine = await listEntitlementsByConsumer(storage, consumerGaii);
            return ok({ entitlements: mine.map(e => entitlementView(config, e)), count: mine.length });
        },
    );

    // ── Pause / revoke one of the caller's own contracts ───────────────────────
    mcp.tool(
        'aimeat_exchange_contract_off',
        descriptionFor('aimeat_exchange_contract_off'),
        {
            ext: z.string().min(1).max(120),
            action: z.string().min(1).max(120),
            mode: z.enum(['pause', 'revoke']),
        },
        annotationsFor('aimeat_exchange_contract_off'),
        async ({ ext, action, mode }) => {
            const ent = await readEntitlementForCall(storage, consumerGaii, ext, action);
            if (!ent || ownerOf(ent.consumerGaii) !== owner) {
                return fail('NOT_FOUND: no entitlement of yours for that capability');
            }
            const applied = mode === 'revoke'
                ? await revokeEntitlement(storage, consumerGaii, ext, action)
                : await pauseEntitlement(storage, consumerGaii, ext, action);
            return ok({ ext, action, mode, applied });
        },
    );

    // ── Browse needs (demand) ──────────────────────────────────────────────────
    mcp.tool(
        'aimeat_exchange_needs',
        descriptionFor('aimeat_exchange_needs'),
        {
            open: z.boolean().optional(),
            mine: z.boolean().optional(),
        },
        annotationsFor('aimeat_exchange_needs'),
        async ({ open, mine }) => {
            const needs = await enrichNeeds(storage, await listNeeds(storage, { openOnly: !!open, owner: mine ? owner : undefined }));
            return ok({ needs, count: needs.length });
        },
    );

    // ── Post a need ────────────────────────────────────────────────────────────
    mcp.tool(
        'aimeat_exchange_need_post',
        descriptionFor('aimeat_exchange_need_post'),
        {
            description: z.string().min(1).max(4000),
            app_id: z.string().min(1).max(300),
            ext: z.string().max(120).optional(),
            action: z.string().max(120).optional(),
            spec: z.record(z.string(), z.unknown()).optional(),
            usage_intent: z.string().max(2000).optional(),
            budget_unit: z.enum(['morsels', 'money']).optional(),
            budget_cap: z.number().int().nonnegative().optional(),
            autonomy: z.enum(['supervised', 'auto']).optional(),
        },
        annotationsFor('aimeat_exchange_need_post'),
        async ({ description, app_id, ext, action, spec, usage_intent, budget_unit, budget_cap, autonomy }) => {
            const now = new Date().toISOString();
            const need: Need = {
                needId: newNeedId(),
                requesterGaii: consumerGaii,
                requesterOwner: owner,
                appId: app_id,
                ext: ext || null, action: action || null,
                description,
                spec: parseNeedSpec(spec),
                usageIntent: usage_intent || null,
                budgetUnit: budget_unit ?? null, budgetCap: budget_cap !== undefined ? Math.floor(budget_cap) : null,
                autonomy: autonomy === 'auto' ? 'auto' : 'supervised',
                state: 'open', createdAt: now, updatedAt: now,
            };
            await putNeed(storage, need);
            // Surface offerings that already satisfy it (accept directly, no bid needed).
            const matches = await matchOfferings(storage, { ext: need.ext, action: need.action, text: need.description });
            return ok({ need, matches: matches.slice(0, 10) });
        },
    );

    // ── Bid on a need (provider) ───────────────────────────────────────────────
    mcp.tool(
        'aimeat_exchange_bid',
        descriptionFor('aimeat_exchange_bid'),
        {
            need_id: z.string().min(1).max(120),
            ext: z.string().min(1).max(120),
            action: z.string().min(1).max(120),
            plan_id: z.string().max(120).optional(),
            note: z.string().max(2000).optional(),
            offering_id: z.string().max(120).optional(),
        },
        annotationsFor('aimeat_exchange_bid'),
        async ({ need_id, ext, action, plan_id, note, offering_id }) => {
            const n = await getNeed(storage, need_id);
            if (!n) return fail(`NOT_FOUND: no such need "${need_id}"`);
            if (n.state !== 'open') return fail(`NEED_CLOSED: need is ${n.state}`);
            const extRec = await storage.getExtension(ext);
            if (!extRec || extRec.installedBy !== owner) return fail('FORBIDDEN: bid only with an action your extension owns');
            if (!extRec.actions.find(a => a.id === action)) return fail(`NOT_FOUND: action "${action}" not found on "${ext}"`);
            const bid: Bid = {
                bidId: newBidId(), needId: n.needId,
                bidderGhii: consumerGaii, bidderOwner: owner,
                offeringId: offering_id || null, ext, action,
                planId: plan_id || null, note: note ?? '',
                state: 'open', createdAt: new Date().toISOString(),
            };
            await putBid(storage, bid);
            return ok({ bid });
        },
    );

    // ── Accept a bid → mint the entitlement (requester side) ───────────────────
    mcp.tool(
        'aimeat_exchange_bid_accept',
        descriptionFor('aimeat_exchange_bid_accept'),
        {
            need_id: z.string().min(1).max(120),
            bid_id: z.string().min(1).max(120),
            cap_units: z.number().int().nonnegative().optional(),
        },
        annotationsFor('aimeat_exchange_bid_accept'),
        async ({ need_id, bid_id, cap_units }) => {
            const n = await getNeed(storage, need_id);
            if (!n || n.requesterOwner !== owner) return fail('NOT_FOUND: no such need of yours');
            const bid = await getBid(storage, n.needId, bid_id);
            if (!bid || bid.state !== 'open') return fail('NOT_FOUND: no such open bid');

            const extRec = await storage.getExtension(bid.ext);
            const act = extRec?.actions.find(a => a.id === bid.action);
            if (!extRec || !act) return fail('NOT_FOUND: bid capability no longer exists');
            const priced = resolveActionPricing(act.commercial as ActionCommercial | undefined, bid.planId);
            if (!priced.ok) return fail(`${priced.code}: ${priced.message}`);

            const capCap = cap_units !== undefined ? Math.floor(cap_units) : n.budgetCap;
            const existing = await readEntitlementForCall(storage, consumerGaii, bid.ext, bid.action);
            const ent = await createEntitlement(storage, {
                consumerGaii, appId: n.appId, providerGhii: `${extRec.installedBy}@${config.nodeId}`,
                ext: bid.ext, action: bid.action, capabilityLabel: `${bid.ext}/${bid.action}`,
                unit: priced.unit, pricePerCall: priced.pricePerCall, currency: priced.currency, pricing: priced.pricing,
                capUnits: capCap, contractRef: `bid:${bid.bidId}`, createdBy: owner, carrySpend: existing,
            });
            bid.state = 'accepted'; await putBid(storage, bid);
            n.state = 'matched'; n.updatedAt = new Date().toISOString(); await putNeed(storage, n);
            return ok({ entitlement_id: ent.entitlementId, ext: ent.ext, action: ent.action, unit: ent.unit, pricing: ent.pricing });
        },
    );

    // ── Provider lineage: who holds contracts against my offering ──────────────
    mcp.tool(
        'aimeat_exchange_consumers',
        descriptionFor('aimeat_exchange_consumers'),
        {
            offering_id: z.string().min(1).max(120),
        },
        annotationsFor('aimeat_exchange_consumers'),
        async ({ offering_id }) => {
            const o: Offering | null = await getOffering(storage, offering_id);
            if (!o || o.providerOwner !== owner) return fail('NOT_FOUND: no such offering of yours');
            const consumers = await offeringConsumers(storage, o);
            return ok({ offeringId: o.offeringId, consumers, count: consumers.length });
        },
    );
}
