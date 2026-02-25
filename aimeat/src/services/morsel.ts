import type { MeatConfig } from '../config.js';
import type { Storage, WorkRecord } from '../storage/interface.js';

export interface SettlementResult {
    providerEarnings: number;
    networkFee: number;
    burned: number;
    providerNodeShare: number;
    requesterNodeShare: number;
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
 */
export async function holdEscrow(
    storage: Storage,
    requesterGaii: string,
    providerGaii: string,
    trackingCode: string,
    total: number,
): Promise<boolean> {
    const requester = await storage.getAgent(requesterGaii);
    if (!requester || requester.morselBalance < total) return false;

    await storage.updateAgent(requesterGaii, {
        morselBalance: requester.morselBalance - total,
    });

    await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
 * RFC Section 8: Network fee split — provider node 40%, requester node 20%, relay 20%, registry 20%.
 * Burn rate applied to network fee.
 */
export async function settlePayment(
    storage: Storage,
    config: MeatConfig,
    work: WorkRecord,
): Promise<SettlementResult> {
    const { basePrice, networkFee, total } = work.cost;

    // Burn portion of network fee
    const burned = Math.floor(networkFee * config.burnRate);
    const remainingFee = networkFee - burned;

    // Fee distribution (simplified for single-node: all stays on this node)
    const providerNodeShare = Math.floor(remainingFee * 0.4);
    const requesterNodeShare = Math.floor(remainingFee * 0.2);

    // Pay provider the base price
    const provider = await storage.getAgent(work.providerGaii);
    if (provider) {
        await storage.updateAgent(work.providerGaii, {
            morselBalance: provider.morselBalance + basePrice,
        });
        await storage.addTransaction({
            id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
            id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
            id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            gaii: work.requesterGaii,
            type: 'network_fee',
            amount: -networkFee,
            trackingCode: work.trackingCode,
            timestamp: new Date().toISOString(),
        });
    }

    return { providerEarnings: basePrice, networkFee, burned, providerNodeShare, requesterNodeShare };
}

/**
 * Return escrow to requester (for rejections, disputes won by requester, etc.)
 */
export async function returnEscrow(
    storage: Storage,
    work: WorkRecord,
    amount?: number,
): Promise<void> {
    const returnAmount = amount ?? work.cost.total;
    const requester = await storage.getAgent(work.requesterGaii);
    if (requester) {
        await storage.updateAgent(work.requesterGaii, {
            morselBalance: requester.morselBalance + returnAmount,
        });
        await storage.addTransaction({
            id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
 */
export async function applyDailyAllowance(
    storage: Storage,
    config: MeatConfig,
    gaii: string,
): Promise<number> {
    const agent = await storage.getAgent(gaii);
    if (!agent) return 0;

    const newBalance = Math.min(agent.morselBalance + config.dailyAllowance, config.dailyAllowanceCap);
    const credited = newBalance - agent.morselBalance;
    if (credited <= 0) return 0;

    await storage.updateAgent(gaii, { morselBalance: newBalance });
    await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
