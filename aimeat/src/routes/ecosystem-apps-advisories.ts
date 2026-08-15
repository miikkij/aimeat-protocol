/**
 * @file src/routes/ecosystem-apps-advisories.ts
 * @description The advisory approval gate (B7) and delivery (B8): the owner's surface to the
 *   pending advisories a recipe with requireApproval parked, plus the approve/reject decision.
 *   Extracted from ecosystem-apps.ts by pure move to satisfy max-file-lines — the three routes and
 *   their one loader are a self-contained concern that names itself in the file it came from.
 * @structure registerEcosystemAdvisoryRoutes(router, config, storage) · getPendingAdvisory()
 * @usage registerEcosystemAdvisoryRoutes(router, config, storage) from ecosystemAppsRouter().
 * @version-history
 *   v1.0.0 — 2026-08-15 — Extracted from ecosystem-apps.ts (max-file-lines), unchanged.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import {
  deliverAdvisory, pendingKey, pendingPrefix, PENDING_TYPE,
  type PendingAdvisoryRecord,
} from '../services/ecosystem-automation-advisories.js';

export function registerEcosystemAdvisoryRoutes(router: Router, config: AimeatConfig, storage: Storage): void {

  // ── Advisory approval gate (B7) + delivery (B8) ──
  // When a recipe has requireApproval:true, the advisory-drain (processAutomationAdvisories) parks each
  // wisdom-agent advisory at the owner-namespace key eco.<app>.advisory.pending.<id> instead of
  // delivering it. These three routes are the owner's surface to that pending list and the approve/
  // reject decision. Approving invokes the app's `deliver-advisory` capability over the connector
  // tunnel (the exact path the schedule executor uses); rejecting drops the advisory. Both resolve the
  // pending memory record (mark decided + clean up). This reuses the existing ecosystem-apps owner
  // surface + owner-namespace memory — it is NOT a separate approval inbox.

  /** Load a pending advisory-delivery record for (owner, app, id), or null. */
  async function getPendingAdvisory(ownerGhii: string, app: string, id: string): Promise<PendingAdvisoryRecord | null> {
    const rec = await storage.getMemory(ownerGhii, pendingKey(app, id));
    if (!rec) return null;
    const v = rec.value as PendingAdvisoryRecord | undefined;
    if (!v || v.type !== PENDING_TYPE) return null;
    return v;
  }

  // ── GET /v1/ecosystem-apps/:app/advisories/pending — owner lists awaiting-approval advisories ──
  router.get('/v1/ecosystem-apps/:app/advisories/pending', requireAuth(), requireRole('owner'), async (req, res) => {
    const app = req.params.app as string;
    const owner = req.auth!.owner;
    const ownerGhii = `${owner}@${config.nodeId}`;

    const record = await storage.getEcosystemAppByOwnerAndApp(owner, app);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Ecosystem app "${app}" not found under owner "${owner}"`));
      return;
    }

    const items = await storage.listMemory(ownerGhii, { prefix: pendingPrefix(app) });
    const pending = items
      .map((r) => r.value as PendingAdvisoryRecord)
      .filter((v) => v && v.type === PENDING_TYPE && v.status === 'pending')
      .map((v) => ({ id: v.id, app: v.app, recipe_id: v.recipeId ?? null, advisory: v.advisory, status: v.status, created_at: v.createdAt }));
    res.json(success(config.nodeId, { pending, total: pending.length }));
  });

  // ── POST /v1/ecosystem-apps/:app/advisories/:id/approve — approve → deliver over the tunnel ──
  router.post('/v1/ecosystem-apps/:app/advisories/:id/approve', requireAuth(), requireRole('owner'), async (req, res) => {
    const app = req.params.app as string;
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const ownerGhii = `${owner}@${config.nodeId}`;

    const pending = await getPendingAdvisory(ownerGhii, app, id);
    if (!pending) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No pending advisory "${id}" for app "${app}"`));
      return;
    }
    if (pending.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_RESOLVED', `Advisory already ${pending.status}`));
      return;
    }

    // B8 — deliver the approved advisory into the app's guidance sink over the connector tunnel.
    const outcome = await deliverAdvisory(config, app, owner, pending.advisory);
    const now = new Date().toISOString();

    if (outcome.state === 'delivered') {
      // Delivered — mark the record approved/delivered then clean it up (the app now holds it).
      const resolved: PendingAdvisoryRecord = {
        ...pending, status: 'approved', decidedAt: now, decidedBy: owner,
        delivery: 'delivered', deliveredId: outcome.deliveredId,
      };
      await storage.setMemory({
        key: pendingKey(app, id), ownerGaii: ownerGhii, value: resolved, visibility: 'owner',
        tags: ['advisory-resolved', app], ttlHours: null, version: 2, createdAt: pending.createdAt, updatedAt: now,
      });
      // Remove the resolved pending key so it leaves the pending list.
      await storage.deleteMemory(ownerGhii, pendingKey(app, id));
      res.json(success(config.nodeId, { id, app, status: 'approved', delivery: 'delivered', delivered_id: outcome.deliveredId }));
      emitChange('ecosystem-apps');
      return;
    }

    // Not delivered (offline/timeout or refusal/error): the owner DID approve, but delivery couldn't
    // complete. Keep the record pending (so a later approve retries) and surface the outcome so the
    // owner knows to retry once the app reconnects. We do NOT delete the payload here.
    const delivery = outcome.state === 'offline-retry' ? 'offline-retry' : 'failed';
    res.status(202).json(success(config.nodeId, { id, app, status: 'pending', delivery, reason: outcome.reason }, [
      { description: 'Retry approval once the app is connected', method: 'POST', url: `/v1/ecosystem-apps/${app}/advisories/${id}/approve` },
    ]));
  });

  // ── POST /v1/ecosystem-apps/:app/advisories/:id/reject — reject → drop the advisory ──
  router.post('/v1/ecosystem-apps/:app/advisories/:id/reject', requireAuth(), requireRole('owner'), async (req, res) => {
    const app = req.params.app as string;
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const ownerGhii = `${owner}@${config.nodeId}`;

    const pending = await getPendingAdvisory(ownerGhii, app, id);
    if (!pending) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No pending advisory "${id}" for app "${app}"`));
      return;
    }
    if (pending.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_RESOLVED', `Advisory already ${pending.status}`));
      return;
    }
    // Reject → no delivery. Drop the pending record entirely.
    await storage.deleteMemory(ownerGhii, pendingKey(app, id));
    res.json(success(config.nodeId, { id, app, status: 'rejected' }));
    emitChange('ecosystem-apps');
  });
}
