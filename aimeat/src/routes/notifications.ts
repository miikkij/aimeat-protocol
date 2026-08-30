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
 *   - GET    /v1/notifications          — list (newest first, ?limit= up to 200, ?unread=1) + unread and total; each row carries source and group
 *   - GET    /v1/notifications/settings — what the owner decided (notification-settings.ts)
 *   - PUT    /v1/notifications/settings — the whole record, owner only
 *   - GET    /v1/notifications/senders  — who may notify this owner, with counts and the owner's decision per sender
 *   - POST   /v1/notifications          — create a notification for the caller's own owner (notification-create.ts)
 *   - POST   /v1/notifications/read     — mark notifications read ({ ids } or { all: true })
 *   - DELETE /v1/notifications          — clear notifications (all, or a given { ids }) — the bell's "Clear all"
 * @usage app.use(notificationsRouter(config, storage));
 * @version-history
 *   v1.4.0 -- 2026-08-30 -- The Notifications page in the poster face: rows carry their source and
 *     group (derived for older rows), the list takes ?limit and ?unread, the owner's settings have
 *     their own GET/PUT, and /senders says who may notify the owner. POST is the shared service call.
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
import { requireAuth, requireScope, requireRole } from '../auth/middleware.js';
import { NOTIF_PREFIX, type NotifAction } from '../services/notify.js';
import { emitChange } from '../services/event-bus.js';
import { createPrincipalNotification, NotificationCreateError } from '../services/notification-create.js';
import {
  readNotificationSettings, writeNotificationSettings, normalizeSettings, sourceOf, groupOfType, senderKey, prefsFor, readMailLog,
  NOTIF_GROUPS, type NotifSource,
} from '../services/notification-settings.js';
import { listOwnerNotifications } from '../services/notification-sweeps.js';

interface NotifValue { id: string; type: string; title: string; body: string; link: string; actions?: NotifAction[]; read: boolean; createdAt: string; source?: NotifSource; i18n?: unknown; held?: boolean }

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
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      // Who sent it and which group it belongs to travel with every row, derived for the rows
      // written before the source did, so the page and the bell never have to guess.
      .map(v => ({ ...v, source: sourceOf(v), group: groupOfType(v.type) }));
    const unread = mine.filter(n => !n.read).length;
    const onlyUnread = req.query.unread === '1' || req.query.unread === 'true';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const list = (onlyUnread ? mine.filter(n => !n.read) : mine).slice(0, limit);
    res.json(success(config.nodeId, { notifications: list, unread, total: mine.length }));
  });

  /* ── GET /v1/notifications/settings — what the owner decided (defaults when nothing was written) ── */
  router.get('/v1/notifications/settings', requireAuth(), requireRole('owner'), async (req, res) => {
    res.json(success(config.nodeId, { settings: await readNotificationSettings(storage, ownerGhii(req)), groups: NOTIF_GROUPS }));
  });

  /* ── PUT /v1/notifications/settings — the whole record; unknown fields dropped, bad values defaulted.
   * Owner only: the key is under a reserved prefix (utils/reserved-keys.ts), so a granted app cannot write it
   * through the memory door either, which is what keeps "mute" the owner's decision alone. ── */
  router.put('/v1/notifications/settings', requireAuth(), requireRole('owner'), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const incoming = normalizeSettings(body.settings ?? body);
    const current = await readNotificationSettings(storage, ownerGhii(req));
    // The digest bookkeeping is the node's, not the client's: keep what the sweep wrote.
    const saved = await writeNotificationSettings(storage, ownerGhii(req), { ...incoming, lastDigestAt: current.lastDigestAt });
    emitChange('notifications', ownerGhii(req));
    res.json(success(config.nodeId, { settings: saved }));
  });

  /* ── GET /v1/notifications/mail — the last emails the node sent to the owner's own address: what
   * kind and when, never the content. Written by the sites that address the owner (a code, a login
   * link, a reset, the workflow email, the digest, the nudge). ── */
  router.get('/v1/notifications/mail', requireAuth(), requireRole('owner'), async (req, res) => {
    const entries = await readMailLog(storage, ownerGhii(req));
    res.json(success(config.nodeId, { entries, total: entries.length }));
  });

  /* ── GET /v1/notifications/senders — who may notify this owner, with what each did in 30 days:
   * the node's own groups, the apps whose grant carries notifications:send, the owner's agents
   * with the scope, and the extensions that have notified. Each with the owner's decision. ── */
  router.get('/v1/notifications/senders', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = ownerGhii(req);
    const owner = req.auth!.owner as string;
    const settings = await readNotificationSettings(storage, ghii);
    const since = Date.now() - 30 * 864e5;
    const rows = (await listOwnerNotifications(storage, ghii)).map(n => n.value);
    const stat = new Map<string, { count: number; last_at: string | null }>();
    const groupStat = new Map<string, { count: number; last_at: string | null }>();
    for (const n of rows) {
      const src = sourceOf(n);
      const recent = new Date(n.createdAt).getTime() >= since;
      const bump = (m: Map<string, { count: number; last_at: string | null }>, k: string) => {
        const s = m.get(k) ?? { count: 0, last_at: null };
        if (recent) s.count++;
        if (!s.last_at || n.createdAt > s.last_at) s.last_at = n.createdAt;
        m.set(k, s);
      };
      if (src.kind === 'aimeat' || src.kind === 'owner') bump(groupStat, groupOfType(n.type)); else bump(stat, senderKey(src));
    }
    const groups = NOTIF_GROUPS.map(g => ({ group: g, ...(groupStat.get(g) ?? { count: 0, last_at: null }), prefs: prefsFor(settings, { kind: 'aimeat', name: 'AIMEAT' }, g === 'organisms' ? 'workspace' : g === 'messages' ? 'direct_message' : g === 'workflows' ? 'workflow' : g === 'apps' ? 'app_member' : g === 'account' ? 'budget' : 'other') }));
    const senders: Array<Record<string, unknown>> = [];
    const add = (src: NotifSource, extra: Record<string, unknown>) => {
      const key = senderKey(src);
      senders.push({ kind: src.kind, id: src.id ?? src.name, name: src.name, key, ...(stat.get(key) ?? { count: 0, last_at: null }), prefs: prefsFor(settings, src, ''), ...extra });
    };
    for (const g of await storage.listAppGrantsByOwner(owner)) {
      if (g.revoked || !(g.scopes ?? []).includes('notifications:send')) continue;
      add({ kind: 'app', name: g.appName, id: g.app }, { grant_id: g.grantId, granted_at: g.createdAt });
    }
    for (const a of await storage.listAgents()) {
      if (a.owner !== owner || !(a.defaultScopes ?? []).includes('notifications:send')) continue;
      add({ kind: 'agent', name: a.displayName || a.name, id: a.gaii }, { last_seen: a.lastSeen ?? null });
    }
    const seen = new Set(senders.map(s => s.key as string));
    for (const n of rows) {
      const src = sourceOf(n);
      if (src.kind !== 'extension' && src.kind !== 'app' && src.kind !== 'agent') continue;
      const key = senderKey(src);
      if (seen.has(key)) continue;
      seen.add(key);
      add(src, { granted_at: null });
    }
    res.json(success(config.nodeId, { groups, senders, settings }));
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
      const r = await createPrincipalNotification(storage, config, { owner: auth.owner as string, sub: auth.sub, roles: auth.roles, app_grant: auth.app_grant ?? null }, (req.body ?? {}) as Record<string, unknown>);
      res.status(201).json(success(config.nodeId, r, [
        { description: 'List your notifications', method: 'GET', url: '/v1/notifications' },
      ]));
    } catch (err) {
      if (err instanceof NotificationCreateError) { res.status(err.status).json(error(config.nodeId, err.code, err.message)); return; }
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
