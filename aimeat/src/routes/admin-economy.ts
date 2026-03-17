import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { randomBytes } from 'node:crypto';
import { emitChange } from '../services/event-bus.js';

export function adminEconomyRouter(
    config: AimeatConfig,
    storage: Storage,
): Router {
    const router = Router();

    // POST /v1/admin/mint — operator mints morsels for an agent (§16.1)
    router.post('/v1/admin/mint', requireAuth(), requireRole('operator'), async (req, res) => {
        const { gaii, amount } = req.body ?? {};

        if (!gaii || typeof gaii !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'gaii is required'));
            return;
        }
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'amount must be a positive integer'));
            return;
        }

        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent not found: ${gaii}`));
            return;
        }

        // Enforce daily mint cap (§16.1: max_operator_mint_per_day default 10,000)
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const allTx = await storage.listAllTransactions();
        const mintedToday = allTx
            .filter(tx => tx.type === 'mint' && new Date(tx.timestamp) >= dayStart)
            .reduce((sum, tx) => sum + tx.amount, 0);

        if (mintedToday + amount > config.maxOperatorMintPerDay) {
            res.status(429).json(error(config.nodeId, 'QUOTA_EXCEEDED',
                `Daily mint cap is ${config.maxOperatorMintPerDay} morsels. Already minted ${mintedToday} today. Requested ${amount} would exceed cap.`));
            return;
        }

        await storage.creditBalance(gaii, amount);
        await storage.addTransaction({
            id: `tx-${Date.now()}-${randomBytes(4).toString('hex')}`,
            gaii,
            type: 'mint',
            amount,
            counterpartyGaii: req.auth!.sub,
            timestamp: new Date().toISOString(),
        });

        const mintedAgent = await storage.getAgent(gaii);
        const mintedGhii = mintedAgent ? await storage.getGHIIByOwner(mintedAgent.owner) : null;
        res.json(success(config.nodeId, {
            gaii,
            minted: amount,
            new_balance: mintedGhii?.morselBalance ?? 0,
            daily_minted: mintedToday + amount,
            daily_cap: config.maxOperatorMintPerDay,
        }));
        emitChange('config');
    });

    return router;
}
