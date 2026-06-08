/**
 * @file notifications.ts
 * @description In-app notification inbox API. A notification is a small memory record under the
 *   recipient's owner GHII (created server-side by events via services/notify.ts). These routes let
 *   the recipient list their notifications + unread count (for the header bell) and mark them read.
 *   Owner-scoped: a caller only ever sees their own owner's notifications.
 * @structure
 *   - GET  /v1/notifications        — list (newest first) + unread count
 *   - POST /v1/notifications/read   — mark notifications read ({ ids } or { all: true })
 * @usage app.use(notificationsRouter(config, storage));
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: memory-backed notification inbox.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { NOTIF_PREFIX } from '../services/notify.js';

interface NotifValue { id: string; type: string; title: string; body: string; link: string; read: boolean; createdAt: string }

export function notificationsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  /* ── GET /v1/notifications — the caller's inbox (newest first) + unread count ── */
  router.get('/v1/notifications', requireAuth(), async (req, res) => {
    const ghii = ownerGhii(req);
    const { items } = await storage.listAllMemory({ prefix: NOTIF_PREFIX, limit: 500 });
    const mine = items
      .filter(r => r.ownerGaii === ghii)
      .map(r => r.value as NotifValue)
      .filter(v => v && typeof v === 'object' && v.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const unread = mine.filter(n => !n.read).length;
    res.json(success(config.nodeId, { notifications: mine.slice(0, 50), unread }));
  });

  /* ── POST /v1/notifications/read — mark notifications read ({ ids: [...] } or { all: true }) ── */
  router.post('/v1/notifications/read', requireAuth(), async (req, res) => {
    const ghii = ownerGhii(req);
    const { ids, all } = req.body ?? {};
    if (!all && !Array.isArray(ids)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide ids[] or all:true'));
      return;
    }
    const idSet = Array.isArray(ids) ? new Set(ids) : null;
    const { items } = await storage.listAllMemory({ prefix: NOTIF_PREFIX, limit: 500 });
    let marked = 0;
    const now = new Date().toISOString();
    for (const r of items) {
      if (r.ownerGaii !== ghii) continue;
      const v = r.value as NotifValue;
      if (!v || v.read) continue;
      if (all || (idSet && idSet.has(v.id))) {
        await storage.setMemory({
          key: r.key, ownerGaii: r.ownerGaii, value: { ...v, read: true },
          visibility: r.visibility, tags: r.tags, ttlHours: r.ttlHours,
          version: r.version + 1, createdAt: r.createdAt, updatedAt: now,
        });
        marked++;
      }
    }
    res.json(success(config.nodeId, { marked }));
  });

  return router;
}
