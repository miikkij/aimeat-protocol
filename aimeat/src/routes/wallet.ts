/**
 * @file wallet.ts
 * @description Wallet routes for the morsel economy — balance check, transaction history,
 *   and morsel request. All endpoints resolve to the owner's single GHII-based balance;
 *   the storage layer handles GAII-to-GHII identity resolution internally.
 * @structure
 *   - GET  /v1/wallet              — current balance, escrow, lifetime stats
 *   - GET  /v1/wallet/transactions — paginated transaction history
 *   - GET  /v1/wallet/history      — deprecated alias for /transactions
 *   - POST /v1/wallet/request      — request daily allowance morsels
 * @version-history
 *   v1.0.0 — 2026-03-17 — Simplify to single GHII-based balance (remove dual agent/owner paths)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, WalletTransaction } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { calculateEscrow } from '../services/morsel.js';
import { MorselRequestSchema, validateBody } from '../models/schemas.js';
import { emitChange } from '../services/event-bus.js';

export function walletRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/wallet — check balance (single GHII-based balance)
  router.get('/v1/wallet', requireAuth(), requireScope('wallet:read'), async (req, res) => {
    const ownerName = req.auth!.owner as string;
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII record not found'));
      return;
    }

    const identity = ghiiRecord.ghii;
    const balance = ghiiRecord.morselBalance ?? 0;
    const transactions = await storage.getTransactions(identity, 100_000);

    // Escrow is tracked per-agent (work items reference GAIIs), so iterate agents
    let inEscrow = 0;
    const agents = await storage.getAgentsByOwner(ownerName);
    for (const agent of agents) {
      inEscrow += await calculateEscrow(storage, agent.gaii);
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
    const typeFilter = req.query.type as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string ?? '50', 10)));

    const ownerName = req.auth!.owner as string;
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    let transactions: WalletTransaction[] = ghiiRecord
      ? await storage.getTransactions(ghiiRecord.ghii, 100_000)
      : [];
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

    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
    const ownerName = req.auth!.owner as string;
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    const transactions: WalletTransaction[] = ghiiRecord
      ? (await storage.getTransactions(ghiiRecord.ghii, limit))
      : [];

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

  // POST /v1/wallet/request — request morsels (single GHII-based balance)
  router.post('/v1/wallet/request', requireAuth(), validateBody(MorselRequestSchema, config.nodeId), async (req, res) => {
    const { amount, reason } = req.body ?? {};
    const grantAmount = Math.min(amount ?? config.dailyAllowance, config.dailyAllowance);

    const ownerName = req.auth!.owner as string;
    const ghiiRecord = await storage.getGHIIByOwner(ownerName);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'GHII record not found'));
      return;
    }

    const identity = ghiiRecord.ghii;
    const credited = await storage.creditBalanceCapped(identity, grantAmount, config.dailyAllowanceCap);
    if (credited <= 0) {
      res.status(409).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Balance is already at or above accumulation cap of ${config.dailyAllowanceCap}`));
      return;
    }

    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii: identity,
      type: 'allowance',
      amount: credited,
      timestamp: new Date().toISOString(),
    });

    const updatedRecord = await storage.getGHIIByOwner(ownerName);
    res.json(success(config.nodeId, {
      '@type': 'schema:TransferAction',
      granted: credited,
      new_balance: updatedRecord?.morselBalance ?? 0,
      reason,
    }));
    emitChange('wallet');
  });

  return router;
}
