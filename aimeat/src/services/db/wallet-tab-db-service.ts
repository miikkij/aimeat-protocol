/**
 * @file src/services/db/wallet-tab-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Purpose-built Application DB Service for the profile Wallet tab — the ONE call behind
 *   GET /v1/wallet/overview. The tab mounts a 5-request fan-out: the tab itself (wallet + transactions),
 *   plus two child sections (SellingSection → /v1/commerce/payout; MoneyActivity → checkout-sessions +
 *   orders). This folds the FOUR core reads (wallet + transactions + checkout-sessions + orders) into one
 *   read scope; the transaction ledger is read ONCE and serves both the lifetime stats and the recent
 *   list. The Selling & payments section reads the seller's payout rails from a different endpoint and
 *   is conditionally rendered, so it stays self-fetching. Single-master: serves the Wallet tab mount
 *   only; the individual endpoints stay for interactive re-fetches.
 *
 * @structure WalletTabService.overview(ownerName, ownerGhii) → { wallet, transactions, checkoutSessions, orders }
 * @usage const w = await createWalletTabService(config, storage).overview(owner, `${owner}@${nodeId}`);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Wallet tab's 4 core reads into one composite.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, WalletTransaction } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { calculateEscrow } from '../morsel.js';
import { cached, TTL } from '../cache.js';
import { listSessions, listOrders } from '../../commerce/session-service.js';

export interface WalletOverview {
  wallet: Record<string, unknown> | null;
  transactions: { transactions: Array<Record<string, unknown>>; total: number };
  checkoutSessions: { sessions: unknown[]; total: number };
  orders: { orders: unknown[]; total: number };
}

export class WalletTabService {
  constructor(private readonly config: AimeatConfig, private readonly storage: Storage) {}

  /**
   * The Wallet tab mount for one owner in a single read scope. The transaction ledger is read ONCE
   * (mirroring GET /v1/wallet + /v1/wallet/transactions, which each read it) and drives both the lifetime
   * totals and the recent-20 list. Escrow stays behind its 60s owner cache (same key/tags as /v1/wallet).
   */
  overview(ownerName: string, ownerGhii: string): Promise<WalletOverview> {
    return runInReadScope(async () => {
      const ghiiRecord = await this.storage.getGHIIByOwner(ownerName);
      if (!ghiiRecord) {
        return { wallet: null, transactions: { transactions: [], total: 0 }, checkoutSessions: { sessions: [], total: 0 }, orders: { orders: [], total: 0 } };
      }
      const identity = ghiiRecord.ghii;
      const balance = ghiiRecord.morselBalance ?? 0;

      const [allTx, inEscrow, sessions, orders] = await Promise.all([
        this.storage.getTransactions(identity, 100_000),
        // Escrow is per-agent (work items reference GAIIs); cached 60s per owner (same key + domain tags
        // as GET /v1/wallet so the shared cache entry serves both).
        cached(`escrow:${ownerName}`, TTL.dashboard, async () => {
          const agents = await this.storage.getAgentsByOwner(ownerName);
          let total = 0;
          for (const a of agents) total += await calculateEscrow(this.storage, a.gaii);
          return total;
        }, ['domain:work', 'domain:wallet']),
        listSessions(this.storage, ownerGhii, 100),   // buyer's checkout sessions (purchases)
        listOrders(this.storage, ownerGhii, 100),      // seller's received orders (sales)
      ]);

      // Lifetime totals from the single ledger read (mirrors GET /v1/wallet).
      let earned = 0, spent = 0, receivedAllowance = 0, welcomeBonus = 0;
      for (const tx of allTx as WalletTransaction[]) {
        if (tx.type === 'earned') earned += tx.amount;
        else if (tx.type === 'spent') spent += Math.abs(tx.amount);
        else if (tx.type === 'allowance') receivedAllowance += tx.amount;
        else if (tx.type === 'welcome_bonus') welcomeBonus += tx.amount;
      }

      const wallet = {
        gaii: identity,
        balance,
        in_escrow: inEscrow,
        available: balance - inEscrow,
        daily_allowance: { amount: this.config.dailyAllowance, accumulation_cap: this.config.dailyAllowanceCap },
        lifetime: { earned, spent, received_allowance: receivedAllowance, welcome_bonus: welcomeBonus },
      };

      // Recent list — first 20, in the GET /v1/wallet/transactions row shape.
      const transactions = {
        transactions: (allTx as WalletTransaction[]).slice(0, 20).map(tx => ({
          id: tx.id, type: tx.type, amount: tx.amount, counterparty_gaii: tx.counterpartyGaii,
          tracking_code: tx.trackingCode, timestamp: tx.timestamp,
        })),
        total: allTx.length,
      };

      return {
        wallet,
        transactions,
        checkoutSessions: { sessions, total: sessions.length },
        orders: { orders, total: orders.length },
      };
    });
  }
}

/** Assemble the Wallet tab composite over the given storage. */
export function createWalletTabService(config: AimeatConfig, storage: Storage): WalletTabService {
  return new WalletTabService(config, storage);
}
