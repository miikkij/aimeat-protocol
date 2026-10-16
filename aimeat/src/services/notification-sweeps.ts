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
 * @structure sweepHeldPushes · sweepNotificationDigests · listOwnerNotificationRecords and
 *   listOwnerNotifications (the shared owner-exact reads)
 * @usage setInterval(() => sweepHeldPushes(storage, config, push), 5 * 60_000)
 * @version-history
 *   2026-10-16 — The owner's notifications are read with listMemory on the owner's own identity, every row,
 *     newest first; the 1000-row window in key order hid an owner's newest rows past 1000. The settings
 *     scan reads every owner's record instead of the first 5000 (QA audit F13-01).
 *   v1.2.1 — 2026-09-26 — The held-push sweep takes the owner's account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.2.0 — 2026-09-13 — The digest writes only its bookmark, on the record as it is when writing
 *     (updateNotificationSettings). It wrote back the whole record it read before sending the email,
 *     which undid a save the owner made while the email went out (docs/pitfalls.md §84).
 *   v1.1.0 — 2026-09-12 — The digest says WHEN each notification arrived, in the recipient's own
 *     regional format and their own clock, read from the record this sweep already holds.
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import type { AimeatConfig } from '../config.js';
import type { MemoryRecord, Storage } from '../storage/interface.js';
import type { PushService } from './push.js';
import { NOTIF_PREFIX, notifLinkToUrl } from './notify.js';
import { NOTIF_SETTINGS_KEY, normalizeSettings, quietJustEnded, updateNotificationSettings, appendMailLog, type NotificationSettings } from './notification-settings.js';
import { getActiveEmailService } from './email.js';
import { notificationDigestEmail } from './email-templates-digest.js';
import { formatForPerson, type DisplayPrefs } from './display-prefs.js';
import { logger } from '../utils/logger.js';
import { localAccountName } from '../utils/gaii.js';

export interface StoredNotif { id: string; type: string; title: string; body: string; link: string; read: boolean; held?: boolean; createdAt: string }

/** Every settings record on the node, by owner: the owners who decided something. */
async function ownersWithSettings(storage: Storage): Promise<Array<{ ghii: string; settings: NotificationSettings }>> {
  // Every owner who decided something, with no window: one record per owner, and a window in key
  // order would have left out the owners past it (QA audit F13-01).
  const { items } = await storage.listAllMemory({ prefix: NOTIF_SETTINGS_KEY });
  return items.filter(r => r.key === NOTIF_SETTINGS_KEY).map(r => ({ ghii: r.ownerGaii, settings: normalizeSettings(r.value) }));
}

/**
 * Every stored notification of ONE owner, as whole memory records, newest first. Read on the owner's
 * own identity with no window. A notification lives 90 days (services/notify.ts) and the TTL sweep
 * removes it after that, so the set is bounded by what one owner received in 90 days.
 *
 * NO CROSS-OWNER WINDOW. The mark-read route listed the oldest 500 notification rows of the whole
 * node and filtered to the caller, so on a node holding more than 500 it marked nothing and answered
 * 200 with marked: 0; the list read took the owner's first 1000 rows in KEY order, which is oldest
 * first, so an owner past 1000 never saw the newest (QA audit F13-01, the same defect the GET route
 * had until 2026-07-18).
 */
export async function listOwnerNotificationRecords(storage: Storage, ghii: string): Promise<MemoryRecord[]> {
  const rows = await storage.listMemory(ghii, { prefix: NOTIF_PREFIX });
  return rows
    .filter(r => r.value && typeof r.value === 'object' && (r.value as StoredNotif).id)
    .sort((a, b) => ((b.value as StoredNotif).createdAt || '').localeCompare((a.value as StoredNotif).createdAt || ''));
}

/** One owner's stored notifications with their keys and versions, newest first. */
export async function listOwnerNotifications(storage: Storage, ghii: string): Promise<Array<{ key: string; version: number; createdAt: string; value: StoredNotif }>> {
  return (await listOwnerNotificationRecords(storage, ghii))
    .map(r => ({ key: r.key, version: r.version, createdAt: r.createdAt, value: r.value as StoredNotif }));
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
      const ok = await push.sendNotification(localAccountName(ghii), {
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
      // The recipient's own format and clock. `g` is the whole record, so this costs no second
      // read; the digest went out with no time at all until 2026-09-12 for want of these two lines.
      const prefs: DisplayPrefs = { locale: g.locale ?? null, region: g.region ?? null, timezone: g.timezone ?? null };
      const { subject, html, text } = notificationDigestEmail({
        count: due.length,
        items: due.slice(0, 20).map(n => ({
          title: n.title, body: n.body, at: n.createdAt,
          atLabel: formatForPerson(prefs, n.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
        })),
        pageUrl: `${config.baseUrl}/v1/profile?tab=notifications`,
      }, prefs.locale ?? undefined);
      const ok = await email.sendRaw(g.notificationEmail, subject, html, text);
      if (ok) {
        sent++;
        // Only the bookmark, on top of the record as it is NOW. `settings` was read before the email
        // went out, and writing it back would undo whatever the owner saved in the meantime.
        const lastDigestAt = new Date(now).toISOString();
        await updateNotificationSettings(storage, ghii, current => ({ ...current, lastDigestAt }));
        await appendMailLog(storage, ghii, { kind: 'digest', subject });
      }
    } catch (err) { logger.warn('notification sweep: digest is best-effort', { ghii, error: String(err) }); }
  }
  return { owners, sent };
}
