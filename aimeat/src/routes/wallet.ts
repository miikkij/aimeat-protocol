import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { calculateEscrow } from '../services/morsel.js';
import { MorselRequestSchema, validateBody } from '../models/schemas.js';

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

    const inEscrow = await calculateEscrow(storage, gaii);
    const transactions = await storage.getTransactions(gaii, 100_000);

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
      in_escrow: inEscrow,
      available: agent.morselBalance - inEscrow,
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
      { description: 'View transaction history', method: 'GET', url: '/v1/wallet/transactions' },
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'Request more morsels', method: 'POST', url: '/v1/wallet/request' },
    ]));
  });

  // GET /v1/wallet/transactions — transaction history (spec path)
  router.get('/v1/wallet/transactions', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const typeFilter = req.query.type as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string ?? '50', 10)));

    let transactions = await storage.getTransactions(gaii, 100_000);
    if (typeFilter) {
      transactions = transactions.filter(tx => tx.type === typeFilter);
    }

    const start = (page - 1) * perPage;
    const paged = transactions.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      transactions: paged.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        counterparty_gaii: tx.counterpartyGaii,
        tracking_code: tx.trackingCode,
        timestamp: tx.timestamp,
      })),
      total: transactions.length,
    }, undefined, { page, per_page: perPage, total: transactions.length }));
  });

  // GET /v1/wallet/history — transaction history (legacy path)
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

  // POST /v1/wallet/request — request morsels from operator (agent auth)
  router.post('/v1/wallet/request', requireAuth(), requireRole('agent'), validateBody(MorselRequestSchema, config.nodeId), async (req, res) => {
    const gaii = req.auth!.sub;
    const { amount, reason } = req.body ?? {};

    // Auto-approve small requests (up to daily allowance), log for operator review
    const grantAmount = Math.min(amount ?? config.dailyAllowance, config.dailyAllowance);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', 'Agent not found'));
      return;
    }

    if (agent.morselBalance + grantAmount > config.dailyAllowanceCap) {
      res.status(409).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Balance would exceed accumulation cap of ${config.dailyAllowanceCap}`));
      return;
    }

    await storage.updateAgent(gaii, { morselBalance: agent.morselBalance + grantAmount });
    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii,
      type: 'allowance',
      amount: grantAmount,
      timestamp: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      granted: grantAmount,
      new_balance: agent.morselBalance + grantAmount,
      reason,
    }));
  });

  return router;
}
