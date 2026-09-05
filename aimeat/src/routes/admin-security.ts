/**
 * @file admin-security.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's security doors: the Security page in one read (what is happening at
 *   the door, who was turned away, what was refused and kept, who holds the keys, what the doors are
 *   set to), the refusal log's tail on its own, and the incident actions (download the quarantined
 *   payload, resolve, delete). Every read and action calls services/security-overview.ts or
 *   services/security-incident.ts, which the MCP tools call too.
 * @structure adminSecurityRouter(config, storage)
 *   - GET    /v1/admin/security/overview
 *   - GET    /v1/admin/auth-refusals
 *   - GET    /v1/admin/security/incidents
 *   - GET    /v1/admin/security/incidents/:id/quarantine   (download the quarantined bytes)
 *   - POST   /v1/admin/security/incidents/:id/resolve
 *   - DELETE /v1/admin/security/incidents/:id
 * @version-history
 *   v1.2.0 -- 2026-09-05 -- GET /v1/admin/security/overview, the one read behind the Security page
 *     in the poster face; the incident routes call the service instead of reading storage here.
 *   v1.1.0 -- 2026-08-17 -- GET /v1/admin/auth-refusals: the refusal log's tail as a list,
 *     so the Security tab can show who was turned away instead of only counting them.
 *   v1.0.0 -- 2026-06-09 -- Initial: list / inspect / resolve / delete security incidents.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import {
  listSecurityIncidents, findSecurityIncident, resolveSecurityIncident, deleteSecurityIncident,
  type SecurityIncidentValue,
} from '../services/security-incident.js';
import { buildSecurityOverview } from '../services/security-overview.js';
import { readRecentAuthFailures } from '../services/auth-audit.js';

export function adminSecurityRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── GET /v1/admin/security/overview — the Security page in one read ── */
  router.get('/v1/admin/security/overview', requireAuth(), requireRole('operator'), async (_req, res) => {
    res.json(success(config.nodeId, await buildSecurityOverview(config, storage)));
  });

  /* ── GET /v1/admin/auth-refusals — the refusal log's tail, newest first ── */
  router.get('/v1/admin/auth-refusals', requireAuth(), requireRole('operator'), (req, res) => {
    const raw = parseInt(String(req.query.limit ?? '200'), 10);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 200, 1), 1000);
    const { enabled, items } = readRecentAuthFailures(limit);
    res.json(success(config.nodeId, { enabled, items, count: items.length }));
  });

  /* ── GET /v1/admin/security/incidents — newest first + open count ── */
  router.get('/v1/admin/security/incidents', requireAuth(), requireRole('operator'), async (_req, res) => {
    const { items, open, total } = await listSecurityIncidents(storage, config);
    res.json(success(config.nodeId, { incidents: items, open, total }));
  });

  /* ── GET /v1/admin/security/incidents/:id/quarantine — download the quarantined payload ── */
  router.get('/v1/admin/security/incidents/:id/quarantine', requireAuth(), requireRole('operator'), async (req, res) => {
    const rec = await findSecurityIncident(storage, config, req.params.id as string);
    const qk = rec && (rec.value as SecurityIncidentValue).quarantine_key;
    if (!rec || !qk) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No quarantined payload for this incident')); return; }
    const file = await storage.getStorageFile(rec.ownerGaii, qk);
    if (!file) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Quarantined payload not found')); return; }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="quarantine-${req.params.id}.zip"`);
    res.send(file.data);
  });

  /* ── POST /v1/admin/security/incidents/:id/resolve ── */
  router.post('/v1/admin/security/incidents/:id/resolve', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const r = await resolveSecurityIncident(storage, config, id);
    if (!r.ok) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found')); return; }
    res.json(success(config.nodeId, { resolved: true, id, resolved_at: r.resolvedAt }));
  });

  /* ── DELETE /v1/admin/security/incidents/:id — remove the incident + its quarantined blob ── */
  router.delete('/v1/admin/security/incidents/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const r = await deleteSecurityIncident(storage, config, id);
    if (!r.ok) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found')); return; }
    res.json(success(config.nodeId, { deleted: true, id }));
  });

  return router;
}
