/**
 * @file src/routes/instances/install-requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The doors onto package install requests: an install, update or migration an agent or
 *   an app asked for and could not do alone (services/package-install-requests.ts).
 *
 *   GET  /v1/package-install-requests               the account's requests; an app sees its own
 *   GET  /v1/package-install-requests/:id           one of them
 *   POST /v1/package-install-requests/:id/decision  { decision: 'approve' | 'decline' }
 *
 *   ONE DECISION DOOR, TWO KINDS OF CALLER. The owner in person decides here: it is the door the
 *   notification's Approve and Decline run with the owner's own session. An agent of the owner decides
 *   here too, from a chat, under device authorization's rule (package-install-request-policy.ts): not
 *   its own request, and only with every word the install needs. An app grant, an ecosystem app and a
 *   visitor from another node are refused. `requireOwnerPrincipal()` is not the gate, because it would
 *   admit an agent holding account:security past the not-its-own and the words rules; the policy asks
 *   ownerBypassesScopes(), which is requireScope's own owner test.
 *
 *   packages:write ON ALL THREE. Deciding an install is taking part in installing, and the tool on the
 *   MCP surfaces carries the same word, so the two cannot disagree. The owner passes as at every door.
 *   None of these handlers decides anything: each calls the service the MCP tool calls.
 * @structure actCallerOf(req, owner, ownerGhii) · registerInstallRequestRoutes(router, config, storage, scheduler)
 * @usage registerInstallRequestRoutes(router, config, storage, scheduler);  // from routes/instances.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: package installs by agents become requests.
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { Scheduler } from '../../services/scheduler.js';
import { requireAuth, requireScope, requireLocalSession } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import {
  listRequestsFor, readRequestFor, decideInstallRequest, type PackageActCaller, type RequestViewer,
} from '../../services/package-install-requests.js';

/** The caller of an install, update or migration door, with what names an app grant and an MCP client. */
export function actCallerOf(req: Request, owner: string, ownerGhii: string): PackageActCaller {
  const a = req.auth!;
  return {
    owner, sub: a.sub, ownerGhii, roles: a.roles, scopes: a.scopes ?? [], federated: a.federated,
    app: a.app, grant: a.app_grant, client: a.mcp_client,
  };
}

/** Who is reading or deciding, from the token and nothing the caller sent. */
function viewerOf(req: Request): RequestViewer {
  const a = req.auth!;
  return { sub: a.sub, owner: a.owner, roles: a.roles, scopes: a.scopes ?? [], federated: a.federated, app: a.app };
}

export function registerInstallRequestRoutes(router: Router, config: AimeatConfig, storage: Storage, scheduler?: Scheduler): void {
  const deps = { storage, config, scheduler };

  router.get('/v1/package-install-requests', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
    const out = await listRequestsFor(deps, viewerOf(req));
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { requests: out.requests, waiting: out.waiting }));
  });

  router.get('/v1/package-install-requests/:id', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
    const out = await readRequestFor(deps, viewerOf(req), req.params.id as string);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { request: out.request }));
  });

  router.post('/v1/package-install-requests/:id/decision', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
    const out = await decideInstallRequest(deps, viewerOf(req), req.params.id as string, req.body?.decision);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    const instanceId = out.request.outcome?.instance_id;
    res.json(success(config.nodeId, { decision: out.decision, request: out.request, ...(out.result ?? {}) },
      instanceId ? [{ description: 'The installed copy', method: 'GET', url: `/v1/instances/${instanceId}` }] : []));
  });
}
