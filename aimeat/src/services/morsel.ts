/**
 * @file src/services/morsel.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Morsel economy service — escrow, settlement, and allowance logic for work requests.
 *   Uses atomic debit/credit storage ops to avoid TOCTOU double-spend and splits network fees
 *   across provider/requester/relay/registry nodes per RFC §10.11/§16.2.
 *
 * @structure
 *   - calculateWorkCost: pacing amount (toll) + 10% network fee → escrow total
 *   - presentWorkCost: the escrow as a response shows it, with the deprecated base_price mirror
 *   - holdEscrow/returnEscrow: atomically debit/credit escrow with transaction logs
 *   - routingFee: the 1-morsel fee of one route to another node, taken when the call goes out and
 *     given back when no route was made
 *   - settlePayment: burn + fee split + pay provider on successful delivery
 *   - applyDailyAllowance: capped daily allowance credit
 *   - calculateEscrow: sum in-escrow amounts across a requester's open work
 *   - mintMorsels: operator mint against the daily cap, for every door that mints
 *
 * @version-history
 *   2026-10-15 — morselsInCirculation(): the sum of the account holders' balances, for the admin dashboard and aimeat_admin_stats (feature-list audit #169).
 *   2026-10-15 — mintMorsels reads the shared daily ceiling, addedToday: mints and sold pacing packs,
 *     summed by the database (feature-list audit 176).
 *   v1.3.0 — 2026-10-11 — calculateWorkCost names the escrowed amount `toll`, the action's pacing
 *     amount (was `basePrice`); the arithmetic is unchanged. presentWorkCost: the response shape, with
 *     the old field as a deprecated mirror until MORSEL_PRICE_FIELDS_REMOVED_IN (ruling
 *     decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa).
 *   v1.2.0 — 2026-09-26 — routingFee(): the routing fee of one route to another node, for every
 *     endpoint that routes a call. The endpoint takes it when the call goes out, after its checks; a
 *     balance that cannot cover it stops the route; it goes back, with a `<type>_return` line, when the
 *     far end cannot be reached or responds with an error (secaudit 2026-09, R4 6).
 *   v1.1.0 — 2026-08-11 — mintMorsels() added, and POST /v1/admin/mint and aimeat_admin_mint both
 *     call it. They were two implementations of the same mint: the same cap arithmetic, the same
 *     credit and the same ledger row written twice, and they had already drifted — the tool told the
 *     live wallet stream about the new balance and the HTTP route did not, so a mint made from the
 *     admin page left an open wallet view showing the old number until something else refreshed it.
 *     The wallet emit is what both do now. (August 2026 audit step 8.)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, WorkRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { legacyMorselFieldsLive, MORSEL_PRICE_DEPRECATION } from '../config-pacing.js';
import { addedToday } from './mint-ceiling.js';


export interface SettlementResult {
    providerEarnings: number;
    networkFee: number;
    burned: number;
    providerNodeShare: number;
    requesterNodeShare: number;
    relayShare: number;
    registryShare: number;
    relayNodes: string[];
}

/**
 * What a work request holds in escrow. `toll` is the action's PACING amount (ruling
 * decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa): a morsel paces the request and is
 * never its price. The escrow holds the pacing amount plus a 10% network fee; on acceptance the
 * pacing amount goes to the provider and the network fee is burned or split per the burn rate
 * (settlePayment). The field was `basePrice` until 3.26.x.
 */
export function calculateWorkCost(tollMorsels: number, _burnRate: number): WorkRecord['cost'] {
    const networkFee = Math.ceil(tollMorsels * 0.1);
    const total = tollMorsels + networkFee;
    return { toll: tollMorsels, networkFee, total, inEscrow: total };
}

/**
 * A work item's escrow as a response shows it. `toll` is the pacing amount; until
 * MORSEL_PRICE_FIELDS_REMOVED_IN the old `base_price` (snake) or `basePrice` (camel) field mirrors it,
 * with a `deprecated` note on the same level, so a 3.x client keeps reading the number it read before.
 */
export function presentWorkCost(cost: WorkRecord['cost'], style: 'snake' | 'camel'): Record<string, unknown> {
    const mirror = legacyMorselFieldsLive();
    if (style === 'camel') {
        const out: Record<string, unknown> = { toll: cost.toll, networkFee: cost.networkFee, total: cost.total, inEscrow: cost.inEscrow };
        if (mirror) { out.basePrice = cost.toll; out.deprecated = { basePrice: MORSEL_PRICE_DEPRECATION }; }
        return out;
    }
    const out: Record<string, unknown> = { toll: cost.toll, network_fee: cost.networkFee, total: cost.total, in_escrow: cost.inEscrow };
    if (mirror) { out.base_price = cost.toll; out.deprecated = { base_price: MORSEL_PRICE_DEPRECATION }; }
    return out;
}

/**
 * Hold morsels in escrow for a work request.
 * Uses atomic debitBalance to prevent double-spending (TOCTOU race condition).
 */
export async function holdEscrow(
    storage: Storage,
    requesterGaii: string,
    providerGaii: string,
    trackingCode: string,
    total: number,
): Promise<boolean> {
    const debited = await storage.debitBalance(requesterGaii, total);
    if (!debited) return false;

    await storage.addTransaction({
        id: `tx-${randomUUID()}`,
        gaii: requesterGaii,
        type: 'escrow_hold',
        amount: -total,
        counterpartyGaii: providerGaii,
        trackingCode,
        timestamp: new Date().toISOString(),
    });

    return true;
}

/**
 * Settle payment after successful delivery.
 * RFC §10.11 / §16.2: Network fee split — provider node 40%, requester node 20%,
 * relay nodes 20% (split among route), registry 20%. Burn applied first.
 *
 * @param relayPath Optional array of relay node IDs that forwarded the request.
 */
export async function settlePayment(
    storage: Storage,
    config: AimeatConfig,
    work: WorkRecord,
    relayPath: string[] = [],
): Promise<SettlementResult> {
    // `toll` is the pacing amount held in escrow, not a price; it is released to the provider here.
    const { toll, networkFee } = work.cost;

    // Burn portion of network fee (applied first)
    const burned = Math.floor(networkFee * config.burnRate);
    const remainingFee = networkFee - burned;

    // Fee distribution per RFC §10.11
    const providerNodeShare = Math.floor(remainingFee * 0.4);
    const requesterNodeShare = Math.floor(remainingFee * 0.2);
    const relayShare = Math.floor(remainingFee * 0.2);
    const registryShare = remainingFee - providerNodeShare - requesterNodeShare - relayShare; // ~20%, absorbs rounding

    // Release the escrowed pacing amount to the provider (atomic credit prevents race conditions)
    const credited = await storage.creditBalance(work.providerGaii, toll);
    if (credited) {
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.providerGaii,
            type: 'earned',
            amount: toll,
            counterpartyGaii: work.requesterGaii,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }

    // Log burn transaction
    if (burned > 0) {
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.requesterGaii,
            type: 'burn',
            amount: -burned,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }

    // Log network fee
    if (networkFee > 0) {
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.requesterGaii,
            type: 'network_fee',
            amount: -networkFee,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }

    // Log relay fee distribution — split equally among relay nodes
    if (relayShare > 0 && relayPath.length > 0) {
        const perRelay = Math.floor(relayShare / relayPath.length);
        for (const relayNodeId of relayPath) {
            if (perRelay > 0) {
                await storage.addTransaction({
                    id: `tx-${randomUUID()}`,
                    gaii: work.requesterGaii,
                    type: 'relay_fee',
                    amount: -perRelay,
                    trackingCode: work.trackingCode,
                    counterpartyGaii: relayNodeId,
                    timestamp: new Date().toISOString(),
                });
            }
        }
    } else if (relayShare > 0) {
        // No relays in path — relay share stays on provider node (RFC fallback)
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.requesterGaii,
            type: 'relay_fee_unallocated',
            amount: -relayShare,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }

    // Log registry share
    if (registryShare > 0) {
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.requesterGaii,
            type: 'registry_fee',
            amount: -registryShare,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }

    return {
        providerEarnings: toll, networkFee, burned,
        providerNodeShare, requesterNodeShare, relayShare, registryShare,
        relayNodes: relayPath,
    };
}

/**
 * Return escrow to requester (for rejections, disputes won by requester, etc.)
 * Uses atomic creditBalance to prevent race conditions.
 */
export async function returnEscrow(
    storage: Storage,
    work: WorkRecord,
    amount?: number,
): Promise<void> {
    const returnAmount = amount ?? work.cost.total;
    const credited = await storage.creditBalance(work.requesterGaii, returnAmount);
    if (credited) {
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.requesterGaii,
            type: 'escrow_return',
            amount: returnAmount,
            counterpartyGaii: work.providerGaii,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }
}

/** The fee for routing one call to another node (§15), in morsels. */
export const ROUTING_FEE_MORSELS = 1;

/** One route's fee: taken when the call goes out, given back when no route was made. */
export interface RoutingFee {
    /**
     * Take the fee, once per route; a second call does nothing. False when the payer's balance
     * cannot cover it, and then the endpoint refuses the route (402 INSUFFICIENT_MORSELS) and sends
     * nothing.
     */
    take(): Promise<boolean>;
    /** Give a taken fee back, with a ledger line of its own. Does nothing when no fee was taken. */
    giveBack(): Promise<void>;
}

/**
 * The routing fee of one route, for every endpoint that routes a call to another node: work asked of
 * a provider there (routes/work.ts createWorkItem), POST /v1/federation/route and
 * POST /v1/federation/cross-node/work (routes/federation-sync/routing.ts).
 *
 * A morsel paces what a person sends to other nodes, so the fee is taken for a route that is made
 * and for nothing else. The endpoint takes it when the call goes out, after every check that can
 * refuse the route, and gives it back when the far end cannot be reached or responds with an error.
 *
 * `payer` is the identity of whoever starts the route: debitBalance takes an agent's fee from its
 * owner, and addTransaction files the line under the owner with the agent as the one who called.
 * `null` means no fee, as on a node that relays a hop of someone else's route. The ledger lines are
 * `type` (-1) and `${type}_return` (+1), both with the given tracking code.
 */
export function routingFee(
    storage: Storage,
    payer: string | null,
    ledger: { type: string; trackingCode?: string },
): RoutingFee {
    let taken = false;
    const line = (type: string, amount: number) => storage.addTransaction({
        id: `tx-${randomUUID()}`,
        gaii: payer as string,
        type,
        amount,
        ...(ledger.trackingCode ? { trackingCode: ledger.trackingCode } : {}),
        timestamp: new Date().toISOString(),
    });
    return {
        async take() {
            if (!payer || taken) return true;
            if (!(await storage.debitBalance(payer, ROUTING_FEE_MORSELS))) return false;
            taken = true;
            await line(ledger.type, -ROUTING_FEE_MORSELS);
            return true;
        },
        async giveBack() {
            if (!payer || !taken) return;
            taken = false;
            if (await storage.creditBalance(payer, ROUTING_FEE_MORSELS)) {
                await line(`${ledger.type}_return`, ROUTING_FEE_MORSELS);
            }
        },
    };
}

/**
 * Apply daily allowance to an agent.
 * Uses atomic creditBalanceCapped to prevent race conditions.
 */
export async function applyDailyAllowance(
    storage: Storage,
    config: AimeatConfig,
    gaii: string,
): Promise<number> {
    const credited = await storage.creditBalanceCapped(gaii, config.dailyAllowance, config.dailyAllowanceCap);
    if (credited <= 0) return 0;

    await storage.addTransaction({
        id: `tx-${randomUUID()}`,
        gaii,
        type: 'allowance',
        amount: credited,
        timestamp: new Date().toISOString(),
    });

    return credited;
}

export type MintResult =
    | { ok: true; minted: number; newBalance: number; mintedToday: number; dailyCap: number }
    | { ok: false; status: number; code: string; message: string };

/**
 * Mint morsels into an agent's owner balance as the operator (§16.1).
 *
 * The daily cap is the reason this is one function and not a line of route code: it is read from
 * every 'mint' row since the UTC day boundary, and a second door that computed it separately would
 * have been a second answer to "how much has been minted today".
 *
 * The operator check itself belongs to the door (requireRole on HTTP, the runtime role lookup on
 * MCP), because the two prove the caller differently.
 */
export async function mintMorsels(
    { storage, config }: { storage: Storage; config: AimeatConfig },
    operatorGaii: string,
    gaii: string,
    amount: number,
): Promise<MintResult> {
    if (!gaii || typeof gaii !== 'string') {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'gaii is required' };
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'amount must be a positive integer' };
    }

    const agent = await storage.getAgent(gaii);
    if (!agent) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Agent not found: ${gaii}` };
    }

    // Enforce daily mint cap (§16.1: max_operator_mint_per_day default 10,000). Mints and sold pacing
    // packs share it, summed by the database: this counted mint rows only, over the newest 10 000
    // rows (services/mint-ceiling.ts; feature-list audit 176).
    const mintedToday = await addedToday(storage);

    if (mintedToday + amount > config.maxOperatorMintPerDay) {
        return {
            ok: false, status: 429, code: 'QUOTA_EXCEEDED',
            message: `Daily mint cap is ${config.maxOperatorMintPerDay} morsels. Already minted ${mintedToday} today. Requested ${amount} would exceed cap.`,
        };
    }

    await storage.creditBalance(gaii, amount);
    await storage.addTransaction({
        id: `tx-${Date.now()}-${randomBytes(4).toString('hex')}`,
        gaii,
        type: 'mint',
        amount,
        counterpartyGaii: operatorGaii,
        timestamp: new Date().toISOString(),
    });

    // The mint moves a balance and the node's economy figures at once, so both domains hear it.
    emitChange('config');
    emitChange('wallet');

    const mintedAgent = await storage.getAgent(gaii);
    const mintedGhii = mintedAgent ? await storage.getGHIIByOwner(mintedAgent.owner) : null;
    return {
        ok: true,
        minted: amount,
        newBalance: mintedGhii?.morselBalance ?? 0,
        mintedToday: mintedToday + amount,
        dailyCap: config.maxOperatorMintPerDay,
    };
}

/**
 * Morsels in circulation: the sum of every account holder's balance. A balance lives on the person's
 * GHII (GHIIRecord.morselBalance); agent and ecosystem rows always hold 0, so the dashboard's sum over
 * agent rows answered 0 on every node. GET /v1/admin/dashboard and aimeat_admin_stats both read this
 * (feature-list audit #169).
 */
export async function morselsInCirculation(storage: Storage): Promise<number> {
    const owners = new Set((await storage.listOwners()).map(o => o.name));
    let total = 0;
    for (const g of await storage.listGHIIs()) {
        if (owners.has(g.ownerName)) total += g.morselBalance ?? 0;
    }
    return total;
}

/**
 * Calculate in_escrow total for an agent.
 */
export async function calculateEscrow(storage: Storage, gaii: string): Promise<number> {
    const asRequester = await storage.listWorkByRequester(gaii);
    let inEscrow = 0;
    for (const w of asRequester) {
        if (['pending', 'accepted', 'in_progress'].includes(w.status)) {
            inEscrow += w.cost.inEscrow;
        }
    }
    return inEscrow;
}
