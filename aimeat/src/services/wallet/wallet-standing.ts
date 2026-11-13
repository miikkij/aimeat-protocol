/**
 * @file src/services/wallet/wallet-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An account's wallet as one caller reads it: the owner's GHII record, the balance, and
 *   the morsels held in escrow for work in flight. The wallet is the owner's, shared by every agent of
 *   the account, and escrow is tracked per identity (a work item names the person's GHII or an agent's
 *   GAII), so the escrow is summed over the person and all their agents. GET /v1/wallet did that; the
 *   MCP tool aimeat_wallet_balance summed only the calling agent's own work, so a sibling agent read the
 *   whole balance as spendable while another agent's work held part of it (structure programme
 *   2026-11, unit 2b, B3).
 *
 *   Cached 60 s per owner, as the route had it: a full work-item scan per identity, and the wallet is
 *   read on every page load. The 'work' and 'wallet' write paths broadcast their domain (no owner), so
 *   the broad domain tags drop it.
 * @structure WalletStanding · walletStanding(storage, ownerName)
 * @usage const standing = await walletStanding(storage, req.auth!.owner); if (!standing) return notFound();
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B3).
 */
import type { Storage, GHIIRecord } from '../../storage/interface.js';
import { calculateEscrowMany } from '../morsel.js';
import { cached, TTL } from '../cache.js';
import { loadOwnerAgents } from '../db/owner-identity.js';

export interface WalletStanding {
    ghii: GHIIRecord;
    balance: number;
    inEscrow: number;
    available: number;
}

/** The account `ownerName`'s wallet, or null when the account has no GHII record. */
export async function walletStanding(storage: Storage, ownerName: string): Promise<WalletStanding | null> {
    const ghii = await storage.getGHIIByOwner(ownerName);
    if (!ghii) return null;
    const balance = ghii.morselBalance ?? 0;
    const inEscrow = await cached(
        `escrow:${ownerName}`, TTL.dashboard,
        async () => {
            const agents = await loadOwnerAgents(storage, ownerName);
            return calculateEscrowMany(storage, [ghii.ghii, ...agents.map(a => a.gaii)]);
        },
        ['domain:work', 'domain:wallet'],
    );
    return { ghii, balance, inEscrow, available: balance - inEscrow };
}
