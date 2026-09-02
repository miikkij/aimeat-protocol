/**
 * @file src/routes/organisms/workspace-documents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST surface for editing a workspace DOCUMENT in place: append markdown, and
 *   replace one section.
 *
 *   THESE HANDLERS DECIDE NOTHING. The manifest lookup, the access rule, the archive guard, the
 *   schema check, the memory ceilings and the compare-and-swap retry all live in
 *   services/workspace-doc-edit.ts, which the MCP tools and the CLI dispatch call too. That is not
 *   tidiness: the same defect has already been fixed three separate times inside one MCP tool
 *   because a rule lived in one door and not the other.
 *
 *   THE SPACE AND THE DOCUMENT ARE IN THE PATH AND THE WORKSPACE IS IN `?ws=`, matching the row
 *   routes on this same router rather than inventing a second address shape for the same thing.
 * @structure registerOrganismWorkspaceDocumentRoutes(router, config, storage)
 * @usage registerOrganismWorkspaceDocumentRoutes(router, config, storage) in routes/organisms.ts
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-workspace-append-ja-osiomuokkaus).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
    appendToDocument, replaceDocumentSection, WorkspaceDocError, type DocEditCaller, type DocEditResult,
} from '../../services/workspace-doc-edit.js';

export function registerOrganismWorkspaceDocumentRoutes(
    router: Router, config: AimeatConfig, storage: Storage,
): void {
    const deps = { storage, config };

    /** The session, in the shape the service's gate decides on. */
    const callerOf = (req: Request): DocEditCaller => ({
        principal: req.auth?.sub ?? '',
        owner: (req.auth?.owner as string) ?? '',
        roles: req.auth?.roles ?? [],
    });

    /** The workspace id. Required: a document belongs to one workspace, never to the organism at large. */
    const wsOf = (req: Request): string => {
        const ws = req.query.ws;
        return typeof ws === 'string' ? ws.trim() : '';
    };

    /** One place that turns a service refusal into a response, so every door answers the same way. */
    const fail = (res: Response, err: unknown): void => {
        if (err instanceof WorkspaceDocError) {
            res.status(err.statusCode).json(error(config.nodeId, err.code, err.message, err.statusCode, err.details));
            return;
        }
        throw err;
    };

    const needWs = (res: Response, ws: string): boolean => {
        if (ws) return true;
        res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Name the workspace with ?ws=<workspace id>.'));
        return false;
    };

    const answer = (req: Request, res: Response, result: DocEditResult): void => {
        res.json(success(config.nodeId, {
            key: result.key, id: result.id, space: result.space, namespace: result.namespace,
            version: result.version, bytes: result.bytes,
            seeded_from_published: result.seededFromPublished,
            ...(result.section ? { section: result.section } : {}),
            attempts: result.attempts,
        }, [{
            description: 'Publish the draft', method: 'POST',
            url: `/v1/organisms/${req.params.id}/publish`,
        }]));
    };

    /** Add markdown to the end of the document, or to the end of one named section. */
    router.post('/v1/organisms/:id/workspace/documents/:space/:docId/append',
        requireAuth(), requireScope('memory:write'),
        rateLimit({ windowMs: 60_000, max: 120 }),
        async (req: Request, res: Response) => {
            const ws = wsOf(req);
            if (!needWs(res, ws)) return;
            try {
                const body = req.body ?? {};
                answer(req, res, await appendToDocument(deps, callerOf(req), {
                    organismId: req.params.id as string,
                    wsId: ws,
                    space: req.params.space as string,
                    id: req.params.docId as string,
                    markdown: body.markdown,
                    ...(typeof body.section === 'string' && body.section.trim() ? { section: body.section } : {}),
                    pipeline: 'rest.workspace_doc_append',
                }));
            } catch (err) { fail(res, err); }
        });

    /** Replace one heading and its body; every other byte of the document stays as it was. */
    router.post('/v1/organisms/:id/workspace/documents/:space/:docId/section',
        requireAuth(), requireScope('memory:write'),
        rateLimit({ windowMs: 60_000, max: 120 }),
        async (req: Request, res: Response) => {
            const ws = wsOf(req);
            if (!needWs(res, ws)) return;
            try {
                const body = req.body ?? {};
                answer(req, res, await replaceDocumentSection(deps, callerOf(req), {
                    organismId: req.params.id as string,
                    wsId: ws,
                    space: req.params.space as string,
                    id: req.params.docId as string,
                    section: typeof body.section === 'string' ? body.section : '',
                    markdown: body.markdown,
                    pipeline: 'rest.workspace_doc_section',
                }));
            } catch (err) { fail(res, err); }
        });
}
