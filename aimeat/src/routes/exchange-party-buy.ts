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
 *   v1.0.1 — 2026-11-01 — The signed-in refusal tests for a session, not its `sub` (check:identity-resolution).
 *   v1.1.0 — 2026-11-02 — secaudit2026nov02d round 13: an opening without a party key counts against
 *     the address's hourly limit (consent.party_purchases_per_hour, 0 = no limit); a party buying
 *     again with its key is not counted.
 *   v1.1.1 — 2026-11-03 — secaudit2026nov02d round 13b: the 429 TOO_MANY_OPENINGS says what the limit
 *     is, that this address reached it, when to try again, that a party key is not counted, and where
 *     the operator changes it on the Config tab; the setting's name, the limit and the wait are in
 *     `details`.
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
import { rateBuckets } from '../services/rate-buckets.js';
import { ipRateKey } from '../middleware/rate-limit.js';

const OPEN_WINDOW_MS = 60 * 60 * 1000;

export function exchangePartyBuyRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();
    const deps = { storage, config };
    // Openings without a party key, counted per address and hour. Nobody pays to open one, so the
    // count keeps one address from filling a provider's month with openings it never pays for.
    const takeOpening = rateBuckets(OPEN_WINDOW_MS);

    router.post('/v1/exchange/offerings/:id/buy', validateBody(PartyBuySchema, config.nodeId), async (req: Request, res: Response) => {
        // A party buying again proves who it is; a credential that names no live party is refused.
        const cred = partyCredentialOf(req);
        let renewal = null;
        if (cred) {
            const verdict = await verifyParty(deps, cred);
            if (!verdict.ok) { res.status(verdict.status).json(error(config.nodeId, verdict.code, verdict.message)); return; }
            renewal = verdict.ctx;
        } else if (req.auth && !req.auth.anonymous) {
            // Only whether a session is present decides this refusal; no identity is stored or compared.
            res.status(409).json(error(config.nodeId, 'USE_YOUR_ACCOUNT',
                'You are signed in to an account here. Accept the offering with your account instead: buying here is for someone with no account.',
                undefined, { accept: { method: 'POST', url: '/v1/exchange/entitlements', body: { offering_id: req.params.id } } }));
            return;
        }
        const perHour = config.partyPurchasesPerHour;
        if (!renewal && perHour > 0) {
            const counted = takeOpening(ipRateKey(req.ip ?? req.socket.remoteAddress), perHour);
            if (!counted.ok) {
                // What the limit is, that this address reached it, what to do now, and who sets it where.
                const minutes = Math.max(1, Math.ceil(counted.retryAfterSec / 60));
                const wait = minutes === 1 ? '1 minute' : `${minutes} minutes`;
                const at = new Date(counted.resetAt).toISOString();
                res.setHeader('Retry-After', counted.retryAfterSec);
                res.status(429).json(error(config.nodeId, 'TOO_MANY_OPENINGS',
                    `You started ${perHour} purchases this hour from this address, which is this server's limit. Try again in ${wait}. `
                    + `A buyer who already has a party key can buy again with it now: those purchases are not counted. `
                    + `The limit is ${perHour} purchases an hour from one address without a party key, and it keeps one address from holding a seller's purchases without paying. `
                    + `The server's operator can change it under Admin, Config, Identity and access, Consent: "Purchases one address may start an hour" (consent.party_purchases_per_hour).`,
                    undefined, { setting: 'consent.party_purchases_per_hour', limit: perHour, retry_after_seconds: counted.retryAfterSec, retry_at: at }));
                return;
            }
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
