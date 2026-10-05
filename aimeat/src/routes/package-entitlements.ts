/**
 * @file src/routes/package-entitlements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package repository's REST endpoints (install packages, phase 3): which peer nodes a
 *   private package is served to and up to when, and the listing a customer node reads to see what
 *   it may pull. The work is services/package-entitlements.ts; the MCP tool aimeat_package_entitlements
 *   calls the same functions.
 * @structure registerPackageEntitlementRoutes(router, config, storage, peers)
 *   GET /v1/packages/:groupId/entitlements · PUT and DELETE /v1/packages/:groupId/entitlements/:nodeId
 *   GET /v1/federation/packages (signed by the calling node) · GET /v1/packages/:groupId/config-needs
 * @version-history
 *   v1.5.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.4.0 — 2026-10-05 — A grant passes the repository role (PKG-8), and the signed listing must name
 *     this node as its audience (PKG-10; secaudit 2026-10).
 *   v1.3.0 — 2026-10-02 — A grant's new node counts against the packages-only peer cap (config.packagePeerCap).
 *   v1.2.0 — 2026-09-28 — GET /v1/packages/:groupId/config-needs: the questions a shop asks before payment.
 *   v1.1.0 — 2026-09-28 — The grant takes `node` ({ url, public_key }) and registers an unknown node as
 *     a packages-only peer; the listing serves such a peer only what it holds (install packages, phase 5).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireScope, requireLocalSession } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import {
    listEntitlements, grantEntitlement, revokeEntitlement, repositoryListing, entitledGroupsOf, headerNode,
} from '../services/package-entitlements.js';
import { adoptPendingPeer } from '../services/package-peer-register.js';
import { verifyPackageNode } from '../services/package-node-auth.js';
import { packageConfigNeeds } from '../services/package-config-needs.js';
import { isOperatorCaller, type OperatorAuth } from '../services/operator-override.js';

export function registerPackageEntitlementRoutes(
    router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>,
): void {
    // isOperator is the operator in person, or the operator's agent holding operator:admin: the
    // answer the MCP tool gets (services/operator-override.ts).
    const callerOf = async (req: { auth?: OperatorAuth & { owner: string } }) =>
        ({ owner: req.auth!.owner, isOperator: await isOperatorCaller(storage, req.auth) });

    router.get('/v1/packages/:groupId/entitlements', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const out = await listEntitlements(storage, await callerOf(req), decodeURIComponent(req.params.groupId as string));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entitlements: out.entitlements, repository_role: config.packageRepository }));
    });

    router.put('/v1/packages/:groupId/entitlements/:nodeId', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await grantEntitlement(storage, await callerOf(req), {
            groupId: decodeURIComponent(req.params.groupId as string),
            nodeId: req.params.nodeId as string,
            updatesUntil: body.updates_until,
            note: body.note,
            channel: body.channel,
            node: body.node,
        }, peers, { timeoutMs: config.federationTimeoutMs, thisNodeId: config.nodeId, peerCap: config.packagePeerCap, repository: config.packageRepository });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, {
            entitlement: out.entitlement, peer_registered: out.peerRegistered === true, peer_pending: out.peerPending === true,
            repository_role: config.packageRepository,
        }));
    });

    // What a package or an install bundle needs the customer to give: the questions a shop asks
    // before payment, with the permission it grants with (services/package-config-needs.ts).
    router.get('/v1/packages/:groupId/config-needs', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const out = await packageConfigNeeds(storage, config, await callerOf(req), decodeURIComponent(req.params.groupId as string));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, {
            group_id: out.group_id, version: out.version, bundle: out.bundle, name: out.name,
            questions: out.questions, defaults: out.defaults, problems: out.problems,
        }));
    });

    router.delete('/v1/packages/:groupId/entitlements/:nodeId', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const out = await revokeEntitlement(storage, await callerOf(req),
            decodeURIComponent(req.params.groupId as string), req.params.nodeId as string);
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { revoked: true }));
    });

    // What the calling node may pull from this repository: every published public package, and the
    // private ones it holds an entitlement to, each with the version its entitlement reaches.
    router.get('/v1/federation/packages', async (req, res) => {
        if (!config.packageRepository) {
            res.status(404).json(error(config.nodeId, 'NOT_A_REPOSITORY', 'This node does not serve packages as a repository.'));
            return;
        }
        // A node granted while it did not answer is registered on its first signed request.
        await adoptPendingPeer({ storage, peers, timeoutMs: config.federationTimeoutMs, thisNodeId: config.nodeId }, headerNode(req.headers));
        // A packages-only peer (catalogue not shared, registered with its grant) is heard for what it
        // holds, and its listing carries only that: the public catalogue is what the flag withholds.
        const who = await verifyPackageNode(req.headers, peers, '*', config.nodeId, Date.now(),
            async nodeId => (await entitledGroupsOf(storage, nodeId)).length > 0);
        if (!who) { res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'The listing is for peer nodes: sign the request as your node.')); return; }
        if (!who.ok) { res.status(who.status).json(error(config.nodeId, who.code, who.message)); return; }
        const includePublic = peers.get(who.nodeId)?.shareCatalogue !== false;
        // A seller's address, from this node's peer table, tells the customer node where to renew.
        const urlOf = (nodeId: string): string | undefined => peers.get(nodeId)?.url;
        res.json(success(config.nodeId, { node: config.nodeId, packages: await repositoryListing(storage, who.nodeId, { includePublic, urlOf }) }));
    });
}
