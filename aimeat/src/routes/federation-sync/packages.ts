/**
 * @file src/routes/federation-sync/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Packages across a node boundary: pulling one in, and serving the signed statement
 *   that lets somebody else decide whether to.
 *
 *   TWO DOORS, OPPOSITE DIRECTIONS. The attestation door is public and read-only, and exists so an
 *   update check costs one small JSON read rather than a whole archive download. The pull door is
 *   this owner's own act on their own node, and everything it refuses is argued in
 *   services/package-pull.ts.
 * @structure registerFederationPackageRoutes(router, config, storage, peers)
 * @usage import { registerFederationPackageRoutes } from './federation-sync/packages.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PeerInfo } from '../../services/federation.js';
import { requireAuth, requireScope, optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { pullPackage } from '../../services/package-pull.js';
import { getPackageFor, getPackageVersionFor } from '../../services/package-read.js';
import { attestationFor } from '../../services/package-attest-serve.js';

export function registerFederationPackageRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    peers: Map<string, PeerInfo>,
): void {
    // GET /v1/federation/packages/:groupId/attestation — what this node says about a package,
    // signed, without the archive.
    //
    // Public, on exactly the terms the export door is public: a public package is readable by
    // anyone and a private one answers 404 to everyone but its author. It carries no component
    // CONTENT, only the digests, so it says what a package is without handing it over.
    router.get('/v1/federation/packages/:groupId/attestation', optionalAuth(), async (req, res) => {
        const groupId = decodeURIComponent(req.params.groupId as string);
        const version = req.query.version as string | undefined;

        const pkg = version
            ? await getPackageVersionFor(storage, groupId, version, req.auth?.owner)
            : await getPackageFor(storage, groupId, req.auth?.owner);

        if (!pkg) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Package not found: ${groupId}`));
            return;
        }

        const doc = await attestationFor(storage, config, pkg);
        if (!doc) {
            res.status(503).json(error(config.nodeId, 'NO_NODE_KEY',
                'This node has no key of its own yet, so it cannot sign a statement about anything.'));
            return;
        }

        res.json(success(config.nodeId, doc));
    });

    // POST /v1/federation/packages/pull — take a package published on another node.
    //
    // Owner-level rather than operator-level: what it creates is this owner's package, under this
    // owner's quota and group id. The one operator gate is inside, on the branch that pulls from an
    // address rather than from a peer this node already knows.
    router.post('/v1/federation/packages/pull', requireAuth(), requireScope('packages:write'), async (req, res) => {
        const { group_id: groupId, node_id: nodeId, source_url: sourceUrl, trust, version } = req.body ?? {};

        const out = await pullPackage({ storage, config, peers }, {
            owner: req.auth!.owner,
            sub: req.auth!.sub,
            isOperator: req.auth!.roles.includes('operator'),
        }, { groupId, nodeId, sourceUrl, trust, version });

        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }

        if (!out.applied) {
            // Not an error: the node already holds this version or a newer one. Saying so in the
            // success envelope is what makes a repeated pull safe to run on a schedule.
            res.json(success(config.nodeId, {
                applied: false,
                reason: out.reason,
                upstream: out.upstream,
            }));
            return;
        }

        res.status(201).json(success(config.nodeId, {
            applied: true,
            package: out.package,
            upstream: out.upstream,
        }, [
            {
                description: 'Install it',
                method: 'POST',
                url: `/v1/packages/${encodeURIComponent(out.package.packageGroupId)}/install`,
            },
        ]));
    });
}
