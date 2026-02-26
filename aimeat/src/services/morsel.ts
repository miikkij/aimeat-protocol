import type { MeatConfig } from '../config.js';
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
 * RFC §10.11 / §16.2: Network fee split — provider node 40%, requester node 20%,
 * relay nodes 20% (split among route), registry 20%. Burn applied first.
 *
 * @param relayPath Optional array of relay node IDs that forwarded the request.
 */
export async function settlePayment(
    storage: Storage,
    config: MeatConfig,
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

    // Log relay fee distribution — split equally among relay nodes
    if (relayShare > 0 && relayPath.length > 0) {
        const perRelay = Math.floor(relayShare / relayPath.length);
        for (const relayNodeId of relayPath) {
            if (perRelay > 0) {
                await storage.addTransaction({
                    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
            id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
            id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
