/**
 * @file notification-sweeps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two timed passes over notifications, both best-effort and both reading the owner's
 *   settings record. The morning pass: when an owner's quiet hours have just ended, the pushes that
 *   were held during them go out as ONE push ("N notifications arrived during your quiet hours"), and the held
 *   marks are cleared. The digest pass: an owner who asked for it gets one email listing what has
 *   stayed unread for longer than they chose, sent to the verified address on their account, each
 *   notification in exactly one digest (the bookmark is the last run's cutoff). Neither pass ever
 *   creates a notification; neither runs when the owner has not asked.
 * @structure sweepHeldPushes · sweepNotificationDigests · digestSectionOf · digestText ·
 *   listOwnerNotificationRecords and listOwnerNotifications (the shared owner-exact reads) ·
 *   readNotificationInbox and findOwnerNotificationsByIds (the bell's page and the by-id lookup)
 * @usage setInterval(() => sweepHeldPushes(storage, config, push), 5 * 60_000)
 * @version-history
 *   v1.6.0 -- 2026-11-10 -- The morning push is said in the recipient's language (digestText with the
 *     account's locale), a single held notice names its sender, and the summary title reads
 *     "N notifications arrived during your quiet hours". It went out in English, stored words.
 *   v1.5.1 -- 2026-11-08 -- The digest bookmark (lastDigestAt) is the run's cutoff, not its send time, so a
 *     notification that arrived in the hours before a digest goes in the next one; until now it was never
 *     mailed. sweepNotificationDigests takes the clock as an optional third argument, for tests.
 *   2026-11-04 — The running mail service is read from nodeContext() (services/node-context.ts) in place of
 *     getActiveEmailService (codebase analysis 2026-11-03, item D-i).
 *   2026-11-04 — No plain setMemory for a storage without setMemoryIfVersion: it is required on
 *     Storage (codebase analysis 2026-11-03, item D-e).
 *   v1.5.0 -- 2026-11-04 -- readNotificationInbox: the bell's page and its unread and total counts, read in
 *     SQL; findOwnerNotificationsByIds: the notifications of named ids, narrowed by the key's end (codebase
 *     analysis 2026-11-03, item C7).
 *   v1.4.2 -- 2026-11-04 -- The digest goes through mail-gate.ts sendMail as an owner mail (codebase analysis 2026-11-03, item B3).
 *   v1.4.1 -- 2026-11-04 -- The digest's address comes from provenOwnerAddress (owner-mail-address.ts), the one
 *     answer to "is this owner's address proven", which also checks the stored address hash (codebase
 *     analysis 2026-11-03, item A9).
 *   v1.4.0 -- 2026-11-04 -- Both passes claim before they send: the held marks are cleared on their version and
 *     only the cleared ones are pushed; the digest bookmark moves before the email, on the value read, and goes
 *     back when the email fails. Two processes no longer send twice (codebase analysis 2026-11-03, HA stage 1).
 *   v1.3.0 — 2026-10-18 — The digest puts messages first, then what the owner's apps sent, then the
 *     rest (digestSectionOf), and the 20 lines it has room for are taken in that order, so a message
 *     is never the one left out. Each line is said in the recipient's email language when the
 *     notification carries its words as a locale key (digestText); until now only the frame around
 *     the lines was translated and every line stayed in the English it was stored in.
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
import { pushLocaleOf, type PushService } from './push.js';
import { NOTIF_PREFIX, notifLinkToUrl, pushSenderName } from './notify.js';
import { NOTIF_SETTINGS_KEY, normalizeSettings, quietJustEnded, updateNotificationSettings, appendMailLog, groupOfType, sourceOf, type NotificationSettings } from './notification-settings.js';
import { nodeContext } from './node-context.js';
import { provenOwnerAddress } from './owner-mail-address.js';
import { sendMail } from './mail-gate.js';
import { notificationDigestEmail, DIGEST_SECTIONS, type DigestSection } from './email-templates-digest.js';
import { formatForPerson, type DisplayPrefs } from './display-prefs.js';
import { createT, toLocale } from '../i18n.js';
import { logger } from '../utils/logger.js';
import { localAccountName } from '../utils/gaii.js';
import type { NotifText } from './notify.js';

export interface StoredNotif { id: string; type: string; title: string; body: string; link: string; read: boolean; held?: boolean; createdAt: string; source?: unknown; i18n?: NotifText }

/**
 * Which section of the digest a notification is printed in. A direct message or a message request is
 * a message whoever sent it; an app's own notification, or the node's notice about an app, is the
 * apps section; everything else (agents, workflows, organisms, the account) is the rest.
 */
export function digestSectionOf(n: Pick<StoredNotif, 'type' | 'title' | 'source'>): DigestSection {
  const group = groupOfType(n.type);
  if (group === 'messages') return 'messages';
  if (group === 'apps' || sourceOf(n).kind === 'app') return 'apps';
  return 'other';
}

/**
 * A notification's title and body in `locale`, read from the same `notiftext.<key>.title|body`
 * strings the bell uses (public/js/services/notifications.js titleOf, bodyOf), with the same
 * single-brace variables. A notification without a key, or a key with no text, keeps the words it
 * was stored with.
 */
export function digestText(n: Pick<StoredNotif, 'title' | 'body' | 'i18n'>, locale: string | undefined): { title: string; body: string } {
  const key = n.i18n?.key;
  if (!key) return { title: n.title, body: n.body };
  const t = createT(toLocale((locale ?? '').slice(0, 2).toLowerCase()));
  const vars = n.i18n?.vars ?? {};
  const say = (part: 'title' | 'body', fallback: string): string => {
    const k = `notiftext.${key}.${part}`;
    const tpl = t(k);
    if (tpl === k) return fallback;
    return tpl.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
  };
  return { title: say('title', n.title), body: say('body', n.body) };
}

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

/**
 * One page of an owner's notifications, newest first, with the owner's unread and total counts: what
 * listOwnerNotificationRecords answered after a sort and a slice, read with the order, the filter and
 * the window in SQL (storage listInboxRows, countInboxRows). The bell asks on every agent task,
 * message and workspace event, so it reads the page it shows and two numbers, never 90 days of
 * values (codebase analysis 2026-11-03, item C7).
 */
export async function readNotificationInbox(
  storage: Storage, ghii: string, opts: { limit: number; unreadOnly?: boolean },
): Promise<{ rows: MemoryRecord[]; unread: number; total: number }> {
  const [rows, counts] = await Promise.all([
    storage.listInboxRows(ghii, NOTIF_PREFIX, { limit: opts.limit, unreadOnly: opts.unreadOnly }),
    storage.countInboxRows(ghii, NOTIF_PREFIX),
  ]);
  return { rows, unread: counts.unread, total: counts.total };
}

/**
 * The owner's notifications whose id is one of `ids`, newest first, as listOwnerNotificationRecords
 * filtered to those ids would answer. notify() writes a notification under `notif.<ISO>.<first eight
 * characters of its id>` and nothing else writes the prefix (utils/reserved-keys.ts
 * SERVER_WRITTEN_KEY_PREFIXES), so the key's end narrows the read in SQL and the id itself decides.
 */
export async function findOwnerNotificationsByIds(storage: Storage, ghii: string, ids: Iterable<unknown>): Promise<MemoryRecord[]> {
  const wanted = new Set([...ids].filter((v): v is string => typeof v === 'string' && v.length > 0));
  if (!wanted.size) return [];
  const suffixes = [...new Set([...wanted].map(id => id.slice(0, 8)))];
  const rows = await storage.listInboxRows(ghii, NOTIF_PREFIX, { keySuffixes: suffixes });
  return rows.filter(r => wanted.has((r.value as StoredNotif).id));
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
      const marked = (await listOwnerNotifications(storage, ghii)).filter(n => n.value.held);
      if (!marked.length) continue;
      // CLAIM FIRST, THEN SEND. Each held mark is cleared on the version that was read, and only the
      // notifications whose mark THIS run cleared are pushed: a second process running the same
      // sweep (both start their timers at boot) finds the marks gone or loses the write, and sends
      // nothing. The marks were cleared after the push before, so two processes pushed twice. A
      // failed push leaves the marks cleared, as it did.
      const now = new Date().toISOString();
      const held: typeof marked = [];
      for (const n of marked) {
        const record = {
          key: n.key, ownerGaii: ghii, value: { ...n.value, held: false }, visibility: 'private' as const, tags: ['notif'],
          ttlHours: 24 * 90, version: n.version + 1, createdAt: n.createdAt, updatedAt: now,
        };
        const won = await storage.setMemoryIfVersion(record, n.version);
        if (won) held.push(n);
      }
      if (!held.length) continue;
      // Said in the recipient's language, as the bell says it, and naming who a single one is from.
      const first = held[0].value;
      const locale = await pushLocaleOf(storage, localAccountName(ghii));
      const one = digestText(first, locale);
      const ok = await push.sendNotification(localAccountName(ghii), held.length === 1 ? {
        title: one.title,
        body: one.body,
        url: notifLinkToUrl(first.link),
        tag: 'notif:quiet-summary',
        from: pushSenderName(sourceOf(first)),
      } : {
        title: `${held.length} notifications arrived during your quiet hours`,
        body: held.slice(0, 5).map(n => digestText(n.value, locale).title).join('\n'),
        url: '/v1/profile?tab=notifications',
        tag: 'notif:quiet-summary',
        i18n: { title: { key: 'push_quiet_summary.title', vars: { count: held.length } } },
      });
      if (ok) pushed++;
    } catch (err) { logger.warn('notification sweep: held pushes are best-effort', { ghii, error: String(err) }); }
  }
  return { owners, pushed };
}

/**
 * The digest email. Hourly: an owner with the digest on and a verified address gets one email for
 * the unread notifications older than their chosen number of hours that have not been mailed yet.
 *
 * THE BOOKMARK IS THE CUTOFF, NOT THE SEND TIME. A run mails what arrived after the bookmark and at
 * or before its cutoff (now minus the owner's hours), then moves the bookmark to that cutoff. So the
 * windows of consecutive runs meet end to end: every notification that stays unread for the hours
 * lands in exactly one digest, and none in two. Until 2026-11-08 the bookmark was the send time, so a
 * notification that arrived in the hours before a digest was too young for it and older than the
 * bookmark for every later run, and it was never mailed. `nowMs` is the clock, for tests.
 */
export async function sweepNotificationDigests(storage: Storage, config: AimeatConfig, nowMs: number = Date.now()): Promise<{ owners: number; sent: number }> {
  const email = nodeContext().email;
  if (!email?.enabled) return { owners: 0, sent: 0 };
  let owners = 0, sent = 0;
  const now = nowMs;
  for (const { ghii, settings } of await ownersWithSettings(storage)) {
    if (!settings.emailDigest.enabled) continue;
    owners++;
    try {
      const g = await storage.getGHII(ghii);
      const to = provenOwnerAddress(g);
      if (!g || !to) continue;
      const cutoff = now - settings.emailDigest.afterHours * 3_600_000;
      const since = settings.lastDigestAt ? new Date(settings.lastDigestAt).getTime() : 0;
      const due = (await listOwnerNotifications(storage, ghii))
        .map(n => n.value)
        .filter(n => !n.read && new Date(n.createdAt).getTime() <= cutoff && new Date(n.createdAt).getTime() > since);
      if (!due.length) continue;
      // The recipient's own format and clock. `g` is the whole record, so this costs no second
      // read; the digest went out with no time at all until 2026-09-12 for want of these two lines.
      const prefs: DisplayPrefs = { locale: g.locale ?? null, region: g.region ?? null, timezone: g.timezone ?? null };
      // Messages first, then apps, then the rest; newest first inside each, as `due` already is.
      // The cut to 20 comes after this order, so what is left out is never a message.
      const rank = (sec: DigestSection) => DIGEST_SECTIONS.indexOf(sec);
      const ordered = due
        .map(n => ({ n, section: digestSectionOf(n) }))
        .sort((a, b) => rank(a.section) - rank(b.section));
      const { subject, html, text } = notificationDigestEmail({
        count: due.length,
        items: ordered.slice(0, 20).map(({ n, section }) => ({
          ...digestText(n, prefs.locale ?? undefined), at: n.createdAt, section,
          atLabel: formatForPerson(prefs, n.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
        })),
        pageUrl: `${config.baseUrl}/v1/profile?tab=notifications`,
      }, prefs.locale ?? undefined);
      // CLAIM FIRST, THEN SEND. The bookmark moves before the email goes out, and only when it still
      // says what this run read: of two processes running the sweep at once (both start their
      // timers at boot), one moves it and sends, the other finds it moved and sends nothing. It was
      // moved after the send before, so both sent. Only the bookmark is written, on top of the
      // record as it is NOW, so a save the owner made meanwhile stays (docs/pitfalls.md §84).
      // The new bookmark is this run's cutoff: what is younger than it waits for the next run. `due`
      // is not empty, so the cutoff is past the old bookmark and the bookmark only moves forward.
      const lastDigestAt = new Date(cutoff).toISOString();
      const readAt = settings.lastDigestAt ?? null;
      let claimed = false;
      await updateNotificationSettings(storage, ghii, current => {
        claimed = (current.lastDigestAt ?? null) === readAt;
        return claimed ? { ...current, lastDigestAt } : current;
      });
      if (!claimed) continue;
      const ok = await sendMail(email, { kind: 'owner', account: g }, { form: 'html', subject, html, text }) === 'sent';
      if (ok) {
        sent++;
        await appendMailLog(storage, ghii, { kind: 'digest', subject });
      } else {
        // Not sent: the batch goes back, so the next run mails it, unless a later run moved it on.
        await updateNotificationSettings(storage, ghii, current =>
          current.lastDigestAt === lastDigestAt ? { ...current, lastDigestAt: readAt } : current);
      }
    } catch (err) { logger.warn('notification sweep: digest is best-effort', { ghii, error: String(err) }); }
  }
  return { owners, sent };
}
