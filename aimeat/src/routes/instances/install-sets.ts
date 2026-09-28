/**
 * @file src/routes/instances/install-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator sets up this node from an install set (install packages, phase 4): the
 *   owner user, the packages of a bundle, the organisms and workspaces, the other users and the crew
 *   agents. The work is services/install-set-apply.ts; the MCP tool aimeat_install_set calls it too.
 *
 *   ONLY THE OPERATOR. The call creates accounts and installs for another person, so it stands behind
 *   requireOperatorPrincipal() with the word `operator:admin`: the operator in person, or an agent of
 *   the operator holding that exact word, which no wildcard carries.
 * @structure registerInstallSetRoutes(router, config, storage, peers, scheduler)
 *   POST /v1/install-sets/apply · GET /v1/install-sets
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { Scheduler } from '../../services/scheduler.js';
import type { PeerInfo } from '../../services/federation.js';
import { requireAuth, requireOperatorPrincipal, requireLocalSession } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { OPERATOR_ADMIN_SCOPE } from '../../utils/scope-coverage.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { applyInstallSet, listAppliedSets } from '../../services/install-set-apply.js';

export function registerInstallSetRoutes(
    router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>, scheduler?: Scheduler,
): void {
    router.post('/v1/install-sets/apply', requireAuth(), requireLocalSession(), requireOperatorPrincipal(storage, OPERATOR_ADMIN_SCOPE), async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const out = await applyInstallSet({ storage, config, peers, scheduler }, {
            installSet: body.install_set, secrets: body.secrets, dryRun: body.dry_run === true,
            appliedBy: resolveIdentity(req.auth!, config.nodeId),
        });
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status, out.problems ? { problems: out.problems } : undefined));
            return;
        }
        res.status(out.dry_run ? 200 : 201).json(success(config.nodeId, out));
    });

    router.get('/v1/install-sets', requireAuth(), requireLocalSession(), requireOperatorPrincipal(storage, OPERATOR_ADMIN_SCOPE), async (_req, res) => {
        res.json(success(config.nodeId, { install_sets: await listAppliedSets(storage) }));
    });
}
