/**
 * @file src/routes/admin-sso.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator management of SSO connections (BR-04) plus the one public piece, the SP
 *   metadata document an IdP fetches. Management works with `sso.enabled` OFF on purpose — a node
 *   is configured first and switched on second; only the public doors gate on the flag. The work
 *   happens in services/sso-connections.ts, shared with the operator MCP tools, so this file is
 *   the HTTP shape only: operator gate, params, envelope.
 * @structure adminSsoRouter(config, storage): operator CRUD under /v1/admin/sso/connections,
 *   POST …/:id/scim-token, POST …/:id/idp-metadata, and the public GET /v1/sso/:id/metadata.
 * @usage app.use(adminSsoRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-08-24 — Thin over services/sso-connections.ts (pure logic move) when the MCP
 *     tools became the second caller.
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 1).
 */
import { Router } from 'express';
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { spMetadataXml } from '../services/saml-sp.js';
import {
  listSsoConnectionViews, getSsoConnectionView, createSsoConnection, updateSsoConnectionAdmin,
  deleteSsoConnectionAdmin, mintScimToken, setIdpMetadata, type SsoAdminRefusal,
} from '../services/sso-connections.js';

export function adminSsoRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const operator = [requireAuth(), requireRole('operator')] as const;
  const sendRefusal = (res: Response, r: SsoAdminRefusal) =>
    res.status(r.status).json(error(config.nodeId, r.code, r.message));

  // GET /v1/admin/sso/connections — the operator's list.
  router.get('/v1/admin/sso/connections', ...operator, async (_req, res) => {
    res.json(success(config.nodeId, { connections: await listSsoConnectionViews(config, storage) }));
  });

  // POST /v1/admin/sso/connections — create.
  router.post('/v1/admin/sso/connections', ...operator, async (req, res) => {
    const r = await createSsoConnection(config, storage, req.body ?? {}, req.auth!.owner);
    if (!r.ok) { sendRefusal(res, r); return; }
    res.status(201).json(success(config.nodeId, { connection: r.connection }));
  });

  // GET /v1/admin/sso/connections/:id
  router.get('/v1/admin/sso/connections/:id', ...operator, async (req, res) => {
    const view = await getSsoConnectionView(config, storage, req.params.id as string);
    if (!view) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Connection not found')); return; }
    res.json(success(config.nodeId, { connection: view }));
  });

  // PUT /v1/admin/sso/connections/:id — the mutable half; never the id, never SAML directly.
  router.put('/v1/admin/sso/connections/:id', ...operator, async (req, res) => {
    const r = await updateSsoConnectionAdmin(config, storage, req.params.id as string, req.body ?? {});
    if (!r.ok) { sendRefusal(res, r); return; }
    res.json(success(config.nodeId, { connection: r.connection }));
  });

  // DELETE /v1/admin/sso/connections/:id — removes the door, not the people.
  router.delete('/v1/admin/sso/connections/:id', ...operator, async (req, res) => {
    const r = await deleteSsoConnectionAdmin(config, storage, req.params.id as string);
    if (!r.ok) { sendRefusal(res, r); return; }
    res.json(success(config.nodeId, { deleted: true }));
  });

  // POST /v1/admin/sso/connections/:id/scim-token — mint the SCIM bearer, shown once.
  router.post('/v1/admin/sso/connections/:id/scim-token', ...operator, async (req, res) => {
    const r = await mintScimToken(config, storage, req.params.id as string);
    if (!r.ok) { sendRefusal(res, r); return; }
    res.status(201).json(success(config.nodeId, { scim_token: r.scim_token, note: r.note }));
  });

  // POST /v1/admin/sso/connections/:id/idp-metadata — URL (safeFetch) or pasted XML.
  router.post('/v1/admin/sso/connections/:id/idp-metadata', ...operator, async (req, res) => {
    const r = await setIdpMetadata(config, storage, req.params.id as string, req.body ?? {});
    if (!r.ok) { sendRefusal(res, r); return; }
    res.json(success(config.nodeId, { connection: r.connection }));
  });

  // GET /v1/sso/:id/metadata — PUBLIC: the SP metadata document, which is also this SP's entityID.
  // The IdP fetches it, so no auth; gated on sso.enabled like every public SSO door.
  router.get('/v1/sso/:id/metadata', async (req, res) => {
    if (!config.ssoEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Organisation sign-in is not enabled on this node'));
      return;
    }
    const c = await storage.getSsoConnection(req.params.id as string);
    if (!c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Connection not found')); return; }
    res.type('application/xml').send(spMetadataXml(config, c));
  });

  return router;
}
