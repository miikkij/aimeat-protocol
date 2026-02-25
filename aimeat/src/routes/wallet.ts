import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function walletRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/wallet — check balance (agent auth)
  router.get('/v1/wallet', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', 'Agent not found'));
      return;
    }

    const transactions = await storage.getTransactions(gaii, 50);

    // Calculate lifetime stats from transactions
    let earned = 0, spent = 0, receivedAllowance = 0, welcomeBonus = 0;
    for (const tx of transactions) {
      if (tx.type === 'earned') earned += tx.amount;
      if (tx.type === 'spent') spent += Math.abs(tx.amount);
      if (tx.type === 'allowance') receivedAllowance += tx.amount;
      if (tx.type === 'welcome_bonus') welcomeBonus += tx.amount;
    }

    res.json(success(config.nodeId, {
      gaii,
      balance: agent.morselBalance,
      in_escrow: 0,  // TODO: calculate from active work items
      available: agent.morselBalance,
      daily_allowance: {
        amount: config.dailyAllowance,
        accumulation_cap: config.dailyAllowanceCap,
      },
      lifetime: {
        earned,
        spent,
        received_allowance: receivedAllowance,
        welcome_bonus: welcomeBonus,
      },
    }, [
      { description: 'View transaction history', method: 'GET', url: '/v1/wallet/history' },
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
    ]));
  });

  // GET /v1/wallet/history — transaction history (agent auth)
  router.get('/v1/wallet/history', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
    const transactions = await storage.getTransactions(gaii, limit);

    res.json(success(config.nodeId, {
      transactions: transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        counterparty_gaii: tx.counterpartyGaii,
        tracking_code: tx.trackingCode,
        timestamp: tx.timestamp,
      })),
      total: transactions.length,
    }));
  });

  return router;
}
