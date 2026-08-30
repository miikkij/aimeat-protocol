/**
 * @file notification-sweeps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two timed passes over notifications, both best-effort and both reading the owner's
 *   settings record. The morning pass: when an owner's quiet hours have just ended, the pushes that
 *   were held during them go out as ONE push ("N notifications while you were quiet"), and the held
 *   marks are cleared. The digest pass: an owner who asked for it gets one email listing what has
 *   stayed unread for longer than they chose, sent to the verified address on their account, at most
 *   once per new batch. Neither pass ever creates a notification; neither runs when the owner has
 *   not asked.
 * @structure sweepHeldPushes · sweepNotificationDigests · listOwnerNotifications (shared read)
 * @usage setInterval(() => sweepHeldPushes(storage, config, push), 5 * 60_000)
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PushService } from './push.js';
import { NOTIF_PREFIX, notifLinkToUrl } from './notify.js';
import { NOTIF_SETTINGS_KEY, normalizeSettings, quietJustEnded, writeNotificationSettings, appendMailLog, type NotificationSettings } from './notification-settings.js';
import { getActiveEmailService } from './email.js';
import { notificationDigestEmail } from './email-templates-digest.js';
import { logger } from '../utils/logger.js';

export interface StoredNotif { id: string; type: string; title: string; body: string; link: string; read: boolean; held?: boolean; createdAt: string }

/** Every settings record on the node, by owner: the owners who decided something. */
async function ownersWithSettings(storage: Storage): Promise<Array<{ ghii: string; settings: NotificationSettings }>> {
  const { items } = await storage.listAllMemory({ prefix: NOTIF_SETTINGS_KEY, limit: 5000 });
  return items.filter(r => r.key === NOTIF_SETTINGS_KEY).map(r => ({ ghii: r.ownerGaii, settings: normalizeSettings(r.value) }));
}

/** One owner's stored notifications with their keys and versions, newest first. */
export async function listOwnerNotifications(storage: Storage, ghii: string): Promise<Array<{ key: string; version: number; createdAt: string; value: StoredNotif }>> {
  const { items } = await storage.listAllMemory({ prefix: NOTIF_PREFIX, ownerPrefix: ghii, limit: 1000 });
  return items
    .filter(r => r.ownerGaii === ghii && r.value && typeof r.value === 'object' && (r.value as StoredNotif).id)
    .map(r => ({ key: r.key, version: r.version, createdAt: r.createdAt, value: r.value as StoredNotif }))
    .sort((a, b) => (b.value.createdAt || '').localeCompare(a.value.createdAt || ''));
}

/**
 * The morning push. Runs every few minutes; an owner whose quiet window ended within the last
 * `windowMinutes` and who holds pushes gets one, and the marks are cleared so the next run is silent.
 */
export async function sweepHeldPushes(storage: Storage, _config: AimeatConfig, push: PushService | null, windowMinutes = 6): Promise<{ owners: number; pushed: number }> {
  if (!push?.enabled) return { owners: 0, pushed: 0 };
  let owners = 0, pushed = 0;
  for (const { ghii, settings } of await ownersWithSettings(storage)) {
    if (!quietJustEnded(settings, windowMinutes)) continue;
    owners++;
    try {
      const held = (await listOwnerNotifications(storage, ghii)).filter(n => n.value.held);
      if (!held.length) continue;
      const first = held[0].value;
      const ok = await push.sendNotification(ghii.split('@')[0], {
        title: held.length === 1 ? first.title : `${held.length} notifications while you were quiet`,
        body: held.length === 1 ? first.body : held.slice(0, 5).map(n => n.value.title).join('\n'),
        url: held.length === 1 ? notifLinkToUrl(first.link) : '/v1/profile?tab=notifications',
        tag: 'notif:quiet-summary',
      });
      if (ok) pushed++;
      const now = new Date().toISOString();
      for (const n of held) {
        await storage.setMemory({
          key: n.key, ownerGaii: ghii, value: { ...n.value, held: false }, visibility: 'private', tags: ['notif'],
          ttlHours: 24 * 90, version: n.version + 1, createdAt: n.createdAt, updatedAt: now,
        });
      }
    } catch (err) { logger.warn('notification sweep: held pushes are best-effort', { ghii, error: String(err) }); }
  }
  return { owners, pushed };
}

/**
 * The digest email. Hourly: an owner with the digest on and a verified address gets one email for
 * the unread notifications older than their chosen number of hours that have not been mailed yet.
 */
export async function sweepNotificationDigests(storage: Storage, config: AimeatConfig): Promise<{ owners: number; sent: number }> {
  const email = getActiveEmailService();
  if (!email?.enabled) return { owners: 0, sent: 0 };
  let owners = 0, sent = 0;
  const now = Date.now();
  for (const { ghii, settings } of await ownersWithSettings(storage)) {
    if (!settings.emailDigest.enabled) continue;
    owners++;
    try {
      const g = await storage.getGHII(ghii);
      if (!g?.notificationEmail || !g.emailVerifiedAt) continue;
      const cutoff = now - settings.emailDigest.afterHours * 3_600_000;
      const since = settings.lastDigestAt ? new Date(settings.lastDigestAt).getTime() : 0;
      const due = (await listOwnerNotifications(storage, ghii))
        .map(n => n.value)
        .filter(n => !n.read && new Date(n.createdAt).getTime() <= cutoff && new Date(n.createdAt).getTime() > since);
      if (!due.length) continue;
      const { subject, html, text } = notificationDigestEmail({
        count: due.length,
        items: due.slice(0, 20).map(n => ({ title: n.title, body: n.body, at: n.createdAt })),
        pageUrl: `${config.baseUrl}/v1/profile?tab=notifications`,
      }, (g as { locale?: string }).locale);
      const ok = await email.sendRaw(g.notificationEmail, subject, html, text);
      if (ok) {
        sent++;
        await writeNotificationSettings(storage, ghii, { ...settings, lastDigestAt: new Date(now).toISOString() });
        await appendMailLog(storage, ghii, { kind: 'digest', subject });
      }
    } catch (err) { logger.warn('notification sweep: digest is best-effort', { ghii, error: String(err) }); }
  }
  return { owners, sent };
}
