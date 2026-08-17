/**
 * @file admin-security.ts
 * @description Operator-only security incident management. Lists incidents recorded by
 *   services/security-incident.ts (e.g. a rejected/quarantined ZIP upload — what, who, when, code),
 *   lets an operator download the quarantined payload for inspection, mark an incident resolved, or
 *   delete it together with its quarantined blob.
 * @structure adminSecurityRouter(config, storage)
 *   - GET    /v1/admin/auth-refusals
 *   - GET    /v1/admin/security/incidents
 *   - GET    /v1/admin/security/incidents/:id/quarantine   (download the quarantined bytes)
 *   - POST   /v1/admin/security/incidents/:id/resolve
 *   - DELETE /v1/admin/security/incidents/:id
 * @version-history
 *   v1.1.0 -- 2026-08-17 -- GET /v1/admin/auth-refusals: the refusal log's tail as a list,
 *     so the Security tab can show who was turned away instead of only counting them.
 *   v1.0.0 -- 2026-06-09 -- Initial: list / inspect / resolve / delete security incidents.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { SECURITY_INCIDENT_PREFIX, securityOwner } from '../services/security-incident.js';
import { readRecentAuthFailures } from '../services/auth-audit.js';
import { logger } from '../utils/logger.js';

interface IncidentValue { id: string; type: string; code: string; actor: string; actor_name: string; detail: string; source: string; quarantine_key: string | null; size_bytes: number; status: string; createdAt: string }

export function adminSecurityRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const owner = securityOwner(config.nodeId);

  const findIncident = async (id: string) => {
    const { items } = await storage.listAllMemory({ prefix: SECURITY_INCIDENT_PREFIX, limit: 1000 });
    return items.find(r => r.ownerGaii === owner && (r.value as IncidentValue | undefined)?.id === id) ?? null;
  };

  /* ── GET /v1/admin/auth-refusals — the refusal log's tail, newest first ── */
  router.get('/v1/admin/auth-refusals', requireAuth(), requireRole('operator'), (req, res) => {
    const raw = parseInt(String(req.query.limit ?? '200'), 10);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 200, 1), 1000);
    const { enabled, items } = readRecentAuthFailures(limit);
    res.json(success(config.nodeId, { enabled, items, count: items.length }));
  });

  /* ── GET /v1/admin/security/incidents — newest first + open count ── */
  router.get('/v1/admin/security/incidents', requireAuth(), requireRole('operator'), async (_req, res) => {
    const { items } = await storage.listAllMemory({ prefix: SECURITY_INCIDENT_PREFIX, limit: 1000 });
    const incidents = items
      .filter(r => r.ownerGaii === owner)
      .map(r => r.value as IncidentValue)
      .filter(v => v && v.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(success(config.nodeId, {
      incidents: incidents.slice(0, 200),
      open: incidents.filter(i => i.status === 'open').length,
      total: incidents.length,
    }));
  });

  /* ── GET /v1/admin/security/incidents/:id/quarantine — download the quarantined payload ── */
  router.get('/v1/admin/security/incidents/:id/quarantine', requireAuth(), requireRole('operator'), async (req, res) => {
    const rec = await findIncident(req.params.id as string);
    const qk = rec && (rec.value as IncidentValue).quarantine_key;
    if (!rec || !qk) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No quarantined payload for this incident')); return; }
    const file = await storage.getStorageFile(owner, qk);
    if (!file) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Quarantined payload not found')); return; }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="quarantine-${req.params.id}.zip"`);
    res.send(file.data);
  });

  /* ── POST /v1/admin/security/incidents/:id/resolve ── */
  router.post('/v1/admin/security/incidents/:id/resolve', requireAuth(), requireRole('operator'), async (req, res) => {
    const rec = await findIncident(req.params.id as string);
    if (!rec) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found')); return; }
    const now = new Date().toISOString();
    await storage.setMemory({ key: rec.key, ownerGaii: rec.ownerGaii, value: { ...(rec.value as IncidentValue), status: 'resolved', resolvedAt: now }, visibility: rec.visibility, tags: rec.tags, ttlHours: rec.ttlHours, version: rec.version + 1, createdAt: rec.createdAt, updatedAt: now });
    res.json(success(config.nodeId, { resolved: true, id: req.params.id }));
  });

  /* ── DELETE /v1/admin/security/incidents/:id — remove the incident + its quarantined blob ── */
  router.delete('/v1/admin/security/incidents/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const rec = await findIncident(req.params.id as string);
    if (!rec) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found')); return; }
    const qk = (rec.value as IncidentValue).quarantine_key;
    if (qk) { try { await storage.deleteStorageFile(owner, qk); } catch (err) { logger.warn('qk: best-effort', { error: String(err) }); } }
    await storage.deleteMemory(owner, rec.key);
    res.json(success(config.nodeId, { deleted: true, id: req.params.id }));
  });

  return router;
}
