/**
 * @file src/routes/organisms/workspace-member-changes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST doors for a member's change to a workspace, and for deciding a member's
 *   suggestion: add a space, set a document space's section index, list suggestions, decide one.
 *
 *   THESE HANDLERS DECIDE NOTHING. Who may change a workspace, whether the change lands at once or
 *   waits for an approval under the workspace's rule, who may decide a suggestion and what approving
 *   one runs all live in services/workspace-member-changes.ts and services/workspace-suggestions.ts,
 *   which the MCP tools and the CLI dispatch call too. The answer's status says what happened: 200
 *   with `status: 'applied'` (or 'unchanged'), 202 with `status: 'pending_approval'` and the
 *   suggestion, or the refusal with its reason.
 *
 *   The workspace is `?ws=`, and the space is in the path, matching the row and document routes on
 *   this same router.
 * @structure registerOrganismWorkspaceMemberChangeRoutes(router, config, storage)
 * @usage registerOrganismWorkspaceMemberChangeRoutes(router, config, storage) in routes/organisms.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity } from '../../utils/gaii.js';
import {
    addWorkspaceSpaces, setWorkspaceSections, isRefusal, type ChangeCaller, type ChangeRefusal,
} from '../../services/workspace-member-changes.js';
import { listSuggestions, decideSuggestion, type SuggestionStatusFilter } from '../../services/workspace-suggestions.js';

const STATUSES: SuggestionStatusFilter[] = ['pending', 'approved', 'declined', 'expired', 'all'];

export function registerOrganismWorkspaceMemberChangeRoutes(
    router: Router, config: AimeatConfig, storage: Storage,
): void {
    const deps = { storage, config };

    /** The session, in the shape the services decide on: its full identity, owner and roles. */
    const callerOf = (req: Request): ChangeCaller => ({
        principal: resolveIdentity(req.auth!, config.nodeId),
        owner: (req.auth!.owner as string) ?? '',
        roles: req.auth!.roles ?? [],
    });

    const wsOf = (req: Request): string => (typeof req.query.ws === 'string' ? req.query.ws.trim() : '');

    const needWs = (res: Response, ws: string): boolean => {
        if (ws) return true;
        res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Name the workspace with ?ws=<workspace id>.'));
        return false;
    };

    /** One place that turns a service refusal into a response, so every door answers the same way. */
    const refuse = (res: Response, r: ChangeRefusal): void => {
        res.status(r.status).json(error(config.nodeId, r.code, r.message, r.status, r.details));
    };

    /** Add one or more spaces. Body: { spaces: { name, namespace, mode } | [...], schemas? }. */
    router.post('/v1/organisms/:id/workspace/spaces',
        requireAuth(), requireScope('organism:write'), rateLimit({ windowMs: 60_000, max: 60 }),
        async (req: Request, res: Response) => {
            const ws = wsOf(req);
            if (!needWs(res, ws)) return;
            const orgId = req.params.id as string;
            const body = req.body ?? {};
            const r = await addWorkspaceSpaces(deps, callerOf(req), { orgId, ws, spaces: body.spaces, schemas: body.schemas });
            if (isRefusal(r)) { refuse(res, r); return; }
            res.status(r.status === 'pending_approval' ? 202 : 200).json(success(config.nodeId, r, [
                { description: 'Read the workspace', method: 'GET', url: `/v1/organisms/${orgId}/workspace?ws=${ws}` },
                ...(r.suggestion ? [{ description: 'The suggestions waiting in this workspace', method: 'GET', url: `/v1/organisms/${orgId}/workspace/suggestions?ws=${ws}` }] : []),
            ]));
        });

    /** Replace one document space's section index. Body: { sections: [{ id, name, parentId, documents, color? }] }. */
    router.put('/v1/organisms/:id/workspace/sections/:space',
        requireAuth(), requireScope('organism:write'), rateLimit({ windowMs: 60_000, max: 120 }),
        async (req: Request, res: Response) => {
            const ws = wsOf(req);
            if (!needWs(res, ws)) return;
            const orgId = req.params.id as string;
            const r = await setWorkspaceSections(deps, callerOf(req), { orgId, ws, space: req.params.space as string, sections: req.body?.sections });
            if (isRefusal(r)) { refuse(res, r); return; }
            res.status(r.status === 'pending_approval' ? 202 : 200).json(success(config.nodeId, r, [
                { description: 'Read the workspace', method: 'GET', url: `/v1/organisms/${orgId}/workspace?ws=${ws}` },
            ]));
        });

    /** The suggestions the caller may see, newest first. ?ws= narrows to one workspace, ?status= picks which. */
    router.get('/v1/organisms/:id/workspace/suggestions',
        requireAuth(), requireScope('organism:read'),
        async (req: Request, res: Response) => {
            const orgId = req.params.id as string;
            const status = typeof req.query.status === 'string' && STATUSES.includes(req.query.status as SuggestionStatusFilter)
                ? req.query.status as SuggestionStatusFilter : undefined;
            const ws = wsOf(req);
            const r = await listSuggestions(deps, callerOf(req), { orgId, ...(ws ? { ws } : {}), ...(status ? { status } : {}) });
            if (isRefusal(r)) { refuse(res, r); return; }
            res.json(success(config.nodeId, { ...r, total: r.suggestions.length }));
        });

    /** Approve or decline one suggestion. Body: { decision: 'approve' | 'decline', note? }. */
    router.post('/v1/organisms/:id/workspace/suggestions/:sid',
        requireAuth(), requireScope('organism:write'), rateLimit({ windowMs: 60_000, max: 120 }),
        async (req: Request, res: Response) => {
            const orgId = req.params.id as string;
            const body = req.body ?? {};
            const r = await decideSuggestion(deps, callerOf(req), { orgId, id: req.params.sid as string, decision: body.decision, note: body.note });
            if (isRefusal(r)) { refuse(res, r); return; }
            res.json(success(config.nodeId, r, [
                { description: 'Read the workspace', method: 'GET', url: `/v1/organisms/${orgId}/workspace?ws=${r.suggestion.ws}` },
            ]));
        });
}
