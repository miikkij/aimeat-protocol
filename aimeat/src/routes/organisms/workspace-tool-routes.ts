/**
 * @file src/routes/organisms/workspace-tool-routes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST routes for the two workspace operations an agent performs most: read the
 *   index (or open named records) and write a draft. Both are services/workspace-tool-ops.ts, the
 *   functions aimeat_workspace_read and aimeat_workspace_write run on the node's MCP and ctx.workspace
 *   runs in the extension sandbox.
 *
 *   WHY THESE ROUTES EXIST. The connector and the CLI dispatch speak HTTP only, and had no route for
 *   either operation: they read the whole workspace from GET /v1/organisms/:id/workspace and shaped an
 *   index of their own, and they wrote drafts with POST /v1/memory, each with its own copy of the
 *   space resolution, the schema check and the section filing. These routes run the one
 *   implementation, so the same call answers the same thing on every surface
 *   (secaudit 2026-10 follow-up, Part B).
 * @structure registerOrganismWorkspaceToolRoutes(router, config, storage)
 * @usage registerOrganismWorkspaceToolRoutes(router, config, storage) in routes/organisms.ts
 * @version-history
 *   v1.0.2 — 2026-10-06 — The caller carries the session's scopes; a provenance declaration the
 *     session may not make answers 403 SCOPE_DENIED, where it answered 500 (secaudit 2026-10 last
 *     items, F2).
 *   v1.0.1 — 2026-10-06 — POST /workspace/drafts asks memory:write, as aimeat_workspace_write does on
 *     the node's MCP; it asked organism:write, so an agent wrote drafts on one surface and was refused
 *     on the other (secaudit 2026-10 follow-up audit, finding 2).
 *   v1.0.0 — 2026-10-06 — Initial: GET /workspace/index and POST /workspace/drafts.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { callerOf } from '../../middleware/caller.js';
import { readerFor } from '../../services/classification/reader.js';
import {
    readWorkspaceOp, writeWorkspaceDraftsOp, workspaceCallerOf, type WorkspaceOpRefusal, type WorkspaceOpsCaller,
} from '../../services/workspace-tool-ops.js';
import { parseDeclaredProvenanceInput } from '../../mcp/ai-provenance-input.js';

export function registerOrganismWorkspaceToolRoutes(
    router: Router, config: AimeatConfig, storage: Storage,
): void {
    const deps = { storage, config };

    /** The session as the operations take it, or null for a visitor from another node: workspace
     *  membership is held by accounts on this node, and a visitor's home account is not one. */
    const opsCallerOf = (req: Request): WorkspaceOpsCaller | null => {
        const who = callerOf(req, config.nodeId, storage);
        if (who.visitor) return null;
        // The session's scopes travel with it: a provenance declaration asks provenance:write of
        // them as well as of the grant (secaudit 2026-10 last items, F2).
        return workspaceCallerOf({ principal: who.principal, ownerName: who.owner, roles: [...who.roles], scopes: who.scopes }, config);
    };

    const refuse = (res: Response, r: WorkspaceOpRefusal): void => {
        res.status(r.status).json(error(config.nodeId, r.code, r.message, r.status, r.details));
    };

    const visitorRefusal = (res: Response): void => {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'A session from another node is not a member of this organism.'));
    };

    /** GET /v1/organisms/:id/workspace/index?ws=&ids=a,b&space=&include_archived=true — the index
     *  (titles, no bodies), or the full values of the named ids. */
    router.get('/v1/organisms/:id/workspace/index', requireAuth(), requireScope('organism:read'), async (req: Request, res: Response) => {
        const caller = opsCallerOf(req);
        if (!caller) { visitorRefusal(res); return; }
        const ws = typeof req.query.ws === 'string' ? req.query.ws.trim() : '';
        if (!ws) { res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Name the workspace with ?ws=<workspace id>.')); return; }
        const ids = typeof req.query.ids === 'string'
            ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const r = await readWorkspaceOp(deps, caller, {
            organismId: req.params.id as string, ws,
            ids: ids?.length ? ids : undefined,
            space: typeof req.query.space === 'string' && req.query.space ? req.query.space : undefined,
            includeArchived: req.query.include_archived === 'true',
            reader: readerFor({ storage, config }, req.auth),
        });
        if (!r.ok) { refuse(res, r); return; }
        res.json(success(config.nodeId, r.data));
    });

    /** POST /v1/organisms/:id/workspace/drafts — one draft ({ ws, space, value, id?, section? }) or a
     *  batch ({ ws, items: [...] }), all resolved and validated before any is written. It asks
     *  memory:write, the word aimeat_workspace_write asks on the node's MCP and the word POST /v1/memory
     *  asked when the connector wrote drafts through it; publishing a draft asks organism:write. */
    router.post('/v1/organisms/:id/workspace/drafts',
        requireAuth(), requireScope('memory:write'), rateLimit({ windowMs: 60_000, max: 120 }),
        async (req: Request, res: Response) => {
            const caller = opsCallerOf(req);
            if (!caller) { visitorRefusal(res); return; }
            const body = (req.body ?? {}) as Record<string, unknown>;
            const ws = typeof body.ws === 'string' ? body.ws.trim() : '';
            if (!ws) { res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Say which workspace to write into.', 400, { field: 'ws' })); return; }
            const declared = parseDeclaredProvenanceInput(body.ai_provenance);
            if (!declared.ok) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid ai_provenance declaration.', 400, { violations: declared.violations }));
                return;
            }
            const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
            const r = await writeWorkspaceDraftsOp(deps, caller, {
                organismId: req.params.id as string, ws,
                space: str(body.space), value: body.value, id: str(body.id), section: str(body.section), items: body.items,
                aiProvenance: declared.declared, aiProvenanceId: str(body.ai_provenance_id),
                pipeline: 'rest.workspace_drafts',
            });
            if (!r.ok) { refuse(res, r); return; }
            res.json(success(config.nodeId, r.data));
        });
}
