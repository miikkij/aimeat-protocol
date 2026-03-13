import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { calculateEscrow } from '../services/morsel.js';
import { MorselRequestSchema, validateBody } from '../models/schemas.js';
import { emitChange } from '../services/event-bus.js';

export function walletRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/wallet — check balance (agent or owner auth)
  router.get('/v1/wallet', requireAuth(), requireScope('wallet:read'), async (req, res) => {
    const roles = req.auth!.roles;
    const isOwner = roles.includes('owner');
    const isAgent = roles.includes('agent');

    let balance = 0;
    let identity = '';
    let inEscrow = 0;
    let transactions: Array<{ type: string; amount: number }> = [];

    if (isAgent) {
      const gaii = req.auth!.sub;
      const agent = await storage.getAgent(gaii);
      if (!agent) {
        res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', 'Agent not found'));
        return;
      }
      balance = agent.morselBalance;
      identity = gaii;
      inEscrow = await calculateEscrow(storage, gaii);
      transactions = await storage.getTransactions(gaii, 100_000) as Array<{ type: string; amount: number }>;
    } else if (isOwner) {
      // Owner accessing their own wallet — try GHII record first, fall back to owner identity
      const ownerName = req.auth!.owner as string;
      const ghiiRecord = await storage.getGHIIByOwner(ownerName);
      balance = ghiiRecord?.morselBalance ?? 0;
      identity = ghiiRecord?.ghii ?? req.auth!.sub;
      transactions = await storage.getTransactions(identity, 100_000) as Array<{ type: string; amount: number }>;
    } else {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Requires agent or owner role'));
      return;
    }

    // Calculate lifetime stats from transactions
    let earned = 0, spent = 0, receivedAllowance = 0, welcomeBonus = 0;
    for (const tx of transactions) {
      if (tx.type === 'earned') earned += tx.amount;
      if (tx.type === 'spent') spent += Math.abs(tx.amount);
      if (tx.type === 'allowance') receivedAllowance += tx.amount;
      if (tx.type === 'welcome_bonus') welcomeBonus += tx.amount;
    }

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      '@type': 'aimeat:Wallet',
      gaii: identity,
      balance,
      in_escrow: inEscrow,
      available: balance - inEscrow,
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
  router.get('/v1/wallet/transactions', requireAuth(), requireScope('wallet:read'), async (req, res) => {
    const identity = req.auth!.sub;
    const typeFilter = req.query.type as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string ?? '50', 10)));

    let transactions = await storage.getTransactions(identity, 100_000);
    if (typeFilter) {
      transactions = transactions.filter(tx => tx.type === typeFilter);
    }

    const start = (page - 1) * perPage;
    const paged = transactions.slice(start, start + perPage);

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      transactions: paged.map(tx => ({
        '@type': 'schema:TransferAction',
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

  // GET /v1/wallet/history — transaction history (DEPRECATED: use /v1/wallet/transactions)
  router.get('/v1/wallet/history', requireAuth(), async (req, res) => {
    res.setHeader('X-Deprecated', 'Use GET /v1/wallet/transactions instead');
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', '2026-09-01');
    res.setHeader('Link', '</v1/wallet/transactions>; rel="successor-version"');

    const gaii = req.auth!.sub;
    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
    const transactions = await storage.getTransactions(gaii, limit);

    res.json(success(config.nodeId, {
      '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
      transactions: transactions.map(tx => ({
        '@type': 'schema:TransferAction',
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        counterparty_gaii: tx.counterpartyGaii,
        tracking_code: tx.trackingCode,
        timestamp: tx.timestamp,
      })),
      total: transactions.length,
      _deprecated: 'This endpoint is deprecated. Use GET /v1/wallet/transactions instead.',
    }));
  });

  // POST /v1/wallet/request — request morsels (agent or owner auth)
  router.post('/v1/wallet/request', requireAuth(), validateBody(MorselRequestSchema, config.nodeId), async (req, res) => {
    const roles = req.auth!.roles;
    const isOwner = roles.includes('owner');
    const isAgent = roles.includes('agent');
    const { amount, reason } = req.body ?? {};
    const grantAmount = Math.min(amount ?? config.dailyAllowance, config.dailyAllowance);

    if (isAgent) {
      const gaii = req.auth!.sub;
      const agent = await storage.getAgent(gaii);
      if (!agent) {
        res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', 'Agent not found'));
        return;
      }

      const credited = await storage.creditBalanceCapped(gaii, grantAmount, config.dailyAllowanceCap);
      if (credited <= 0) {
        res.status(409).json(error(config.nodeId, 'QUOTA_EXCEEDED',
          `Balance is already at or above accumulation cap of ${config.dailyAllowanceCap}`));
        return;
      }

      await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        gaii,
        type: 'allowance',
        amount: credited,
        timestamp: new Date().toISOString(),
      });

      const updatedAgent = await storage.getAgent(gaii);
      res.json(success(config.nodeId, {
        '@type': 'schema:TransferAction',
        granted: credited,
        new_balance: updatedAgent?.morselBalance ?? 0,
        reason,
      }));
    } else if (isOwner) {
      const ownerName = req.auth!.owner as string;
      const ghiiRecord = await storage.getGHIIByOwner(ownerName);
      const identity = ghiiRecord?.ghii ?? req.auth!.sub;

      const currentBalance = ghiiRecord?.morselBalance ?? 0;
      if (currentBalance >= config.dailyAllowanceCap) {
        res.status(409).json(error(config.nodeId, 'QUOTA_EXCEEDED',
          `Balance is already at or above accumulation cap of ${config.dailyAllowanceCap}`));
        return;
      }
      const credited = Math.min(grantAmount, config.dailyAllowanceCap - currentBalance);

      if (ghiiRecord) {
        await storage.updateGHII(ghiiRecord.ghii, { morselBalance: currentBalance + credited });
      }

      await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        gaii: identity,
        type: 'allowance',
        amount: credited,
        timestamp: new Date().toISOString(),
      });

      res.json(success(config.nodeId, {
        '@type': 'schema:TransferAction',
        granted: credited,
        new_balance: currentBalance + credited,
        reason,
      }));
    } else {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Requires agent or owner role'));
      return;
    }
    emitChange('wallet');
  });

  return router;
}
