/**
 * @file src/routes/exchange-party-buy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A buyer with no AIMEAT account buys a data package on EXCHANGE and becomes an outside
 *   party of its provider (services/exchange-party-buy.ts; plan doc-mvwxcas3dom3, D5.4). No session:
 *   the purchase id (128 random bits) is the buyer's handle on its purchase, and a party buying again
 *   presents its own credential (HTTP Basic `<owner>/<party>` and the key, or a party token), which
 *   tops up the contract it has.
 * @structure
 *   - POST /v1/exchange/offerings/:id/buy        open a purchase (priced from the listing)
 *   - POST /v1/exchange/purchases/:id/complete   pay and receive the key, the contract and the connection file
 *   - GET  /v1/exchange/purchases/:id            the purchase's state
 * @usage app.use(exchangePartyBuyRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.4).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { partyCredentialOf, verifyParty } from '../services/parties/verify.js';
import { openPartyPurchase, completePartyPurchase, readPartyPurchase, purchaseView } from '../services/exchange-party-buy.js';
import { validateBody } from '../models/schemas.js';
import { PartyBuySchema, PartyPurchaseCompleteSchema } from '../models/exchange-datapackage-schemas.js';

export function exchangePartyBuyRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };

    router.post('/v1/exchange/offerings/:id/buy', validateBody(PartyBuySchema, config.nodeId), async (req: Request, res: Response) => {
        // A party buying again proves who it is; a credential that names no live party is refused.
        const cred = partyCredentialOf(req);
        let renewal = null;
        if (cred) {
            const verdict = await verifyParty(deps, cred);
            if (!verdict.ok) { res.status(verdict.status).json(error(config.nodeId, verdict.code, verdict.message)); return; }
            renewal = verdict.ctx;
        } else if (req.auth?.sub && !req.auth.anonymous) {
            res.status(409).json(error(config.nodeId, 'USE_YOUR_ACCOUNT',
                'You are signed in to an account here. Accept the offering with your account instead: buying here is for someone with no account.',
                undefined, { accept: { method: 'POST', url: '/v1/exchange/entitlements', body: { offering_id: req.params.id } } }));
            return;
        }
        const out = await openPartyPurchase(deps, req.params.id as string, (req.body ?? {}) as Record<string, unknown>, renewal);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.status(201).json(success(config.nodeId, { purchase: out.purchase, pay: out.pay }, [
            { description: 'Complete the purchase after paying', method: 'POST', url: String(out.pay.complete_url) },
        ]));
    });

    router.post('/v1/exchange/purchases/:id/complete', validateBody(PartyPurchaseCompleteSchema, config.nodeId), async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await completePartyPurchase(deps, req.params.id as string, { handler: body.handler, instrument: body.instrument });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.json(success(config.nodeId, out.data, [
            { description: 'Read the package as the party (HTTP Basic or a token)', method: 'GET', url: String((out.data.connection as { endpoint?: string }).endpoint ?? '') },
        ]));
    });

    router.get('/v1/exchange/purchases/:id', async (req: Request, res: Response) => {
        const p = await readPartyPurchase(storage, config.nodeId, req.params.id as string);
        if (!p) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such purchase.')); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.json(success(config.nodeId, { purchase: purchaseView(p) }));
    });

    return router;
}
