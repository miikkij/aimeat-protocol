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
import { verifySaleRequest } from '../services/package-sale-auth.js';
import { listSellers, addSeller, removeSeller, isSellerFor } from '../services/package-sellers.js';
import { grantEntitlement, revokeEntitlement } from '../services/package-entitlements.js';
import { packageConfigNeeds } from '../services/package-config-needs.js';
import { saleConfigNeeds, saleGrant, saleRevoke } from '../services/package-sale-client.js';

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

    router.put('/v1/federation/package-sales/:groupId/entitlements/:nodeId', async (req, res) => {
        const act = await sellerAct(req, res);
        if (!act) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const note = `sold by ${act.seller}${typeof body.note === 'string' && body.note ? `: ${body.note}` : ''}`;
        const out = await grantEntitlement(storage, { owner: act.author, isOperator: false }, {
            groupId: act.groupId, nodeId: req.params.nodeId as string,
            updatesUntil: body.updates_until, channel: body.channel, note, node: body.node,
        }, peers, { timeoutMs: config.federationTimeoutMs, seller: act.seller, thisNodeId: config.nodeId });
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
}
