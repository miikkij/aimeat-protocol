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
 *   - POST   /v1/admin/security/incidents/:id/resolve   (with { name, resolution }: decide one name)
 *   - DELETE /v1/admin/security/incidents/:id
 * @version-history
 *   v1.3.0 -- 2026-09-26 -- The resolve endpoint takes { name, resolution } to decide one name of the
 *     incident the move to the full identity opened (services/held-account-names.ts). Such an incident
 *     is neither closed nor deleted while a name is undecided (409 CONFLICT).
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
import { resolveHeldName } from '../services/held-account-names.js';

/** The HTTP status of each refusal a decision on a held name can give. */
const STATUS_OF = { NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409 } as const;

/** Why an incident with names to decide is neither closed nor deleted yet. */
const UNDECIDED = 'This incident closes when every name in it is decided. Decide each one with "name" and "resolution" ("holder" or "previous").';

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

  /* ── POST /v1/admin/security/incidents/:id/resolve ──
   * Without a body, close the incident. With { name, resolution }, decide one name of the incident
   * the move to the full identity opened: 'holder' moves its rows to the account that holds the name,
   * 'previous' settles them as a previous holder's. That incident closes with its last name. */
  router.post('/v1/admin/security/incidents/:id/resolve', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const body = (req.body ?? {}) as { name?: unknown; resolution?: unknown };
    if (body.name !== undefined || body.resolution !== undefined) {
      if (typeof body.name !== 'string' || body.name === '' || typeof body.resolution !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Deciding a name takes "name" and "resolution": "holder" or "previous".'));
        return;
      }
      const r = await resolveHeldName(config, storage, { incidentId: id, name: body.name, resolution: body.resolution });
      if (!r.ok) { res.status(STATUS_OF[r.code]).json(error(config.nodeId, r.code, r.message)); return; }
      res.json(success(config.nodeId, {
        id, name: r.name, resolution: r.resolution, done: r.done, bindings_moved: r.bindings_moved, incident_status: r.incident_status,
      }));
      return;
    }
    const r = await resolveSecurityIncident(storage, config, id);
    if (!r.ok) {
      if (r.code === 'CONFLICT') { res.status(409).json(error(config.nodeId, 'CONFLICT', UNDECIDED)); return; }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found'));
      return;
    }
    res.json(success(config.nodeId, { resolved: true, id, resolved_at: r.resolvedAt }));
  });

  /* ── DELETE /v1/admin/security/incidents/:id — remove the incident + its quarantined blob ── */
  router.delete('/v1/admin/security/incidents/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const r = await deleteSecurityIncident(storage, config, id);
    if (!r.ok) {
      if (r.code === 'CONFLICT') { res.status(409).json(error(config.nodeId, 'CONFLICT', UNDECIDED)); return; }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found'));
      return;
    }
    res.json(success(config.nodeId, { deleted: true, id }));
  });

  return router;
}
