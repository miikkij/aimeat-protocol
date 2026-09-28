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
 *   GET /v1/federation/packages (signed by the calling node)
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 3).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireScope, requireLocalSession } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import {
    listEntitlements, grantEntitlement, revokeEntitlement, repositoryListing,
} from '../services/package-entitlements.js';
import { verifyPackageNode } from '../services/package-node-auth.js';

export function registerPackageEntitlementRoutes(
    router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>,
): void {
    const callerOf = (req: { auth?: { owner: string; roles: string[] } }) =>
        ({ owner: req.auth!.owner, isOperator: req.auth!.roles.includes('operator') });

    router.get('/v1/packages/:groupId/entitlements', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const out = await listEntitlements(storage, callerOf(req), decodeURIComponent(req.params.groupId as string));
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entitlements: out.entitlements, repository_role: config.packageRepository }));
    });

    router.put('/v1/packages/:groupId/entitlements/:nodeId', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await grantEntitlement(storage, callerOf(req), {
            groupId: decodeURIComponent(req.params.groupId as string),
            nodeId: req.params.nodeId as string,
            updatesUntil: body.updates_until,
            note: body.note,
        });
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
        res.json(success(config.nodeId, { entitlement: out.entitlement, repository_role: config.packageRepository }));
    });

    router.delete('/v1/packages/:groupId/entitlements/:nodeId', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
        const out = await revokeEntitlement(storage, callerOf(req),
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
        const who = await verifyPackageNode(req.headers, peers, '*');
        if (!who) { res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'The listing is for peer nodes: sign the request as your node.')); return; }
        if (!who.ok) { res.status(who.status).json(error(config.nodeId, who.code, who.message)); return; }
        res.json(success(config.nodeId, { node: config.nodeId, packages: await repositoryListing(storage, who.nodeId) }));
    });
}
