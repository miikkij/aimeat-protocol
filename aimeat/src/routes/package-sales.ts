/**
 * @file src/routes/package-sales.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Selling install packages node to node, with no token (install packages, phase 5).
 *   Jouni, 2026-09-29: "nyt ihan oikeasti tuon järjestelmän on pystyttävä tekemään toi itse".
 *
 *   ON THE REPOSITORY:
 *   - the author names the nodes that sell their packages (GET, PUT, DELETE /v1/package-sellers);
 *   - a seller node asks, signed with its own key (services/package-sale-auth.ts), for a package's
 *     questions, and grants, ends or revokes a customer node's entitlement
 *     (/v1/federation/package-sales/...). The work is the same services the author's own endpoints
 *     call (package-config-needs.ts, package-entitlements.ts), acting for the package's author.
 *
 *   ON THE SELLING NODE (the shop's own node): its operator, or an agent of the operator holding the
 *   exact word operator:admin, asks its node to make the signed request (/v1/package-sales/...,
 *   services/package-sale-client.ts). A node signs as itself, so this is an operator act: any member
 *   who could make it would sell the author's packages in the node's name.
 * @structure registerPackageSaleRoutes(router, config, storage, peers)
 * @version-history
 *   v1.4.0 — 2026-10-02 — The seller's signed offer read carries `latest` (what the version on sale can
 *     do); POST /v1/package-sales/catalogue/review records the operator's review (design phase 5).
 *   v1.3.0 — 2026-10-02 — The package sale (design phase 3). On the repository: the author's offer
 *     (GET, PUT /v1/packages/:groupId/offer), the seller's signed offer read and claim codes, the terms a
 *     grant names (`terms_id`), and a node redeeming a claim with its own key. On the selling node: its
 *     catalogue, the approval requests, a buyer's offer read and subscriptions (commerce:buy). On the buying node: the
 *     operator redeems a claim code.
 *   v1.2.0 — 2026-10-02 — A seller's signed revoke reaches only a grant it sold (NOT_YOUR_GRANT).
 *   v1.1.0 — 2026-09-29 — GET /v1/package-sales/config-needs takes repository_url and
 *     repository_public_key to link a repository first; aimeat-commercial found that only the MCP
 *     tool could, and the questions are read before the first sale.
 *   v1.0.0 — 2026-09-29 — Initial (install packages, phase 5: seller nodes).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireScope, requireLocalSession, requireOperatorPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { OPERATOR_ADMIN_SCOPE } from '../utils/scope-coverage.js';
import { verifySaleRequest, verifyRequestWithKey, CLAIM_PURPOSE } from '../services/package-sale-auth.js';
import { listSellers, addSeller, removeSeller, isSellerFor } from '../services/package-sellers.js';
import { grantEntitlement, revokeEntitlement, type PackageEntitlement } from '../services/package-entitlements.js';
import { packageConfigNeeds } from '../services/package-config-needs.js';
import { saleConfigNeeds, saleGrant, saleRevoke, saleClaim, saleOffer, claimPackageHere } from '../services/package-sale-client.js';
import { readOffer, setOffer, publicOffer, termsById, offerCapabilities } from '../services/package-offer.js';
import { createClaim, redeemClaim } from '../services/package-claims.js';
import {
    readCatalogue, setCatalogueEntry, readRequests, subscriptionsOf, setAutoRenew,
} from '../services/package-sale-catalogue.js';
import { buyerOfferView, decideSaleRequest, reviewSale } from '../services/package-sale-checkout.js';
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function registerPackageSaleRoutes(
    router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>,
): void {
    // ── The repository: who sells an author's packages ─────────────────────────────────────────
    router.get('/v1/package-sellers', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        res.json(success(config.nodeId, { sellers: await listSellers(storage, req.auth!.owner), repository_role: config.packageRepository }));
    });

    router.put('/v1/package-sellers/:nodeId', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await addSeller({ storage, peers, config }, { owner: req.auth!.owner }, { nodeId: req.params.nodeId as string, node: body.node, note: body.note });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { seller: out.seller, peer_registered: out.peerRegistered, repository_role: config.packageRepository }));
    });

    router.delete('/v1/package-sellers/:nodeId', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const out = await removeSeller(storage, { owner: req.auth!.owner }, req.params.nodeId as string);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { removed: true }));
    });

    // ── The repository: the terms a package is sold on (services/package-offer.ts) ─────────────
    // The author's own read. Only a private package has an offer, so a read open to anyone would tell
    // a stranger that the package exists and who wrote it; a seller reads it signed, a buyer through
    // the selling node. Anyone else gets the answer a package with no offer gets.
    router.get('/v1/packages/:groupId/offer', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const offer = await readOffer(storage, decodeURIComponent(req.params.groupId as string));
        if (!offer || (offer.author !== req.auth!.owner && !req.auth!.roles.includes('operator'))) {
            res.status(404).json(error(config.nodeId, 'NO_OFFER', 'This package has no offer. Ask its author to set the terms it is sold on.'));
            return;
        }
        res.json(success(config.nodeId, publicOffer(offer)));
    });

    router.put('/v1/packages/:groupId/offer', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await setOffer(storage, { owner: req.auth!.owner, isOperator: req.auth!.roles.includes('operator') },
            decodeURIComponent(req.params.groupId as string), { terms: body.terms, state: body.state });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { ...publicOffer(out.offer), all_terms: out.offer.terms }));
    });

    // ── The repository: a seller node's signed requests ────────────────────────────────────────
    /** The package's author, when the signed request comes from one of the author's seller nodes. */
    async function sellerAct(req: Request, res: Response): Promise<{ author: string; seller: string; groupId: string } | null> {
        if (!config.packageRepository) {
            res.status(404).json(error(config.nodeId, 'NOT_A_REPOSITORY', 'This node does not serve packages as a repository.'));
            return null;
        }
        const body = req.method === 'PUT' ? req.body : undefined;
        const who = await verifySaleRequest(req.headers, peers, req.method, req.originalUrl, body);
        if (!who.ok) { res.status(who.status).json(error(config.nodeId, who.code, who.message)); return null; }
        const groupId = decodeURIComponent(req.params.groupId as string);
        const pkg = (await storage.listVersions(groupId, 1, 0)).versions[0];
        if (!pkg || !(await isSellerFor(storage, pkg.author, who.nodeId))) {
            // One answer for "no such package" and "not your seller", so a node that is nobody's seller
            // learns nothing about which private packages exist here.
            res.status(403).json(error(config.nodeId, 'NOT_A_SELLER',
                'Your node does not sell this package here. The package\'s author names the nodes that sell it.',
                403, { node_id: who.nodeId, group_id: groupId, tool: 'aimeat_package_sellers' }));
            return null;
        }
        return { author: pkg.author, seller: who.nodeId, groupId };
    }

    router.get('/v1/federation/package-sales/:groupId/config-needs', async (req, res) => {
        const act = await sellerAct(req, res);
        if (!act) return;
        const out = await packageConfigNeeds(storage, config, { owner: act.author, isOperator: false }, act.groupId);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, {
            group_id: out.group_id, version: out.version, bundle: out.bundle, name: out.name,
            questions: out.questions, defaults: out.defaults, problems: out.problems,
        }));
    });

    // The author's offer, read by a seller node: every terms entry, so a renewal can name the terms
    // its buyer accepted (services/package-offer.ts).
    router.get('/v1/federation/package-sales/:groupId/offer', async (req, res) => {
        const act = await sellerAct(req, res);
        if (!act) return;
        const offer = await readOffer(storage, act.groupId);
        if (!offer) { res.status(404).json(error(config.nodeId, 'NO_OFFER', 'The author of this package has not set the terms it is sold on. Ask them to set an offer first.')); return; }
        // `latest`: what the version on sale can do, which the seller reviews before it sells it.
        res.json(success(config.nodeId, { ...publicOffer(offer), all_terms: offer.terms, latest: await offerCapabilities(storage, config, act.groupId) }));
    });

    // A one-time code for a sale whose customer node does not exist yet (services/package-claims.ts).
    router.put('/v1/federation/package-sales/:groupId/claims', async (req, res) => {
        const act = await sellerAct(req, res);
        if (!act) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const terms = await termsSnapshot(act.groupId, body.terms_id);
        if (terms && 'code' in terms) { res.status(terms.status).json(error(config.nodeId, terms.code, terms.message)); return; }
        const out = await createClaim(storage, { groupId: act.groupId, seller: act.seller, updatesUntil: body.updates_until, channel: body.channel, note: body.note, terms: terms ?? undefined });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { claim_code: out.claim_code, expires_at: out.expires_at }));
    });

    // A node redeems a claim code, signed with the key its body names: proof that it holds the key it
    // asks to be registered under. Not a seller's request, so it is not sellerAct's.
    router.post('/v1/federation/package-claims/:groupId', async (req, res) => {
        if (!config.packageRepository) {
            res.status(404).json(error(config.nodeId, 'NOT_A_REPOSITORY', 'This node does not serve packages as a repository.'));
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const publicKey = str(body.public_key);
        const who = await verifyRequestWithKey(req.headers, publicKey, CLAIM_PURPOSE, req.method, req.originalUrl, req.body);
        if (!who.ok) { res.status(who.status).json(error(config.nodeId, who.code, who.message)); return; }
        if (who.nodeId !== str(body.node_id)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'node_id is the node that signs the request.')); return; }
        const groupId = decodeURIComponent(req.params.groupId as string);
        const pkg = (await storage.listVersions(groupId, 1, 0)).versions[0];
        if (!pkg) { res.status(404).json(error(config.nodeId, 'CLAIM_NOT_FOUND', 'No claim with that code waits for this package.')); return; }
        const out = await redeemClaim({ storage, peers, timeoutMs: config.federationTimeoutMs, thisNodeId: config.nodeId, peerCap: config.packagePeerCap }, {
            groupId, author: pkg.author, code: body.code, nodeId: who.nodeId, node: { url: str(body.url), public_key: publicKey },
        });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entitlement: out.entitlement, peer_registered: out.peerRegistered === true, peer_pending: out.peerPending === true }));
    });

    /** The author's terms a sale names by `terms_id`, as the entitlement keeps them, or a refusal. */
    async function termsSnapshot(groupId: string, termsId: unknown): Promise<PackageEntitlement['terms'] | { status: number; code: string; message: string } | null> {
        if (termsId === undefined || termsId === null || termsId === '') return null;
        const t = termsById(await readOffer(storage, groupId), String(termsId));
        if (!t) return { status: 404, code: 'TERMS_NOT_FOUND', message: `The offer has no terms "${String(termsId)}".` };
        return { offerTermsId: t.id, price: t.price, renewal: t.updates.renewal, acceptedAt: new Date().toISOString() };
    }

    router.put('/v1/federation/package-sales/:groupId/entitlements/:nodeId', async (req, res) => {
        const act = await sellerAct(req, res);
        if (!act) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const terms = await termsSnapshot(act.groupId, body.terms_id);
        if (terms && 'code' in terms) { res.status(terms.status).json(error(config.nodeId, terms.code, terms.message)); return; }
        const note = `sold by ${act.seller}${typeof body.note === 'string' && body.note ? `: ${body.note}` : ''}`;
        const out = await grantEntitlement(storage, { owner: act.author, isOperator: false }, {
            groupId: act.groupId, nodeId: req.params.nodeId as string,
            updatesUntil: body.updates_until, channel: body.channel, note, node: body.node, terms: terms ?? undefined,
        }, peers, { timeoutMs: config.federationTimeoutMs, seller: act.seller, thisNodeId: config.nodeId, peerCap: config.packagePeerCap });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entitlement: out.entitlement, peer_registered: out.peerRegistered === true, peer_pending: out.peerPending === true }));
    });

    router.delete('/v1/federation/package-sales/:groupId/entitlements/:nodeId', async (req, res) => {
        const act = await sellerAct(req, res);
        if (!act) return;
        const out = await revokeEntitlement(storage, { owner: act.author, isOperator: false }, act.groupId, req.params.nodeId as string, act.seller);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { revoked: true }));
    });

    // ── The selling node: its operator asks it to sign and send ────────────────────────────────
    const operatorOnly = [requireAuth(), requireLocalSession(), requireOperatorPrincipal(storage, OPERATOR_ADMIN_SCOPE)];
    const deps = { storage, config, peers };
    const forward = (res: Response, out: Awaited<ReturnType<typeof saleGrant>>): void => {
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        // The repository's own envelope, as it answered: a refusal there reaches the caller unchanged.
        res.status(out.status).json(out.body);
    };

    // `repository_url` and `repository_public_key` link a repository this node does not know yet, as
    // the grant's `repository` object does: the questions are read before the first sale.
    router.get('/v1/package-sales/config-needs', ...operatorOnly, async (req, res) => {
        const url = str(req.query.repository_url);
        const key = str(req.query.repository_public_key);
        const repository = url || key ? { node_id: str(req.query.repository), url, public_key: key } : str(req.query.repository);
        forward(res, await saleConfigNeeds(deps, repository, str(req.query.group_id)));
    });

    router.put('/v1/package-sales/entitlements', ...operatorOnly, async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        forward(res, await saleGrant(deps, body.repository, str(body.group_id), str(body.node_id), body));
    });

    router.delete('/v1/package-sales/entitlements', ...operatorOnly, async (req, res) => {
        forward(res, await saleRevoke(deps, str(req.query.repository), str(req.query.group_id), str(req.query.node_id)));
    });

    // The author's terms, read as a seller before this node prices the package (services/package-offer.ts).
    router.get('/v1/package-sales/author-offer', ...operatorOnly, async (req, res) => {
        forward(res, await saleOffer(deps, str(req.query.repository), str(req.query.group_id)));
    });

    // A claim code for a sale the shop makes outside this node's checkout (services/package-claims.ts).
    router.put('/v1/package-sales/claims', ...operatorOnly, async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        forward(res, await saleClaim(deps, body.repository, str(body.group_id), body));
    });

    // ── The selling node: what it sells, at its own price (services/package-sale-catalogue.ts) ──
    router.get('/v1/package-sales/catalogue', ...operatorOnly, async (_req, res) => {
        res.json(success(config.nodeId, { entries: await readCatalogue(storage) }));
    });

    router.put('/v1/package-sales/catalogue', ...operatorOnly, async (req, res) => {
        const out = await setCatalogueEntry(storage, { owner: req.auth!.owner }, (req.body ?? {}) as Record<string, unknown>);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entry: out.entry }));
    });

    // The operator reviews what the version on sale can do; new sales open while it stays that.
    router.post('/v1/package-sales/catalogue/review', ...operatorOnly, async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await reviewSale(deps, req.auth!.owner, str(body.repository), str(body.group_id));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entry: out.entry, reviewed: out.latest }));
    });

    router.get('/v1/package-sales/requests', ...operatorOnly, async (_req, res) => {
        res.json(success(config.nodeId, { requests: await readRequests(storage) }));
    });

    router.post('/v1/package-sales/requests/:id/decision', ...operatorOnly, async (req, res) => {
        const out = await decideSaleRequest(deps, req.params.id as string, req.body?.decision);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { request: out.request }));
    });

    // ── The selling node: a buyer, signed in here, reads what they would buy and what they hold ──
    // The node reads the author's terms for the buyer, node to node: the buyer never has an account
    // on the repository (Jouni, 2026-10-01).
    // commerce:buy, the word aimeat_package_buy asks, so an agent reaches the same thing on both doors.
    const signedIn = [requireAuth(), requireLocalSession(), requireScope('commerce:buy')];
    router.get('/v1/package-sales/offer', ...signedIn, async (req, res) => {
        const out = await buyerOfferView(deps, str(req.query.repository), str(req.query.group_id));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, out.view, [{ description: 'Buy it', method: 'POST', url: '/v1/commerce/checkout-sessions' }]));
    });

    router.get('/v1/package-sales/subscriptions', ...signedIn, async (req, res) => {
        const mine = await subscriptionsOf(storage, req.auth!.owner);
        const requests = (await readRequests(storage)).filter(r => r.buyer === req.auth!.owner);
        res.json(success(config.nodeId, { subscriptions: mine.map(s => ({ ...s, payment: s.payment ? { handler: s.payment.handler } : undefined })), requests }));
    });

    router.put('/v1/package-sales/subscriptions/auto-renew', ...signedIn, async (req, res) => {
        const out = await setAutoRenew(storage, req.auth!.owner, (req.body ?? {}) as Record<string, unknown>);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { auto_renew: out.auto_renew, updates_until: out.updates_until }));
    });

    // ── The buying node: its operator redeems a claim code with this node's own key ──────────────
    router.post('/v1/package-claims', ...operatorOnly, async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        forward(res, await claimPackageHere(deps, body.repository, str(body.group_id), str(body.code)));
    });
}
