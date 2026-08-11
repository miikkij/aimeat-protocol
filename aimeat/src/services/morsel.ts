/**
 * @file src/services/morsel.ts
 * @description Morsel economy service — escrow, settlement, and allowance logic for work requests.
 *   Uses atomic debit/credit storage ops to avoid TOCTOU double-spend and splits network fees
 *   across provider/requester/relay/registry nodes per RFC §10.11/§16.2.
 *
 * @structure
 *   - calculateWorkCost: base price + 10% network fee → escrow total
 *   - holdEscrow/returnEscrow: atomically debit/credit escrow with transaction logs
 *   - settlePayment: burn + fee split + pay provider on successful delivery
 *   - applyDailyAllowance: capped daily allowance credit
 *   - calculateEscrow: sum in-escrow amounts across a requester's open work
 *   - mintMorsels: operator mint against the daily cap, for every door that mints
 *
 * @version-history
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
 * Calculate morsel costs for a work request.
 */
export function calculateWorkCost(baseMorsels: number, _burnRate: number) {
    const networkFee = Math.ceil(baseMorsels * 0.1);
    const total = baseMorsels + networkFee;
    return { basePrice: baseMorsels, networkFee, total, inEscrow: total };
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
    const { basePrice, networkFee } = work.cost;

    // Burn portion of network fee (applied first)
    const burned = Math.floor(networkFee * config.burnRate);
    const remainingFee = networkFee - burned;

    // Fee distribution per RFC §10.11
    const providerNodeShare = Math.floor(remainingFee * 0.4);
    const requesterNodeShare = Math.floor(remainingFee * 0.2);
    const relayShare = Math.floor(remainingFee * 0.2);
    const registryShare = remainingFee - providerNodeShare - requesterNodeShare - relayShare; // ~20%, absorbs rounding

    // Pay provider the base price (atomic credit prevents race conditions)
    const credited = await storage.creditBalance(work.providerGaii, basePrice);
    if (credited) {
        await storage.addTransaction({
            id: `tx-${randomUUID()}`,
            gaii: work.providerGaii,
            type: 'earned',
            amount: basePrice,
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
        providerEarnings: basePrice, networkFee, burned,
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

    // Enforce daily mint cap (§16.1: max_operator_mint_per_day default 10,000)
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const allTx = await storage.listAllTransactions();
    const mintedToday = allTx
        .filter(tx => tx.type === 'mint' && new Date(tx.timestamp) >= dayStart)
        .reduce((sum, tx) => sum + tx.amount, 0);

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
