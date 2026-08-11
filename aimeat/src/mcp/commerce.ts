/**
 * @file src/mcp/commerce.ts
 * @description MCP commerce tools (TARGET-033/034 over MCP): the agent-facing surface for
 *   managing its owner's SELLING (PSP credentials — masked, the secret never returns; app-tool
 *   manifests; offer money pricing) and for BUYING through checkout sessions. Every tool wraps an
 *   EXISTING commerce mechanism — the commerce.psp / apps.{appId}.tools memory-record conventions
 *   the sellable resolvers read, the agents.{name}.offers document (validated with the same
 *   OffersDocSchema the REST route uses), and src/commerce/session-service.ts — no new business
 *   logic. Ownership is always the CALLER's own owner (derived from the session GAII, never from
 *   input). Money = integer 6-decimal micro-units through money.ts. Scope gates (commerce:sell /
 *   commerce:buy) are enforced by the per-session registration filter (catalog/scopes.ts).
 *   checkout_complete mints a short-lived JWT for the CALLING agent itself (same identity, no
 *   privilege lift) so callable app-tool fulfillment can authenticate its capability invoke.
 * @structure registerCommerceTools() — registers 9 tools on an McpServer instance
 * @usage
 *   import { registerCommerceTools } from './commerce.js';
 *   registerCommerceTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   Limits aligned with the raised model schemas -- 2026-07-30 -- the tool kept its own max(40) on
 *     `tools`, which shadowed the manifest's raised 200 and refused a 41st tool anyway.
 *   v1.2.0 — 2026-08-11 — putOwnerRecord goes through services/memory-write.ts, so the PSP record
 *     and the app-tool manifest answer to memory's ceilings, archive guard and byte quota. The
 *     authorising permission stays commerce:sell, named through the service rather than replaced.
 *   v1.1.0 — 2026-08-10 — The fulfillment re-issue carries the agent's own scopes.
 *   v1.0.0 — 2026-07-14 — Initial commerce MCP surface (PSP, app-tools, offer pricing, checkout)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, responseFormatSchema, shapeResponse } from './catalog/shape.js';
import { AppToolsDocSchema, appToolsKey, appIdFromToolsKey } from '../models/app-tool-schemas.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';
import { reconcileAfterSourceWrite } from '../services/exchange-projection.js';
import { integerMicros, isSupportedMoneyCurrency } from '../commerce/money.js';
import { createSession, getSession, completeSession, listSessions, CommerceError } from '../commerce/session-service.js';
import { PaymentError } from '../commerce/payment-handlers.js';
import { putSplit, deleteSplit, listSplitsByProvider, BENEFICIARIES_MAX, type BeneficiaryShare } from '../commerce/beneficiary-split.js';
import { listBeneficiaryEntries, listBeneficiaryObligations, type BeneficiaryEntry } from '../commerce/beneficiary-book.js';
import { readApproval, putApproval, beneficiaryEligibility, releaseBeneficiaryShare } from '../commerce/beneficiary-release.js';
import { quoteBeneficiaryPayout, settleBeneficiaryPayout } from '../commerce/beneficiary-payout.js';
import type { X402PaymentPayload } from '../commerce/x402-facilitator.js';
import { issueJWT } from '../auth/jwt.js';
import { emitChange } from '../services/event-bus.js';
import { writeMemoryRecord } from '../services/memory-write.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';

const PSP_KEY = 'commerce.psp';

function ok(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
    return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}
function commerceFail(err: unknown) {
    if (err instanceof CommerceError || err instanceof PaymentError) {
        return fail(`${err.code}: ${err.message}`);
    }
    return fail(`COMMERCE_ERROR: ${(err as { message?: string }).message ?? 'Unexpected commerce error'}`);
}

/** Mask a stored PSP secret to its last 4 characters — the only form any tool ever returns. */
function maskSecret(secret: unknown): string {
    const s = typeof secret === 'string' ? s4(secret) : '';
    return s ? `…${s}` : '(set)';
    function s4(v: string): string { return v.length >= 4 ? v.slice(-4) : ''; }
}

/**
 * The app ids this owner publishes a tool manifest for — the signpost on an APP_TOOLS_NOT_FOUND.
 * A cross-owner caller sees only the public ones, matching the read gate itself, so the hint can
 * never reveal that a private manifest exists.
 */
async function listAppToolManifests(storage: Storage, ownerGhii: string, includePrivate: boolean): Promise<string[]> {
    try {
        const recs = await storage.listMemory(ownerGhii, { prefix: 'apps.' });
        return recs
            .filter(r => includePrivate || r.visibility === 'public')
            .map(r => appIdFromToolsKey(r.key))
            .filter((id): id is string => !!id)
            .sort()
            .slice(0, 12);
    } catch (err) {
        // The hint is a courtesy on a path that has already failed; never turn it into a second
        // failure — but say so, or a broken listing looks like an owner with no manifests.
        logger.warn('app-tool manifest hint could not be built', { ownerGhii, error: String(err) });
        return [];
    }
}

export function registerCommerceTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's own scopes, for the shared memory write behind putOwnerRecord(). */
    sessionScopes: string[] = [],
): void {
    // The operator kill switch, honoured here too. routes/commerce.ts:139-146 turns the WHOLE
    // /v1/commerce surface off with a 503 when AIMEAT_COMMERCE_ENABLED=false, and that middleware
    // sits on the router, so it covers the payout routes as well. The MCP tools were registered
    // regardless, so an agent could still write and destroy the seller's payment credentials on a
    // node where the operator had switched commerce off. Not registering them is the same answer
    // the route gives, in this protocol's terms.
    if (!config.commerceEnabled) return;

    const agentGaii = getAgentGaii();
    const owner = parseGaiiLoose(agentGaii).owner;
    const ownerGhii = `${owner}@${config.nodeId}`;

    /**
     * Upsert one memory record under the caller's OWNER GHII (the seller identity resolvers read).
     *
     * It goes through the shared write, because a seller's PSP configuration and an app's tool
     * manifest are memory records and answer to memory's rules. Writing them straight to storage
     * meant no archive guard, no value-size ceiling, no key count and no byte quota or overage
     * charge — the manifest in particular is up to 200 entries of unbounded records, so the only
     * thing that would ever have bounded it was the ceiling that was missing.
     *
     * The authorising permission is commerce:sell and not memory:write: that is the word the owner
     * granted for exactly this, and the registration filter and this tool both already check it.
     * Naming it says which permission governs instead of demanding one nobody was asked for.
     */
    async function putOwnerRecord(key: string, value: Record<string, unknown>, visibility: 'private' | 'public', tags: string[]): Promise<string | null> {
        const written = await writeMemoryRecord({ storage, config }, {
            principal: agentGaii, targetGaii: ownerGhii, scopes: sessionScopes, roles: ['agent'],
        }, {
            key, value, visibility, tags,
            pipeline: 'mcp.commerce',
            ownerScoped: true,
            authorisingScope: 'commerce:sell',
        });
        return written.ok ? null : `${written.code}: ${written.message}`;
    }

    // ── Seller: PSP credentials (secret in, masked status out — NEVER the secret) ──

    mcp.tool(
        'aimeat_commerce_psp_set',
        descriptionFor('aimeat_commerce_psp_set'),
        {
            provider: z.string().min(1).max(60),
            secret_key: z.string().min(4).max(500),
        },
        annotationsFor('aimeat_commerce_psp_set'),
        async ({ provider, secret_key }) => {
            // Same bound the route applies (routes/commerce.ts:210-214). This tool stored whatever
            // arrived, so a blank or truncated key became the seller's configured PSP credential
            // and every money sale failed at settlement instead of at configuration.
            const key = String(secret_key ?? '').trim();
            if (key.length < 8 || key.length > 200) {
                return fail('INVALID_PSP: secret_key must be your PSP secret (8-200 characters). It is stored server-side and never returned.');
            }
            // MERGE: the same record also holds the seller's x402 USDC payout address. Replacing it
            // wholesale would silently delete the other rail's setting (and vice versa).
            const existing = (await storage.getMemory(ownerGhii, PSP_KEY))?.value as Record<string, unknown> | undefined;
            const pspRefusal = await putOwnerRecord(PSP_KEY, { ...(existing ?? {}), provider, secretKey: key }, 'private', ['commerce']);
            if (pspRefusal) return { content: [{ type: 'text' as const, text: pspRefusal }], isError: true };
            return ok({ configured: true, provider, key_hint: maskSecret(key), note: 'Stored server-side; money sales settle on this PSP account. The secret is never returned by any tool.' });
        },
    );

    mcp.tool(
        'aimeat_commerce_psp_status',
        descriptionFor('aimeat_commerce_psp_status'),
        {},
        annotationsFor('aimeat_commerce_psp_status'),
        async () => {
            const rec = await storage.getMemory(ownerGhii, PSP_KEY);
            if (!rec) return ok({ configured: false });
            const v = rec.value as { provider?: string; secretKey?: unknown };
            return ok({ configured: true, provider: v.provider ?? 'unknown', key_hint: maskSecret(v.secretKey), updated_at: rec.updatedAt });
        },
    );

    mcp.tool(
        'aimeat_commerce_psp_delete',
        descriptionFor('aimeat_commerce_psp_delete'),
        {},
        annotationsFor('aimeat_commerce_psp_delete'),
        async () => {
            const deleted = await storage.deleteMemory(ownerGhii, PSP_KEY);
            return ok({ deleted, note: deleted ? 'Money-currency checkouts of your items now fail until new credentials are set.' : 'No PSP credentials were configured.' });
        },
    );

    // ── Seller: app-tool manifest (apps.{appId}.tools — the record the resolver + feed read) ──

    mcp.tool(
        'aimeat_app_tools_publish',
        descriptionFor('aimeat_app_tools_publish'),
        {
            app_id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
            tools: z.array(z.record(z.string(), z.unknown())).max(200),
            odps: z.record(z.string(), z.unknown()).optional(),
            provenance: z.record(z.string(), z.unknown()).optional(),
        },
        annotationsFor('aimeat_app_tools_publish'),
        async ({ app_id, tools, odps, provenance }) => {
            const parsed = AppToolsDocSchema.safeParse({ tools, ...(odps ? { odps } : {}), ...(provenance ? { provenance } : {}) });
            if (!parsed.success) return fail(`INVALID_TOOL_MANIFEST: ${parsed.error.message}`);
            const key = appToolsKey(app_id);
            const existing = await storage.getMemory(ownerGhii, key);
            const doc = {
                version: ((existing?.value as { version?: number } | undefined)?.version ?? 0) + 1,
                updatedAt: new Date().toISOString(),
                ...(parsed.data.odps ? { odps: parsed.data.odps } : {}),
                ...(parsed.data.provenance ? { provenance: parsed.data.provenance } : {}),
                tools: parsed.data.tools,
            };
            const manifestRefusal = await putOwnerRecord(key, doc, 'public', ['commerce', 'app-tools']);
            if (manifestRefusal) return { content: [{ type: 'text' as const, text: manifestRefusal }], isError: true };
            // TARGET-050: the manifest is the source of truth for the EXCHANGE listing — project it now.
            await reconcileAfterSourceWrite(storage, ownerGhii, key);
            return ok({
                app: `${owner}/${app_id}`,
                version: doc.version,
                tools: parsed.data.tools.map((t) => ({
                    sku: `app-tool:${owner}/${app_id}:${t.name}`,
                    name: t.name,
                    fulfillment: t.action_id ? 'call' : 'task',
                    priced: !!((t.price && t.price.morsels > 0) || t.priceMoney),
                })),
            });
        },
    );

    mcp.tool(
        'aimeat_app_tools_get',
        descriptionFor('aimeat_app_tools_get'),
        {
            app_id: z.string().min(1).max(120),
            owner: z.string().min(1).max(100).optional(),
        },
        annotationsFor('aimeat_app_tools_get'),
        async ({ app_id, owner: ownerArg }) => {
            const targetOwner = (ownerArg ?? owner).split('@')[0] as string;
            const rec = await storage.getMemory(`${targetOwner}@${config.nodeId}`, appToolsKey(app_id));
            // Cross-owner reads require the record to be PUBLIC — a private manifest is
            // indistinguishable from a missing one (mirrors the WebMCP listing gate).
            if (!rec || (targetOwner !== owner && rec.visibility !== 'public')) {
                // Name the manifests this owner DOES publish. An app id is a filename and carries its
                // extension, while the app's own subdomain does not: an agent that read
                // `nuotta.apps.aimeat.io` asked for "nuotta", was told the app declares no manifest,
                // believed it, and went off to download the app's HTML to work out what it does. The
                // bare "not found" was true of the key and false of the app.
                const near = await listAppToolManifests(storage, `${targetOwner}@${config.nodeId}`, targetOwner === owner);
                const hint = near.length
                    ? ` This owner publishes tool manifests for: ${near.join(', ')}. An app id is a filename and includes its extension.`
                    : '';
                return fail(`APP_TOOLS_NOT_FOUND: app "${targetOwner}/${app_id}" declares no ${targetOwner === owner ? '' : 'public '}tool manifest.${hint}`);
            }
            return ok({ app: `${targetOwner}/${app_id}`, visibility: rec.visibility, manifest: rec.value });
        },
    );

    // ── Seller: offer money pricing (agents.{name}.offers — same contract as PUT /v1/agents/:name/offers) ──

    mcp.tool(
        'aimeat_offer_price_set',
        descriptionFor('aimeat_offer_price_set'),
        {
            agent_name: z.string().min(1).max(100),
            offer_id: z.string().min(1).max(100),
            price_morsels: z.number().int().positive().optional(),
            money_amount_micros: z.number().int().positive().optional(),
            money_currency: z.enum(['EUR', 'USD']).optional(),
            clear_morsels: z.boolean().optional(),
            clear_money: z.boolean().optional(),
            visibility: z.enum(['private', 'unlisted', 'public']).optional(),
        },
        annotationsFor('aimeat_offer_price_set'),
        async ({ agent_name, offer_id, price_morsels, money_amount_micros, money_currency, clear_morsels, clear_money, visibility }) => {
            // Ownership: only the caller's OWN owner's agents — the GAII is built from the
            // session owner, never from input, so a foreign agent name simply won't resolve.
            const targetGaii = `${agent_name}#${owner}@${config.nodeId}`;
            const agent = await storage.getAgent(targetGaii);
            if (!agent) return fail(`AGENT_NOT_FOUND: you have no agent named "${agent_name}"`);
            const key = `agents.${agent_name}.offers`;
            const rec = await storage.getMemory(targetGaii, key);
            const doc = (rec?.value as { version?: number; offers?: Offer[] } | undefined) ?? { offers: [] };
            const offers = doc.offers ?? [];
            const offer = offers.find((o) => o.id === offer_id);
            if (!offer) return fail(`OFFER_NOT_FOUND: ${offer_id} (agent ${agent_name} has ${offers.length} offer(s))`);

            if (price_morsels !== undefined) offer.price = { morsels: price_morsels, unit: offer.price?.unit ?? 'per-call' };
            if (clear_morsels) offer.price = null;
            if (money_amount_micros !== undefined) {
                if (!money_currency || !isSupportedMoneyCurrency(money_currency)) {
                    return fail('CURRENCY_REQUIRED: money_amount_micros needs money_currency (EUR or USD)');
                }
                offer.priceMoney = { amount: integerMicros(money_amount_micros), currency: money_currency };
            }
            if (clear_money) offer.priceMoney = null;
            if (visibility) offer.visibility = visibility;

            // Same write-path contract as the REST route: the WHOLE document must validate.
            const parsed = OffersDocSchema.safeParse({ offers });
            if (!parsed.success) return fail(`INVALID_OFFERS: ${parsed.error.message}`);
            const now = new Date().toISOString();
            await storage.setMemory({
                key, ownerGaii: targetGaii,
                value: { version: (doc.version ?? 0) + 1, updatedAt: now, offers: parsed.data.offers },
                visibility: 'owner', tags: ['offers'], ttlHours: null,
                version: (rec?.version ?? 0) + 1, createdAt: rec?.createdAt ?? now, updatedAt: now,
            });
            emitChange('agents');
            // TARGET-050: an offer flagged `exchange` is projected onto the market from here.
            await reconcileAfterSourceWrite(storage, targetGaii, key);
            return ok({
                agent: agent_name, offer: offer_id,
                price: offer.price ?? null, priceMoney: offer.priceMoney ?? null,
                visibility: offer.visibility ?? 'private',
            });
        },
    );

    // ── Buyer: checkout sessions (src/commerce/session-service.ts — same core as REST/UCP/ACP) ──

    const itemShape = z.array(z.object({
        kind: z.enum(['offer', 'app-tool', 'ext-call']).optional(),
        agent: z.string().max(300).optional(),
        offer_id: z.string().max(100).optional(),
        org: z.string().max(200).optional(),
        app: z.string().max(300).optional(),
        tool: z.string().max(100).optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        quantity: z.number().int().positive().max(1000).optional(),
    })).min(1).max(20);

    mcp.tool(
        'aimeat_checkout_open',
        descriptionFor('aimeat_checkout_open'),
        {
            items: itemShape,
            note: z.string().max(2000).optional(),
            currency: z.string().min(3).max(10).optional(),
        },
        annotationsFor('aimeat_checkout_open'),
        async ({ items, note, currency }) => {
            if (!config.commerceEnabled) return fail('FEATURE_DISABLED: commerce is disabled on this node');
            try {
                const session = await createSession(storage, config, {
                    buyerOwner: owner, buyerIdentity: agentGaii, items, note, currency,
                });
                return ok({ session });
            } catch (err) { return commerceFail(err); }
        },
    );

    mcp.tool(
        'aimeat_checkout_complete',
        descriptionFor('aimeat_checkout_complete'),
        {
            session_id: z.string().min(1).max(120),
            handler: z.string().max(100).optional(),
        },
        annotationsFor('aimeat_checkout_complete'),
        async ({ session_id, handler }) => {
            if (!config.commerceEnabled) return fail('FEATURE_DISABLED: commerce is disabled on this node');
            try {
                const session = await getSession(storage, ownerGhii, session_id);
                if (!session) return fail(`SESSION_NOT_FOUND: ${session_id}`);
                // Callable app-tool fulfillment authenticates its capability invoke with the
                // buyer's token. The MCP layer holds no forwardable bearer, so mint a SHORT-LIVED
                // token for the CALLING AGENT ITSELF (same sub/owner/roles as its session — the
                // node is the token authority; this is re-issuance, not privilege escalation).
                // The agent's own scopes ride along. Omitting them meant a wildcard, so a
                // round trip through fulfillment handed back more authority than the session held.
                const fulfilAgent = await storage.getAgent(agentGaii);
                const callerJwt = await issueJWT(
                    {
                        sub: agentGaii, owner, node: config.nodeId, roles: ['agent'],
                        scopes: fulfilAgent?.defaultScopes ?? config.defaultAgentScopes,
                        mcp_client: 'mcp-commerce-fulfillment',
                    },
                    120,
                );
                // The completing principal, which this call used to omit entirely. Today it is
                // dormant — appSpendRefusal only bites role 'app', and an MCP session is always an
                // agent record — but "a fifth door cannot forget it" is exactly what the per-app
                // spend gate was written for, and this door forgot it. Passing the caller means the
                // day an app-grant or ecosystem principal can open an MCP session, contract:spend
                // and the per-app cap apply here without anyone remembering to come back.
                const completed = await completeSession(storage, config, session, handler, undefined, callerJwt, {
                    roles: ['agent'], scopes: sessionScopes, appGrantId: null,
                });
                return ok({ session: completed });
            } catch (err) { return commerceFail(err); }
        },
    );

    mcp.tool(
        'aimeat_checkout_list',
        descriptionFor('aimeat_checkout_list'),
        {
            limit: z.number().int().min(1).max(200).optional(),
            response_format: responseFormatSchema,
        },
        annotationsFor('aimeat_checkout_list'),
        async ({ limit, response_format }) => {
            const sessions = await listSessions(storage, ownerGhii, limit ?? 20);
            return ok(shapeResponse('aimeat_checkout_list', response_format, sessions));
        },
    );

    // ── Beneficiary splitting: the SECOND RAKE, taken from the seller's own cut ────
    //
    // The REST surface shipped without these, so configuring a split from a chat meant
    // hand-rolling a bearer token. Every one of them resolves the caller's OWN owner GHII and
    // never accepts a provider id from the argument list: the revenue being given away has to be
    // the giver's, and that is the whole cross-owner question here.

    /** Money micros and morsels are different KINDS of quantity, so they are bucketed, never summed. */
    function totalsOf(entries: BeneficiaryEntry[]): Record<string, { accrued: number; released: number; paid: number; reversed: number; entries: number }> {
        const totals: Record<string, { accrued: number; released: number; paid: number; reversed: number; entries: number }> = {};
        for (const e of entries) {
            // Keyed by currency. No morsel bucket: morsels pace usage and are never shared.
            const bucket = e.currency;
            const t = totals[bucket] ?? (totals[bucket] = { accrued: 0, released: 0, paid: 0, reversed: 0, entries: 0 });
            t[e.status] += e.amount;
            t.entries += 1;
        }
        return totals;
    }

    mcp.tool(
        'aimeat_commerce_beneficiary_split_set',
        descriptionFor('aimeat_commerce_beneficiary_split_set'),
        {
            ext: z.string().min(1).max(200),
            action: z.string().min(1).max(200),
            mode: z.enum(['pool', 'roles']).optional(),
            pool_percent: z.number().min(0).max(100).optional(),
            roles: z.array(z.object({
                role: z.string().min(1).max(80),
                percent: z.number().positive().max(100),
                ghii: z.string().min(3).max(200).nullable().optional(),
                note: z.string().max(2_000).optional(),
            })).max(BENEFICIARIES_MAX).optional(),
            beneficiaries: z.array(z.object({
                ghii: z.string().min(3).max(200),
                weight: z.number().positive().optional(),
                note: z.string().max(2_000).optional(),
            })).max(BENEFICIARIES_MAX).optional(),
            dynamic: z.boolean().optional(),
            capability: z.string().max(2_000).optional(),
            state: z.enum(['active', 'paused']).optional(),
        },
        annotationsFor('aimeat_commerce_beneficiary_split_set'),
        async ({ ext, action, mode, pool_percent, roles, beneficiaries, dynamic, capability, state }) => {
            const rows: BeneficiaryShare[] = (beneficiaries ?? []).map(b => ({
                ghii: b.ghii, weight: b.weight ?? 1, note: b.note ?? '',
            }));
            const bad = rows.find(b => b.ghii.indexOf('@') < 1);
            if (bad) return fail(`INVALID_GHII: "${bad.ghii}" is not an owner GHII (owner@node-id)`);
            const chain = (roles ?? []).map(r => ({
                role: r.role, percent: r.percent, ghii: r.ghii ?? null, note: r.note ?? '',
            }));
            const useRoles = (mode ?? 'pool') === 'roles';
            if (useRoles) {
                if (!chain.length) return fail('EMPTY_CHAIN: a role chain needs at least one role.');
                const total = chain.reduce((sum, r) => sum + r.percent, 0);
                if (total > 100) {
                    return fail(`ROLES_EXCEED_CUT: the roles total ${total} % of your cut, which is more than `
                        + 'you receive. Each role takes its own percent independently, so they must total at most 100.');
                }
            } else if (!rows.length && !dynamic) {
                return fail('EMPTY_SPLIT: a split with no beneficiaries and no dynamic:true would divide nothing. '
                    + 'Either list who shares it, or set dynamic:true so the capability may name them per call.');
            }
            const split = await putSplit(storage, {
                providerGhii: ownerGhii, ext, action, capabilityLabel: capability,
                mode: useRoles ? 'roles' : 'pool',
                poolPercent: useRoles ? 0 : (pool_percent ?? 0),
                beneficiaries: rows, roles: chain, dynamic: dynamic ?? false,
                state: state ?? 'active', createdBy: ownerGhii,
            });
            return ok({
                split,
                note: 'The pool is taken from YOUR cut, after the platform rake and never from the buyer\'s charge. '
                    + 'Shares accrue on every settled call; releasing one needs the beneficiary to be verified.',
            });
        },
    );

    mcp.tool(
        'aimeat_commerce_beneficiary_splits',
        descriptionFor('aimeat_commerce_beneficiary_splits'),
        {
            remove_ext: z.string().max(200).optional(),
            remove_action: z.string().max(200).optional(),
        },
        annotationsFor('aimeat_commerce_beneficiary_splits'),
        async ({ remove_ext, remove_action }) => {
            if (remove_ext || remove_action) {
                if (!remove_ext || !remove_action) return fail('INVALID_INPUT: withdrawing needs both remove_ext and remove_action');
                const removed = await deleteSplit(storage, ownerGhii, remove_ext, remove_action);
                if (!removed) return fail('NOT_FOUND: you have no split declared on that coordinate');
                return ok({
                    removed: true,
                    note: 'Future calls keep your whole cut. Shares already accrued still stand: what was earned does not un-happen.',
                });
            }
            const splits = await listSplitsByProvider(storage, ownerGhii);
            return ok({ splits, count: splits.length });
        },
    );

    mcp.tool(
        'aimeat_commerce_beneficiary_earnings',
        descriptionFor('aimeat_commerce_beneficiary_earnings'),
        {
            role: z.enum(['beneficiary', 'provider']).optional(),
            status: z.enum(['accrued', 'released', 'paid', 'reversed']).optional(),
            limit: z.number().int().min(1).max(1000).optional(),
        },
        annotationsFor('aimeat_commerce_beneficiary_earnings'),
        async ({ role, status, limit }) => {
            const max = limit ?? 200;
            if (role === 'provider') {
                const all = await listBeneficiaryObligations(storage, ownerGhii, max);
                const entries = status ? all.filter(e => e.status === status) : all;
                return ok({ role: 'provider', provider: ownerGhii, totals: totalsOf(entries), entries, count: entries.length });
            }
            const all = await listBeneficiaryEntries(storage, ownerGhii, max);
            const entries = status ? all.filter(e => e.status === status) : all;
            const gate = await beneficiaryEligibility(storage, config, ownerGhii);
            return ok({
                role: 'beneficiary', beneficiary: ownerGhii,
                verification: { state: gate.state, payable: gate.eligible, reason: gate.reason, message: gate.message },
                totals: totalsOf(entries), entries, count: entries.length,
                note: 'A share is owed by the PROVIDER, not by the buyer. It comes out of what the provider earned.',
            });
        },
    );

    mcp.tool(
        'aimeat_commerce_beneficiary_release',
        descriptionFor('aimeat_commerce_beneficiary_release'),
        {
            tracking_code: z.string().min(1).max(200),
            beneficiary: z.string().min(3).max(200),
        },
        annotationsFor('aimeat_commerce_beneficiary_release'),
        async ({ tracking_code, beneficiary }) => {
            const r = await releaseBeneficiaryShare(storage, config, {
                providerGhii: ownerGhii, beneficiaryGhii: beneficiary, trackingCode: tracking_code,
            });
            if (!r.ok) return fail(`${r.reason}: ${r.message}`);
            return ok({
                released: true, beneficiary, tracking_code,
                amount: r.entry.amount, currency: r.entry.currency, method: r.method,
                note: 'Booked onto their payable book. The money itself moves when you sign for it '
                    + 'with aimeat_commerce_beneficiary_payout.',
            });
        },
    );

    mcp.tool(
        'aimeat_commerce_beneficiary_approve',
        descriptionFor('aimeat_commerce_beneficiary_approve'),
        {
            ghii: z.string().min(3).max(200).optional(),
            state: z.enum(['verified', 'unverified', 'rejected']).optional(),
            method: z.string().max(120).optional(),
            subject: z.string().max(200).optional(),
            evidence: z.string().max(10_000).optional(),
        },
        annotationsFor('aimeat_commerce_beneficiary_approve'),
        async ({ ghii, state, method, subject, evidence }) => {
            // Same runtime check the admin tools use (core-admin.ts): read the OWNER record rather
            // than trust a session claim, because roles are not known at session-creation time.
            const ownerRec = await storage.getOwner(owner);
            const isOperator = !!ownerRec && ownerRec.roles.includes('operator');
            // READ path. Your own is yours to see; somebody else's verification state is an operator question.
            if (!state) {
                const target = ghii || ownerGhii;
                if (target !== ownerGhii && !isOperator) return fail('FORBIDDEN: you may read your own approval state only');
                const approval = await readApproval(storage, target);
                const gate = await beneficiaryEligibility(storage, config, target);
                return ok({ ghii: target, approval, state: gate.state, payable: gate.eligible, message: gate.message });
            }
            // WRITE path. Operator only: a gate a provider could open for their own payees is not a
            // gate. On top of the role, its own permission word — recording a beneficiary as
            // verified is what makes a payout possible, so it costs an explicit tick that no
            // wildcard carries rather than riding along with Full access.
            if (!isOperator) return fail('FORBIDDEN: recording an approval is an operator action');
            if (!scopeIsCovered(sessionScopes, 'commerce:beneficiary-verify')) {
                return fail('Recording a beneficiary approval needs the "commerce:beneficiary-verify" '
                    + 'permission, which this session does not carry.');
            }
            if (!ghii) return fail('INVALID_INPUT: name the beneficiary GHII to record an approval for');
            if (state === 'verified' && !method) {
                return fail('INVALID_INPUT: a verification must say HOW representation was established. '
                    + 'Set method, e.g. "suomifi-valtuudet" or "contract-on-file".');
            }
            const approval = await putApproval(storage, {
                ghii, state, method, subject: subject ?? null, evidence, verifiedBy: ownerGhii,
            });
            return ok({ approval });
        },
    );

    mcp.tool(
        'aimeat_commerce_beneficiary_payout',
        descriptionFor('aimeat_commerce_beneficiary_payout'),
        {
            beneficiary: z.string().min(3).max(200),
            currency: z.string().max(10).optional(),
            payment: z.record(z.string(), z.unknown()).optional(),
        },
        annotationsFor('aimeat_commerce_beneficiary_payout'),
        async ({ beneficiary, currency, payment }) => {
            // No signature yet -> QUOTE. The agent hands these requirements to whatever holds the
            // wallet; the node never sees a key.
            if (!payment) {
                const q = await quoteBeneficiaryPayout(storage, config, {
                    providerGhii: ownerGhii, beneficiaryGhii: beneficiary, currency,
                });
                if (!q.ok) return fail(`${q.reason}: ${q.message}`);
                return ok({
                    payable: true, beneficiary, amount: q.amount, currency: q.currency,
                    entries: q.entries.length, pay_to: q.payTo, accepts: [q.requirements],
                    note: 'Sign these requirements with the wallet that holds the funds, then call this '
                        + 'tool again with the signed payload as `payment`.',
                });
            }
            const r = await settleBeneficiaryPayout(storage, config, {
                providerGhii: ownerGhii, beneficiaryGhii: beneficiary, currency,
                payload: payment as unknown as X402PaymentPayload,
            });
            if (!r.ok) return fail(`${r.reason}: ${r.message}`);
            return ok({
                paid: true, beneficiary, amount: r.amount, currency: r.currency,
                entries: r.entries, tx_hash: r.txHash, pay_to: r.payTo,
                note: 'Settled onchain from your address into theirs. The node held nothing; the '
                    + 'transaction hash is the proof and those entries now read `paid`.',
            });
        },
    );
}
