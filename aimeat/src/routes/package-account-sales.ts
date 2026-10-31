/**
 * @file src/routes/package-account-sales.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An author sells their own package to accounts of this node (Jouni, 2026-10-31, "optio
 *   B"). The work is services/packages/sale/package-account-sale.ts; the MCP tools aimeat_package_price_set,
 *   aimeat_package_sales and aimeat_package_buy call the same functions, and the connector's CLI
 *   dispatch calls these endpoints.
 *
 *   - PUT /v1/packages/:groupId/price: the author sets the price, the state or the preview components.
 *   - GET /v1/packages/:groupId/sales: the author reads the sale and every purchase.
 *   - POST /v1/packages/:groupId/sales/:order/refund: the author refunds one purchase.
 *   - GET /v1/package-purchases: the caller's own purchases.
 *
 *   The buyer pays through POST /v1/commerce/checkout-sessions with the line
 *   `{ kind: 'package-account', app: <group id> }` (package-account-checkout.ts), so this file opens no
 *   payment path of its own. The seller's words are commerce:sell, the buyer's commerce:buy, the words
 *   the checkout and the payout settings already use. A session from another node is refused.
 * @structure registerPackageAccountSaleRoutes(router, config, storage)
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-tekij-myy-oman-pakettinsa-toiselle-k-ytt-j-lle-samassa-solmu).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireLocalSession } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { setAccountPrice, saleView, salesOf, refundPurchase, purchasesOf } from '../services/packages/sale/package-account-sale.js';

export function registerPackageAccountSaleRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    const group = (p: unknown): string => decodeURIComponent(p as string);

    router.put('/v1/packages/:groupId/price', requireAuth(), requireLocalSession(), requireScope('commerce:sell'), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await setAccountPrice({ storage, config }, { owner: req.auth!.owner }, group(req.params.groupId), {
            price: body.price, state: body.state, preview: body.preview,
        });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { sale: saleView(out.sale) }, [
            { description: 'Your sales of this package', method: 'GET', url: `/v1/packages/${encodeURIComponent(out.sale.groupId)}/sales` },
        ]));
    });

    router.get('/v1/packages/:groupId/sales', requireAuth(), requireLocalSession(), requireScope('commerce:sell'), async (req, res) => {
        const out = await salesOf(storage, { owner: req.auth!.owner }, group(req.params.groupId));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, out.view));
    });

    router.post('/v1/packages/:groupId/sales/:order/refund', requireAuth(), requireLocalSession(), requireScope('commerce:sell'), async (req, res) => {
        const out = await refundPurchase({ storage, config }, { owner: req.auth!.owner }, group(req.params.groupId), req.params.order as string);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, out.refund));
    });

    router.get('/v1/package-purchases', requireAuth(), requireLocalSession(), requireScope('commerce:buy'), async (req, res) => {
        res.json(success(config.nodeId, { purchases: await purchasesOf(storage, req.auth!.owner) }));
    });
}
