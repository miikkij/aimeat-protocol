/**
 * @file src/routes/organisms/workspace-space-extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST route that names an extension on one space of an existing workspace:
 *   POST /v1/organisms/:id/workspace/spaces/:space/extensions?ws=<workspace id>, body
 *   { add: ["installer/name", ...] } with 1 to 5 entries. `:space` is the object type's name or its
 *   namespace. It adds the entries to that object type's `extensions` in the workspace manifest and
 *   answers the space with its list. It adds only: an entry already there is not an error, and
 *   nothing is removed.
 *
 *   THIS HANDLER DECIDES NOTHING. Who may call it, which entries it takes and the write itself are
 *   services/workspace-space-extensions.ts. The route asks `organism:write` of the session and
 *   turns the answer into a response. It carries no requireRole('agent'): a hosted app's grant is
 *   one of the callers the service admits, and that gate refuses the role `app`.
 *
 *   Ruled by the developer on 2026-10-13 (part 2 of the permission `organism:direct`): a hosted app
 *   names its own extension on a space of a workspace it built earlier, because the list of a space
 *   that names extensions is otherwise changed only by the account holder in person or by an agent
 *   holding the permission (services/fenced-space.ts).
 *
 *   The workspace is `?ws=`, and the space is in the path, matching the row, document and
 *   member-change routes on this same router. A file of its own because routes/organisms/
 *   workspace-ops.ts and shared.ts are near the 800-line limit.
 * @structure registerOrganismWorkspaceSpaceExtensionRoutes(router, config, storage)
 * @usage registerOrganismWorkspaceSpaceExtensionRoutes(router, config, storage) in routes/organisms.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { callerOf } from '../../middleware/caller.js';
import { nameSpaceExtensions } from '../../services/workspace-space-extensions.js';
import { isRefusal } from '../../services/workspace-change-core.js';

export function registerOrganismWorkspaceSpaceExtensionRoutes(
    router: Router, config: AimeatConfig, storage: Storage,
): void {
    const deps = { storage, config };

    /** Add 1 to 5 extensions of the caller's own account to one space's list. Body: { add: [...] }. */
    router.post('/v1/organisms/:id/workspace/spaces/:space/extensions',
        requireAuth(), requireScope('organism:write'), rateLimit({ windowMs: 60_000, max: 60 }),
        async (req: Request, res: Response) => {
            const ws = typeof req.query.ws === 'string' ? req.query.ws.trim() : '';
            if (!ws) {
                res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Name the workspace with ?ws=<workspace id>.'));
                return;
            }
            const orgId = req.params.id as string;
            const who = callerOf(req, config.nodeId, storage);
            // A session from another node holds no account here: its account is not a member of
            // an organism on this node, and it installed no extension on it.
            if (who.visitor) {
                res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'A session from another node is not a member of this organism.'));
                return;
            }
            const r = await nameSpaceExtensions(deps,
                { principal: who.principal, owner: who.owner, roles: who.roles, scopes: who.scopes },
                { orgId, ws, space: req.params.space as string, add: (req.body ?? {}).add });
            if (isRefusal(r)) {
                res.status(r.status).json(error(config.nodeId, r.code, r.message, r.status, r.details));
                return;
            }
            res.json(success(config.nodeId, r, [
                { description: 'Read the workspace', method: 'GET', url: `/v1/organisms/${orgId}/workspace?ws=${ws}` },
            ]));
        });
}
