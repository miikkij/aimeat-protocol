import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, WorkRecord } from '../storage/interface.js';

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
export function calculateWorkCost(baseMorsels: number, burnRate: number) {
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
    const { basePrice, networkFee, total } = work.cost;

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
