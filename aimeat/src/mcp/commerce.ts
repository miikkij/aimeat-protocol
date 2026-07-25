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
 *   v1.0.0 — 2026-07-14 — Initial commerce MCP surface (PSP, app-tools, offer pricing, checkout)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, responseFormatSchema, shapeResponse } from './catalog/shape.js';
import { AppToolsDocSchema, appToolsKey } from '../models/app-tool-schemas.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';
import { reconcileAfterSourceWrite } from '../services/exchange-projection.js';
import { integerMicros, isSupportedMoneyCurrency } from '../commerce/money.js';
import { createSession, getSession, completeSession, listSessions, CommerceError } from '../commerce/session-service.js';
import { PaymentError } from '../commerce/payment-handlers.js';
import { issueJWT } from '../auth/jwt.js';
import { emitChange } from '../services/event-bus.js';

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

export function registerCommerceTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();
    const owner = parseGaiiLoose(agentGaii).owner;
    const ownerGhii = `${owner}@${config.nodeId}`;

    /** Upsert one memory record under the caller's OWNER GHII (the seller identity resolvers read). */
    async function putOwnerRecord(key: string, value: Record<string, unknown>, visibility: 'private' | 'public', tags: string[]): Promise<void> {
        const existing = await storage.getMemory(ownerGhii, key);
        const now = new Date().toISOString();
        await storage.setMemory({
            key, ownerGaii: ownerGhii, value, visibility, tags, ttlHours: null,
            version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
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
            await putOwnerRecord(PSP_KEY, { provider, secretKey: secret_key }, 'private', ['commerce']);
            return ok({ configured: true, provider, key_hint: maskSecret(secret_key), note: 'Stored server-side; money sales settle on this PSP account. The secret is never returned by any tool.' });
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
            tools: z.array(z.record(z.string(), z.unknown())).max(40),
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
            await putOwnerRecord(key, doc, 'public', ['commerce', 'app-tools']);
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
                return fail(`APP_TOOLS_NOT_FOUND: app "${targetOwner}/${app_id}" declares no ${targetOwner === owner ? '' : 'public '}tool manifest`);
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
        kind: z.enum(['offer', 'org-offering', 'app-tool', 'ext-call']).optional(),
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
                const callerJwt = await issueJWT(
                    { sub: agentGaii, owner, node: config.nodeId, roles: ['agent'], mcp_client: 'mcp-commerce-fulfillment' },
                    120,
                );
                const completed = await completeSession(storage, config, session, handler, undefined, callerJwt);
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
}
