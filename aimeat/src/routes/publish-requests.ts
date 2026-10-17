/**
 * @file src/routes/publish-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The routes onto publish requests: something an agent or an app asked to make public
 *   and could not alone (services/publish-requests/, plan doc-mvcn6c7e4e5q V4.3). Registered on the
 *   memory router (routes/memory.ts).
 *
 *   GET  /v1/publish-requests               the account's requests; an app sees its own
 *   GET  /v1/publish-requests/:id           one of them
 *   POST /v1/publish-requests/:id/decision  { decision: 'approve' | 'decline' }
 *
 *   ONE DECISION ROUTE, TWO KINDS OF CALLER. The owner in person decides here: it is the route the
 *   notification's Approve and Decline run with the owner's own session. An agent of the owner
 *   decides here too, from a chat, under policy.ts: not its own request, and only holding
 *   publish:public to approve. An app grant, an ecosystem app and a visitor from another node are
 *   refused there.
 *
 *   memory:write ON ALL THREE, the word the MCP tool carries too: making a record public is a change
 *   to what is stored. The owner passes as on every route. None of these handlers decides anything:
 *   each calls the service the MCP tool calls.
 * @structure viewerOf(req) · registerPublishRequestRoutes(router, config, storage)
 * @usage registerPublishRequestRoutes(router, config, storage);  // routes/memory.ts
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireLocalSession } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import {
  listPublishRequestsFor, readPublishRequestFor, decidePublishRequest, type PublishViewer,
} from '../services/publish-requests/decide.js';

export function registerPublishRequestRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const ctx = { storage, config };
  /** Who is reading or deciding, from the token and nothing the caller sent. */
  const viewerOf = (req: Request): PublishViewer => ({
    caller: callerOf(req, config.nodeId, storage),
    ...(req.auth?.app ? { app: req.auth.app } : {}),
  });

  router.get('/v1/publish-requests', requireAuth(), requireLocalSession(), requireScope('memory:write'), async (req, res) => {
    const out = await listPublishRequestsFor(ctx, viewerOf(req));
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { requests: out.requests, waiting: out.waiting }));
  });

  router.get('/v1/publish-requests/:id', requireAuth(), requireLocalSession(), requireScope('memory:write'), async (req, res) => {
    const out = await readPublishRequestFor(ctx, viewerOf(req), req.params.id as string);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { request: out.request }));
  });

  router.post('/v1/publish-requests/:id/decision', requireAuth(), requireLocalSession(), requireScope('memory:write'), async (req, res) => {
    const out = await decidePublishRequest(ctx, viewerOf(req), req.params.id as string, req.body?.decision);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { decision: out.decision, request: out.request }));
  });
}
