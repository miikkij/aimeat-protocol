/**
 * @file app-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description App Store routes — purchase flow, license verification, purchase history.
 *   Handles morsel-based app purchases with immutable receipts and cryptographic proofs.
 *
 * @structure
 *   - POST /v1/app-store/purchase — Buy an app with morsels
 *   - GET  /v1/app-store/purchases — List buyer's purchase history
 *   - GET  /v1/app-store/purchases/:txId — Get full purchase detail with content
 *   - GET  /v1/app-store/sales — List seller's sales history
 *   - GET  /v1/app-store/license-check — Verify app license
 *
 * Domain separation:
 *   - Wallet (wallet.ts): balance tracking, morsel transfers
 *   - App Store (this file): purchase records, license verification, content snapshots, proofs
 *   - Apps (apps.ts): app storage, versioning, manifest, search
 *
 * @version-history
 *   v1.3.0 — 2026-09-04 — The purchase door asks appSpendRefusal before it debits. It was the fifth
 *     place that charges and the only one that asked nothing, so an app grant approved for
 *     memory:read alone could buy from the store with the human's morsels — debitBalance resolves
 *     any principal to the owner GHII — and the per-app spend ceiling was never consulted. The four
 *     checkout doors gained the same check as audit H-3 on 2026-08-10, through
 *     commerce/session-service.ts; this one is not on that path.
 *   v1.2.0 — 2026-08-23 — SECURITY (audit AI-triage, invariant 1): purchases and licences key on the
 *     buyer's OWNER GHII (ownerGhiiOf(resolveIdentity(...))), the same identity the wallet debits,
 *     instead of the raw `sub`. The raw form split one person's licences across two coordinates (bare
 *     name for an owner session, agent GAII for an agent), so an owner's purchase was invisible to
 *     their own agent and an app could be paid for twice. license-check now looks the seller up by
 *     the app owner's GHII (what the receipt stored) instead of iterating agent GAIIs that no receipt
 *     was keyed on.
 *   v1.1.1 — 2026-07-14 — Fee rounding through the money.ts chokepoint (percentFee)
 *   v1.1.0 — 2026-07-13 — Fee leg routed via settleMarketplaceFee (operator|burn), TARGET-033 phase 2
 *   v1.0.0 — 2026-03-13 — Renamed from marketplace.ts to app-store.ts; routes /v1/marketplace/* → /v1/app-store/*
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { ownerCoordinate } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { sign } from '../auth/keypair.js';
import { settleMarketplaceFee } from '../services/marketplace-fee.js';
import { appSpendRefusal } from '../services/metered-access.js';
import { percentFee } from '../commerce/money.js';

export function appStoreRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // The coordinate a purchase and a licence key on: the buyer's OWNER GHII, the same identity the
    // wallet debits. It lives in utils/gaii.ts now, with the full reason — this was written out here
    // on 2026-08-23 and the door that serves the paid app was still comparing `req.auth.sub` a
    // fortnight later. The seller side keys on `app.ownerGaii`, which is that same `owner@node` form.
    const coordinateOf = (req: { auth?: { sub: string; owner: string; roles: string[] } }): string =>
        ownerCoordinate(req.auth!, config.nodeId);

    // POST /v1/app-store/purchase — Purchase an app
    router.post('/v1/app-store/purchase', requireAuth(), async (req, res) => {
        if (!config.marketplaceEnabled) {
            res.status(403).json(error(config.nodeId, 'APP_STORE_DISABLED', 'App store payments are not enabled on this node'));
            return;
        }

        const buyerGaii = coordinateOf(req);
        const buyerOwner = req.auth!.owner;
        const { app_filename, app_owner } = req.body ?? {};

        if (!app_filename || typeof app_filename !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app_filename is required'));
            return;
        }
        if (!app_owner || typeof app_owner !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app_owner is required'));
            return;
        }

        // Look up the app
        const app = await storage.getAppByOwnerName(app_owner, app_filename);
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${app_filename}" not found for owner "${app_owner}"`));
            return;
        }

        const price = app.manifest.priceMorsels ?? 0;
        if (price <= 0) {
            res.status(400).json(error(config.nodeId, 'APP_IS_FREE', 'This app is free — no purchase needed. Download it directly.'));
            return;
        }

        // Prevent buying your own app
        if (app.ownerGaii === buyerGaii) {
            res.status(400).json(error(config.nodeId, 'OWN_APP', 'You cannot purchase your own app'));
            return;
        }

        const licenseType = app.manifest.licenseType ?? 'single';

        // Check existing license
        const hasLicense = await storage.hasValidLicense(buyerGaii, app.ownerGaii, app_filename, licenseType);
        if (hasLicense && licenseType === 'lifetime') {
            res.status(409).json(error(config.nodeId, 'ALREADY_LICENSED', 'You already have a lifetime license for this app'));
            return;
        }

        // Transaction fee
        const feePercent = config.marketplaceTransactionFeePercent ?? 5;
        const transactionFee = percentFee(price, feePercent);
        const totalCost = price;

        // SECURITY: money leaves the buyer on the next line, so the spend permission is asked on
        // this one. `appSpendRefusal` is the same check the four checkout doors share through
        // commerce/session-service.ts (audit H-3, 2026-08-10), and its own docblock says it belongs
        // "at EVERY place that actually charges" — this door was the fifth, and it asked nothing. An
        // app grant resolves to the owner's GHII in debitBalance, so an app the owner approved for
        // reading their notes could buy from the store with their morsels, and the per-app ceiling
        // they set was never consulted either. Asked HERE rather than as a middleware because the
        // answer only matters once the price is known: a free app leaves at APP_IS_FREE above, and a
        // buyer who already holds a lifetime licence leaves at ALREADY_LICENSED, neither of them
        // needing permission to spend nothing.
        const spendRefusal = await appSpendRefusal(storage, req.auth ?? null);
        if (spendRefusal) {
            if (spendRefusal.kind === 'scope_required') {
                res.status(403).json(error(config.nodeId, 'SCOPE_DENIED',
                    `This app may not spend on your behalf. It needs the "${spendRefusal.scope}" permission, `
                    + 'which you can grant it from Profile > Access. Reading your data and buying with your '
                    + 'money are separate permissions.'));
            } else {
                res.status(402).json(error(config.nodeId, 'APP_SPEND_CAP',
                    `This app has spent the ${spendRefusal.capMorsels}-morsel limit you set for it `
                    + `(${spendRefusal.spentMorsels} used). Raise or clear the limit in Profile > Access.`));
            }
            return;
        }

        // Debit buyer (atomic — resolves GAII to GHII internally)
        const debited = await storage.debitBalance(buyerGaii, totalCost);
        if (!debited) {
            const buyerGhii = await storage.getGHIIByOwner(buyerOwner);
            const balance = buyerGhii?.morselBalance ?? 0;
            res.status(402).json(error(config.nodeId, 'INSUFFICIENT_BALANCE',
                `Insufficient morsels. Need ${totalCost}, have ${balance}`));
            return;
        }

        // Credit seller (price minus transaction fee — resolves GAII to GHII internally)
        const sellerEarnings = price - transactionFee;
        await storage.creditBalance(app.ownerGaii, sellerEarnings);

        const now = new Date().toISOString();
        const txId = `mktx_${Date.now()}_${randomBytes(6).toString('hex')}`;

        // Wallet transactions for audit trail
        await storage.addTransaction({
            id: `tx-${Date.now()}-${randomBytes(4).toString('hex')}`,
            gaii: buyerGaii,
            type: 'app_purchase',
            amount: -totalCost,
            counterpartyGaii: app.ownerGaii,
            trackingCode: txId,
            timestamp: now,
        });

        await storage.addTransaction({
            id: `tx-${Date.now()}-${randomBytes(4).toString('hex')}`,
            gaii: app.ownerGaii,
            type: 'app_sale',
            amount: sellerEarnings,
            counterpartyGaii: buyerGaii,
            trackingCode: txId,
            timestamp: now,
        });

        // Fee leg: credited to the operator or burned per AIMEAT_MARKETPLACE_FEE_MODE
        // (replaces the old app_store_fee tx that recorded a vanishing fee on the seller).
        await settleMarketplaceFee(storage, config, { fee: transactionFee, payerGhii: buyerGaii, trackingCode: txId, source: 'app-store' });

        // Snapshot app content
        const appContent = app.data.toString('base64');
        const appManifest: AppManifest = { ...app.manifest };

        // Get optional screenshot
        let appScreenshot: string | undefined;
        const screenshotFile = await storage.getStorageFile(app.ownerGaii, `apps/screenshots/${app_filename}`);
        if (screenshotFile) {
            appScreenshot = screenshotFile.data.toString('base64');
        }

        // Sign the transaction with node key
        const nodeKey = await storage.getNodeKey();
        const sigPayload = JSON.stringify({
            txId, buyerGaii, sellerGaii: app.ownerGaii,
            appFilename: app_filename, appVersionNumber: app.versionNumber,
            licenseType, priceMorsels: price, purchasedAt: now,
        });
        const signature = nodeKey ? await sign(nodeKey.privateKey, sigPayload) : '';

        // Create immutable purchase receipt
        const purchase = await storage.createAppPurchase({
            transactionId: txId,
            buyerGaii,
            buyerOwner,
            sellerGaii: app.ownerGaii,
            sellerOwner: app.ownerName,
            appFilename: app_filename,
            appName: app.manifest.name,
            appVersionNumber: app.versionNumber,
            licenseType,
            priceMorsels: price,
            transactionFeeMorsels: transactionFee,
            purchasedAt: now,
            appContent,
            appManifest,
            appScreenshot,
            signature,
            nodeId: config.nodeId,
            nodePublicKey: nodeKey?.publicKey ?? '',
        });

        res.status(201).json(success(config.nodeId, {
            transaction_id: purchase.transactionId,
            app_filename: purchase.appFilename,
            app_name: purchase.appName,
            app_version_number: purchase.appVersionNumber,
            license_type: purchase.licenseType,
            price_morsels: purchase.priceMorsels,
            transaction_fee_morsels: purchase.transactionFeeMorsels,
            purchased_at: purchase.purchasedAt,
            buyer_balance: (await storage.getGHIIByOwner(buyerOwner))?.morselBalance ?? 0,
            note: `Purchased "${purchase.appName}" (${licenseType} license). The full app content is included in this receipt.`,
        }, [
            { description: 'View purchase details', method: 'GET', url: `/v1/app-store/purchases/${txId}` },
            { description: 'List all purchases', method: 'GET', url: '/v1/app-store/purchases' },
        ]));
        emitChange('app-store');
    });

    // GET /v1/app-store/purchases — List buyer's purchases
    router.get('/v1/app-store/purchases', requireAuth(), requireScope('wallet:read'), async (req, res) => {
        const gaii = coordinateOf(req);
        const purchases = await storage.listAppPurchasesByBuyer(gaii);

        res.json(success(config.nodeId, {
            purchases: purchases.map(p => ({
                transaction_id: p.transactionId,
                app_filename: p.appFilename,
                app_name: p.appName,
                app_version_number: p.appVersionNumber,
                license_type: p.licenseType,
                price_morsels: p.priceMorsels,
                seller_owner: p.sellerOwner,
                purchased_at: p.purchasedAt,
            })),
            total: purchases.length,
        }));
    });

    // GET /v1/app-store/purchases/:txId — Get specific purchase (includes full content)
    router.get('/v1/app-store/purchases/:txId', requireAuth(), async (req, res) => {
        const gaii = coordinateOf(req);
        const txId = req.params.txId as string;

        const purchase = await storage.getAppPurchase(txId);
        if (!purchase) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Purchase not found'));
            return;
        }

        // Only buyer or seller can view
        if (purchase.buyerGaii !== gaii && purchase.sellerGaii !== gaii) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You can only view your own purchases'));
            return;
        }

        res.json(success(config.nodeId, {
            transaction_id: purchase.transactionId,
            buyer_owner: purchase.buyerOwner,
            seller_owner: purchase.sellerOwner,
            app_filename: purchase.appFilename,
            app_name: purchase.appName,
            app_version_number: purchase.appVersionNumber,
            license_type: purchase.licenseType,
            price_morsels: purchase.priceMorsels,
            transaction_fee_morsels: purchase.transactionFeeMorsels,
            purchased_at: purchase.purchasedAt,
            app_content: purchase.appContent,
            app_manifest: purchase.appManifest,
            app_screenshot: purchase.appScreenshot ?? null,
            signature: purchase.signature,
            node_id: purchase.nodeId,
            node_public_key: purchase.nodePublicKey,
        }));
    });

    // GET /v1/app-store/sales — List seller's sales
    router.get('/v1/app-store/sales', requireAuth(), requireScope('wallet:read'), async (req, res) => {
        const gaii = coordinateOf(req);
        const sales = await storage.listAppPurchasesBySeller(gaii);

        res.json(success(config.nodeId, {
            sales: sales.map(s => ({
                transaction_id: s.transactionId,
                app_filename: s.appFilename,
                app_name: s.appName,
                app_version_number: s.appVersionNumber,
                license_type: s.licenseType,
                price_morsels: s.priceMorsels,
                transaction_fee_morsels: s.transactionFeeMorsels,
                buyer_owner: s.buyerOwner,
                purchased_at: s.purchasedAt,
            })),
            total: sales.length,
        }));
    });

    // GET /v1/app-store/license-check — Check if user has valid license for an app
    router.get('/v1/app-store/license-check', requireAuth(), requireScope('wallet:read'), async (req, res) => {
        const gaii = coordinateOf(req);
        const appFilename = req.query.app_filename as string;
        const appOwner = req.query.app_owner as string;

        if (!appFilename || !appOwner) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app_filename and app_owner query params required'));
            return;
        }

        // The seller coordinate is the app owner's GHII — the exact value the purchase receipt stored
        // as sellerGaii (app.ownerGaii = `owner@node`). The old code looked the seller up by iterating
        // getAgentsByOwner() and checking each agent GAII, which no receipt was ever keyed on, so a
        // valid licence read as false and an owner with no agents 404'd on their own app (audit
        // AI-triage 2026-08-23, invariant 1).
        const sellerGhii = `${appOwner}@${config.nodeId}`;
        const hasLicense = await storage.hasValidLicense(gaii, sellerGhii, appFilename);

        res.json(success(config.nodeId, {
            app_filename: appFilename,
            app_owner: appOwner,
            has_license: hasLicense,
        }));
    });

    return router;
}
