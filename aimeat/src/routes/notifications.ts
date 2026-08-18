/**
 * @file notifications.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In-app notification inbox API. A notification is a small memory record under the
 *   recipient's owner GHII (created server-side by events via services/notify.ts). These routes let
 *   the recipient list their notifications + unread count (for the header bell), mark them read,
 *   and let apps/agents post a notification to their OWN owner (bell + web push, deep-linked).
 *   Owner-scoped: a caller only ever sees their own owner's notifications.
 * @structure
 *   - GET    /v1/notifications      — list (newest first) + unread count
 *   - POST   /v1/notifications      — create a notification for the caller's own owner
 *   - POST   /v1/notifications/read — mark notifications read ({ ids } or { all: true })
 *   - DELETE /v1/notifications      — clear notifications (all, or a given { ids }) — the bell's "Clear all"
 * @usage app.use(notificationsRouter(config, storage));
 * @version-history
 *   Notification body limit 1 000 → 10 000 — 2026-07-30 — matched in openapi.yaml.
 *   v1.3.0 -- 2026-07-19 -- DELETE /v1/notifications: "Clear all" from the header bell removes the owner's
 *     notif rows (owner-scoped list → bulkDeleteMemory, per-key fallback); optional { ids } to clear a subset.
 *   v1.0.0 -- 2026-06-08 -- Initial: memory-backed notification inbox.
 *   v1.1.0 -- 2026-07-02 -- POST /v1/notifications: apps/agents notify their own owner
 *     (scope notifications:send); app notifications deep-link back to the app by default.
 *   v1.2.0 -- 2026-07-18 -- Notifications carry inline actions[] (server-set only); the public
 *     create route rejects a client-supplied actions field to keep reply/api actions trusted.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { NOTIF_PREFIX, notify, type NotifAction } from '../services/notify.js';
import { emitChange } from '../services/event-bus.js';

interface NotifValue { id: string; type: string; title: string; body: string; link: string; actions?: NotifAction[]; read: boolean; createdAt: string }

export function notificationsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;

  /* ── GET /v1/notifications — the caller's inbox (newest first) + unread count ──
   * SCOPE BY OWNER, not globally. The old query — `listAllMemory({prefix, limit:500})` —
   * fetched 500 rows across ALL owners. On the Kysely (prod) backend that orders by key
   * ASC (notification keys are `notif.<ISO>.<id>`, so ASC = oldest-first), so once the
   * node held >500 notifications total, the window was entirely OLD rows and every recent
   * notification for every owner fell outside it — the bell silently froze. `ownerPrefix`
   * restricts the query to THIS owner's rows (bounded by the 90-day TTL); the generous
   * `limit` then returns effectively all of them regardless of each backend's ordering
   * (Kysely key-ASC / SQLite updatedAt-DESC), and the JS sort-desc + slice(0,50) below
   * yields the newest 50 with an accurate unread count. */
  router.get('/v1/notifications', requireAuth(), async (req, res) => {
    const ghii = ownerGhii(req);
    const { items } = await storage.listAllMemory({ prefix: NOTIF_PREFIX, ownerPrefix: ghii, limit: 1000 });
    const mine = items
      .filter(r => r.ownerGaii === ghii)
      .map(r => r.value as NotifValue)
      .filter(v => v && typeof v === 'object' && v.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const unread = mine.filter(n => !n.read).length;
    res.json(success(config.nodeId, { notifications: mine.slice(0, 50), unread }));
  });

  /* ── POST /v1/notifications — notify the CALLER's OWN owner (bell + web push) ──
   * Self-targeted only: the recipient is always req.auth.owner — no surface for pushing at
   * arbitrary owners. Owner sessions pass requireScope's owner bypass; agents need the
   * 'notifications:send' scope granted at device-auth; apps need it in their app grant.
   * App notifications get the app's name prefixed (provenance — an app cannot impersonate the
   * node) and default their deep link to the app itself, so clicking the push reopens the app. */
  router.post('/v1/notifications', requireAuth(), requireScope('notifications:send'), async (req, res) => {
    try {
      const auth = req.auth!;
      const { title, body, link, type } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof title !== 'string' || !title.trim() || title.length > 200) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'title is required (string, max 200 chars)'));
        return;
      }
      if (body !== undefined && (typeof body !== 'string' || body.length > 10_000)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'body must be a string (max 10000 chars)'));
        return;
      }
      // Same-node paths only ('/...', not '//host' or absolute URLs) — a notification never
      // deep-links off the node.
      if (link !== undefined && (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//') || link.length > 500)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'link must be a same-node path starting with "/"'));
        return;
      }
      if (type !== undefined && (typeof type !== 'string' || !/^[a-z0-9_:.-]{1,64}$/i.test(type))) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'type must match [a-z0-9_:.-]{1,64}'));
        return;
      }
      // SECURITY: inline reply/api actions execute with the RECIPIENT's authority when clicked, so
      // they may only originate from trusted server-side emit code — never a principal (app/agent/
      // owner) posting here. Reject any client-supplied actions outright; a caller wanting an
      // extra button uses `link` (navigation carries no authority).
      if ((req.body as Record<string, unknown>)?.actions !== undefined) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'actions are set by the node, not by the notification creator; use link for navigation'));
        return;
      }

      let finalTitle = title.trim();
      let finalLink = link as string | undefined;
      let finalType = type as string | undefined;
      if (auth.roles.includes('app')) {
        const grant = auth.app_grant ? await storage.getAppGrant(auth.app_grant) : null;
        if (!finalLink && grant?.app) {
          const [appOwner, filename] = grant.app.split('/');
          finalLink = `/v1/apps/${encodeURIComponent(appOwner)}/${encodeURIComponent(filename)}?mode=inline`;
        }
        finalTitle = `${grant?.appName || 'App'}: ${finalTitle}`;
        finalType = finalType ?? 'app';
      } else if (auth.roles.includes('agent') && !auth.roles.includes('owner')) {
        const agentName = auth.sub.includes('#') ? auth.sub.split('#')[0] : auth.sub;
        finalTitle = `${agentName}: ${finalTitle}`;
        finalLink = finalLink ?? '/v1/profile?tab=agents';
        finalType = finalType ?? 'agent';
      } else {
        finalType = finalType ?? 'custom';
      }

      const ghii = ownerGhii(req);
      await notify(storage, ghii, { type: finalType, title: finalTitle, body: body as string | undefined, link: finalLink });
      emitChange('notifications', ghii);
      res.status(201).json(success(config.nodeId, { created: true, link: finalLink ?? null }, [
        { description: 'List your notifications', method: 'GET', url: '/v1/notifications' },
      ]));
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', String(err)));
    }
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

  /* ── DELETE /v1/notifications — clear the caller's notifications (all, or a given { ids: [...] }) ──
   * "Clear all" from the header bell: notifications are per-owner memory rows under NOTIF_PREFIX, so we
   * list THIS owner's notif rows (owner-scoped, never NOT deleteMemoryByPrefix which spans all owners)
   * and remove them — batched via bulkDeleteMemory when the backend offers it, else a per-key fallback. */
  router.delete('/v1/notifications', requireAuth(), async (req, res) => {
    const ghii = ownerGhii(req);
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids) : null;
    const mine = await storage.listMemory(ghii, { prefix: NOTIF_PREFIX });
    const refs = mine
      .filter(r => { const v = r.value as NotifValue; return v && v.id && (!ids || ids.has(v.id)); })
      .map(r => ({ ownerGaii: ghii, key: r.key }));
    let cleared = 0;
    if (refs.length) {
      if (storage.bulkDeleteMemory) {
        cleared = await storage.bulkDeleteMemory(refs);
      } else {
        for (const ref of refs) { if (await storage.deleteMemory(ref.ownerGaii, ref.key)) cleared++; }
      }
      emitChange('notifications', ghii);
    }
    res.json(success(config.nodeId, { cleared }));
  });

  return router;
}
