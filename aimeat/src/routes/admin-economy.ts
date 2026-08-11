/**
 * @file src/routes/admin-economy.ts
 * @description Operator-only economy administration route: mints morsels to an agent's balance while
 *   enforcing the per-day mint cap (config.maxOperatorMintPerDay) and recording a 'mint' transaction.
 *
 * @structure
 *   - adminEconomyRouter(config, storage): mounts POST /v1/admin/mint (requireRole 'operator')
 *   - mint handler: proves the operator, then hands the mint to services/morsel.ts mintMorsels
 *
 * @version-history
 *   v1.1.0 — 2026-08-11 — The mint itself moved to services/morsel.ts mintMorsels, which
 *     aimeat_admin_mint now calls too. The two copies wrote the same cap check, credit and ledger
 *     row, and had drifted: the MCP one told the live wallet stream, this one did not.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { mintMorsels } from '../services/morsel.js';

export function adminEconomyRouter(
    config: AimeatConfig,
    storage: Storage,
): Router {
    const router = Router();

    // POST /v1/admin/mint — operator mints morsels for an agent (§16.1)
    router.post('/v1/admin/mint', requireAuth(), requireRole('operator'), async (req, res) => {
        const { gaii, amount } = req.body ?? {};

        const minted = await mintMorsels({ storage, config }, req.auth!.sub, gaii, amount);
        if (!minted.ok) {
            res.status(minted.status).json(error(config.nodeId, minted.code, minted.message));
            return;
        }

        res.json(success(config.nodeId, {
            gaii,
            minted: minted.minted,
            new_balance: minted.newBalance,
            daily_minted: minted.mintedToday,
            daily_cap: minted.dailyCap,
        }));
    });

    return router;
}
