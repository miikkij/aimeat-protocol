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
 *   - POST   /v1/admin/security/incidents/:id/resolve   (with { name, resolution }: decide one case)
 *   - DELETE /v1/admin/security/incidents/:id
 * @version-history
 *   v1.8.0 -- 2026-10-29 -- An entry's action can be "uncount" (a platform-fee record is left out of the
 *     dashboard's money fees); the refusal of a malformed body names it (secaudit2026oct26 round 8c).
 *   v1.7.0 -- 2026-10-27 -- An entry's action can be "app_only" (an address of the subdomain incident is
 *     served only at its app address); the refusal of a malformed body names it (Jouni, 2026-10-27).
 *   v1.6.0 -- 2026-10-25 -- The resolve endpoint decides an entry of an incident that names records to
 *     act on too: its action ("clear" or "delete") or "keep" (services/incident-entries.ts; secaudit2026oct22).
 *   v1.5.0 -- 2026-10-18 -- The resolve endpoint decides one case of either kind through
 *     services/incident-decisions.ts: a held name ("holder" / "previous") or an offered default
 *     audience cap ("apply" / "keep", plan doc-mvdipuyqraas, L5.1). A refused close or delete says why
 *     in the words of the incident's kind.
 *   v1.4.0 -- 2026-10-05 -- The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2).
 *   v1.3.1 -- 2026-09-26 -- The resolve endpoint's comment names the app grants and access tokens a
 *     decision on a name covers.
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
import { requireAuth, requireOperator } from '../auth/middleware.js';
import {
  listSecurityIncidents, findSecurityIncident, resolveSecurityIncident, deleteSecurityIncident,
  type SecurityIncidentValue,
} from '../services/security-incident.js';
import { buildSecurityOverview } from '../services/security-overview.js';
import { readRecentAuthFailures } from '../services/auth-audit.js';
import { decideIncidentCase } from '../services/incident-decisions.js';
import { callerOf } from '../middleware/caller.js';
import { capByOf } from '../services/classification/audience-cap.js';

/** The HTTP status of each refusal a decision on one case can give. */
const STATUS_OF = { NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409 } as const;

/** Why an incident with cases to decide is neither closed nor deleted yet, when the service gave no words. */
const UNDECIDED = 'This incident closes when every case in it is decided. Decide each one with "name" and "resolution".';

export function adminSecurityRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── GET /v1/admin/security/overview — the Security page in one read ── */
  router.get('/v1/admin/security/overview', requireAuth(), requireOperator(storage), async (_req, res) => {
    res.json(success(config.nodeId, await buildSecurityOverview(config, storage)));
  });

  /* ── GET /v1/admin/auth-refusals — the refusal log's tail, newest first ── */
  router.get('/v1/admin/auth-refusals', requireAuth(), requireOperator(storage), (req, res) => {
    const raw = parseInt(String(req.query.limit ?? '200'), 10);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 200, 1), 1000);
    const { enabled, items } = readRecentAuthFailures(limit);
    res.json(success(config.nodeId, { enabled, items, count: items.length }));
  });

  /* ── GET /v1/admin/security/incidents — newest first + open count ── */
  router.get('/v1/admin/security/incidents', requireAuth(), requireOperator(storage), async (_req, res) => {
    const { items, open, total } = await listSecurityIncidents(storage, config);
    res.json(success(config.nodeId, { incidents: items, open, total }));
  });

  /* ── GET /v1/admin/security/incidents/:id/quarantine — download the quarantined payload ── */
  router.get('/v1/admin/security/incidents/:id/quarantine', requireAuth(), requireOperator(storage), async (req, res) => {
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
   * Without a body, close the incident. With { name, resolution }, decide one case:
   * - a name of the incident the move to the full identity and the start steps opened: 'holder' moves
   *   its rows to the account that holds the name and keeps its cortexes, ecosystem apps, app grants
   *   and access tokens, 'previous' settles them as a previous holder's (the older app grants and
   *   access tokens deleted);
   * - a default audience cap the start offered (classification_default_caps): 'apply' puts the cap
   *   on that classification in the node's policy, 'keep' leaves it without one. No content changes;
   * - an entry of an incident that names records to act on (services/incident-entries.ts): the
   *   entry's action, 'clear' or 'delete', or 'keep'.
   * Such an incident closes with its last case. */
  router.post('/v1/admin/security/incidents/:id/resolve', requireAuth(), requireOperator(storage), async (req, res) => {
    const id = req.params.id as string;
    const body = (req.body ?? {}) as { name?: unknown; resolution?: unknown };
    if (body.name !== undefined || body.resolution !== undefined) {
      if (typeof body.name !== 'string' || body.name === '' || typeof body.resolution !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Deciding a case takes "name" and "resolution": "holder" or "previous" for a held name, "apply" or "keep" for an offered cap, the entry\'s action ("clear", "delete", "app_only" or "uncount") or "keep" for an entry.'));
        return;
      }
      // An agent or an ecosystem app decides as an AI, anyone else as a person (the policy history says which).
      const caller = capByOf(callerOf(req, config.nodeId, storage));
      const by = { principal: caller.principal, kind: caller.kind === 'ai' ? 'ai' as const : 'human' as const };
      const r = await decideIncidentCase(config, storage, { incidentId: id, name: body.name, resolution: body.resolution, by });
      if (!r.ok) { res.status(STATUS_OF[r.code]).json(error(config.nodeId, r.code, r.message)); return; }
      res.json(success(config.nodeId, { id, ...r.data }));
      return;
    }
    const r = await resolveSecurityIncident(storage, config, id);
    if (!r.ok) {
      if (r.code === 'CONFLICT') { res.status(409).json(error(config.nodeId, 'CONFLICT', r.message ?? UNDECIDED)); return; }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found'));
      return;
    }
    res.json(success(config.nodeId, { resolved: true, id, resolved_at: r.resolvedAt }));
  });

  /* ── DELETE /v1/admin/security/incidents/:id — remove the incident + its quarantined blob ── */
  router.delete('/v1/admin/security/incidents/:id', requireAuth(), requireOperator(storage), async (req, res) => {
    const id = req.params.id as string;
    const r = await deleteSecurityIncident(storage, config, id);
    if (!r.ok) {
      if (r.code === 'CONFLICT') { res.status(409).json(error(config.nodeId, 'CONFLICT', r.message ?? UNDECIDED)); return; }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Incident not found'));
      return;
    }
    res.json(success(config.nodeId, { deleted: true, id }));
  });

  return router;
}
