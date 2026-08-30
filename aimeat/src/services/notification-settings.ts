/**
 * @file notification-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an owner decided about their own notifications, in one memory record
 *   (`notifications.settings`, under a reserved prefix a granted app cannot write): per sender, does it
 *   reach their devices as a push, or the bell only, or nowhere (muted); for the node's own
 *   notifications the same by GROUP (organisms, messages, workflows, apps, account); quiet hours
 *   with the groups that may break them; how often one sender may push; and whether unread
 *   notifications are mailed as a digest. `notify()` reads it before it writes or pushes, the
 *   Notifications page reads and writes it, the sweeps read it. Also the one place that says which
 *   SENDER a notification came from (`sourceOf`) and which group a type belongs to (`groupOfType`),
 *   including for records written before the source travelled with them.
 * @structure NOTIF_SETTINGS_KEY · types · defaultSettings · normalizeSettings · read/write ·
 *   groupOfType · senderKey · sourceOf · prefsFor · quietState · localMinutes
 * @usage const s = await readNotificationSettings(storage, ghii); const p = prefsFor(s, source, type);
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** Under the reserved `notifications.` prefix (utils/reserved-keys.ts): a granted app cannot write it. */
export const NOTIF_SETTINGS_KEY = 'notifications.settings';

export type SenderKind = 'aimeat' | 'app' | 'extension' | 'agent' | 'owner';
/** Who sent a notification. `id` is the stable handle (an app's owner/file, an extension's name,
 *  an agent's GAII); `name` is what a person reads. */
export interface NotifSource { kind: SenderKind; name: string; id?: string }
export type NotifGroup = 'organisms' | 'messages' | 'workflows' | 'apps' | 'account' | 'other';
export const NOTIF_GROUPS: NotifGroup[] = ['organisms', 'messages', 'workflows', 'apps', 'account', 'other'];

export interface SenderPrefs { push?: boolean; muted?: boolean }
export interface QuietHours { start: string; end: string; tz: string; breakthrough: NotifGroup[] }
/** The emails the node sends to the owner's own address that are theirs to switch off. The security
 *  mails (a code, a login link, a password reset) always go. `nudge` undefined means "never decided
 *  here", and the inactivity nudge then falls back to the switch it read before this record existed. */
export interface EmailPrefs { workflowEnd: boolean; nudge?: boolean }
export interface NotificationSettings {
  /** The node's own notifications, by group. */
  groups: Partial<Record<NotifGroup, SenderPrefs>>;
  /** Everyone else, by senderKey(). */
  senders: Record<string, SenderPrefs>;
  quiet: QuietHours | null;
  /** One push per sender per this many minutes; the rest are summarised. 0 = every push at once. */
  throttleMinutes: number;
  emailDigest: { enabled: boolean; afterHours: number };
  email: EmailPrefs;
  lastDigestAt: string | null;
}

export function defaultSettings(): NotificationSettings {
  return { groups: {}, senders: {}, quiet: null, throttleMinutes: 10, emailDigest: { enabled: false, afterHours: 8 }, email: { workflowEnd: true }, lastDigestAt: null };
}

/** The last emails the node sent to the owner's own address: what and when, never the content. */
export const MAIL_LOG_KEY = 'notifications.mail-log';
export type MailLogKind = 'verification' | 'password_reset' | 'username' | 'magic_link' | 'workflow_end' | 'digest' | 'nudge' | 'invitation';
export interface MailLogEntry { kind: MailLogKind; subject: string; at: string }
const MAIL_LOG_MAX = 50;

export async function readMailLog(storage: Storage, ownerGhii: string): Promise<MailLogEntry[]> {
  try {
    const rec = await storage.getMemory(ownerGhii, MAIL_LOG_KEY);
    return Array.isArray(rec?.value) ? (rec!.value as MailLogEntry[]).filter(e => e && typeof e.kind === 'string' && typeof e.at === 'string') : [];
  } catch (err) { logger.warn('notification-settings: mail log read failed', { error: String(err) }); return []; }
}

/** Best-effort: a failure to log never fails the send it describes. */
export async function appendMailLog(storage: Storage, ownerGhii: string, entry: { kind: MailLogKind; subject: string }): Promise<void> {
  try {
    const existing = await storage.getMemory(ownerGhii, MAIL_LOG_KEY);
    const list = Array.isArray(existing?.value) ? (existing!.value as MailLogEntry[]) : [];
    const now = new Date().toISOString();
    const next = [{ kind: entry.kind, subject: entry.subject.slice(0, 200), at: now }, ...list].slice(0, MAIL_LOG_MAX);
    await storage.setMemory({
      key: MAIL_LOG_KEY, ownerGaii: ownerGhii, value: next, visibility: 'private', tags: ['notifications'],
      ttlHours: null, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now,
    });
  } catch (err) { logger.warn('notification-settings: mail log append failed', { error: String(err) }); }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const prefs = (raw: unknown): SenderPrefs => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SenderPrefs = {};
  if (typeof o.push === 'boolean') out.push = o.push;
  if (typeof o.muted === 'boolean') out.muted = o.muted;
  return out;
};

/** The record as the node will act on it: unknown fields dropped, bad values replaced by defaults. */
export function normalizeSettings(raw: unknown): NotificationSettings {
  const d = defaultSettings();
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const groups: NotificationSettings['groups'] = {};
  const g = (o.groups && typeof o.groups === 'object' ? o.groups : {}) as Record<string, unknown>;
  for (const k of NOTIF_GROUPS) if (g[k] !== undefined) groups[k] = prefs(g[k]);
  const senders: NotificationSettings['senders'] = {};
  const s = (o.senders && typeof o.senders === 'object' ? o.senders : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(s).slice(0, 500)) if (/^[a-z]+:.{1,300}$/.test(k)) senders[k] = prefs(v);
  let quiet: QuietHours | null = null;
  const q = o.quiet as Record<string, unknown> | null | undefined;
  if (q && typeof q === 'object' && typeof q.start === 'string' && HHMM.test(q.start) && typeof q.end === 'string' && HHMM.test(q.end)) {
    const tz = typeof q.tz === 'string' && validTz(q.tz) ? q.tz : 'UTC';
    const breakthrough = Array.isArray(q.breakthrough) ? q.breakthrough.filter((x): x is NotifGroup => NOTIF_GROUPS.includes(x as NotifGroup)) : [];
    quiet = { start: q.start, end: q.end, tz, breakthrough };
  }
  const throttleMinutes = typeof o.throttleMinutes === 'number' && Number.isFinite(o.throttleMinutes) ? Math.min(120, Math.max(0, Math.round(o.throttleMinutes))) : d.throttleMinutes;
  const e = (o.emailDigest && typeof o.emailDigest === 'object' ? o.emailDigest : {}) as Record<string, unknown>;
  const emailDigest = {
    enabled: e.enabled === true,
    afterHours: typeof e.afterHours === 'number' && Number.isFinite(e.afterHours) ? Math.min(168, Math.max(1, Math.round(e.afterHours))) : d.emailDigest.afterHours,
  };
  const em = (o.email && typeof o.email === 'object' ? o.email : {}) as Record<string, unknown>;
  const email: EmailPrefs = { workflowEnd: em.workflowEnd !== false, ...(typeof em.nudge === 'boolean' ? { nudge: em.nudge } : {}) };
  const lastDigestAt = typeof o.lastDigestAt === 'string' ? o.lastDigestAt : null;
  return { groups, senders, quiet, throttleMinutes, emailDigest, email, lastDigestAt };
}

function validTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; }
  catch (err) { logger.warn('notification-settings: unknown timezone, using UTC', { tz, error: String(err) }); return false; }
}

export async function readNotificationSettings(storage: Storage, ownerGhii: string): Promise<NotificationSettings> {
  try {
    const rec = await storage.getMemory(ownerGhii, NOTIF_SETTINGS_KEY);
    return rec ? normalizeSettings(rec.value) : defaultSettings();
  } catch (err) {
    // A read failure must not swallow a notification: the defaults deliver everything.
    logger.warn('notification-settings: reading failed, using defaults', { error: String(err) });
    return defaultSettings();
  }
}

export async function writeNotificationSettings(storage: Storage, ownerGhii: string, settings: NotificationSettings): Promise<NotificationSettings> {
  const clean = normalizeSettings(settings);
  const existing = await storage.getMemory(ownerGhii, NOTIF_SETTINGS_KEY);
  const now = new Date().toISOString();
  await storage.setMemory({
    key: NOTIF_SETTINGS_KEY, ownerGaii: ownerGhii, value: clean, visibility: 'private', tags: ['settings'],
    ttlHours: null, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now,
  });
  return clean;
}

/** Which of the node's own groups a notification type belongs to. */
export function groupOfType(type: string): NotifGroup {
  const t = (type || '').toLowerCase();
  if (t.startsWith('workflow')) return 'workflows';
  if (t.startsWith('direct_message') || t.startsWith('message') || t.startsWith('mailbox') || t.startsWith('conversation')) return 'messages';
  if (t.startsWith('workspace') || t.startsWith('organism') || t.startsWith('invitation') || t.startsWith('membership') || t.startsWith('member_') || t.startsWith('join')) return 'organisms';
  if (t.startsWith('app_') || t === 'app' || t.startsWith('exchange') || t.startsWith('contract')) return 'apps';
  if (t.startsWith('budget') || t.startsWith('quota') || t.startsWith('ledger') || t.startsWith('compliance') || t.startsWith('disclosure') || t.startsWith('security') || t.startsWith('account') || t.startsWith('tracked')) return 'account';
  return 'other';
}

/** The settings key for a sender: `app:owner/file`, `extension:name`, `agent:gaii`. */
export const senderKey = (s: NotifSource): string => `${s.kind}:${s.id || s.name}`;

/**
 * Who sent a stored notification. A record written since 2026-08-30 carries `source`; an older one
 * is read from what the create route did to it: an app's or an agent's name was put in front of
 * the title, and its type was set to 'app' or 'agent'; an extension's type is 'extension'.
 */
export function sourceOf(value: { type?: string; title?: string; source?: unknown }): NotifSource {
  const s = value.source as Partial<NotifSource> | undefined;
  if (s && typeof s === 'object' && typeof s.kind === 'string' && typeof s.name === 'string') {
    return { kind: s.kind as SenderKind, name: s.name, ...(typeof s.id === 'string' ? { id: s.id } : {}) };
  }
  const type = value.type || '';
  const title = value.title || '';
  const prefix = /^([^:]{1,80}):\s/.exec(title)?.[1];
  if (type === 'app') return { kind: 'app', name: prefix || 'App' };
  if (type === 'agent') return { kind: 'agent', name: prefix || 'agent' };
  if (type === 'extension') return { kind: 'extension', name: title || 'extension' };
  if (type === 'custom') return { kind: 'owner', name: 'owner' };
  return { kind: 'aimeat', name: 'AIMEAT' };
}

/** What the owner decided for this sender and type: push to devices, and whether it is muted. */
export function prefsFor(settings: NotificationSettings, source: NotifSource, type: string): { push: boolean; muted: boolean } {
  const p = source.kind === 'aimeat' || source.kind === 'owner'
    ? settings.groups[groupOfType(type)]
    : settings.senders[senderKey(source)];
  return { push: p?.push !== false, muted: p?.muted === true };
}

/** Minutes since local midnight in a timezone. */
export function localMinutes(now: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch { return now.getUTCHours() * 60 + now.getUTCMinutes(); }
}
const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is it quiet now for this owner, and does this group break through. */
export function quietState(settings: NotificationSettings, type: string, now = new Date()): { quiet: boolean } {
  const q = settings.quiet;
  if (!q) return { quiet: false };
  const cur = localMinutes(now, q.tz), start = toMin(q.start), end = toMin(q.end);
  const inWindow = start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  if (!inWindow) return { quiet: false };
  return { quiet: !q.breakthrough.includes(groupOfType(type)) };
}

/** Did the quiet window end in the last `withinMinutes` (for the sweep that sends the morning summary). */
export function quietJustEnded(settings: NotificationSettings, withinMinutes: number, now = new Date()): boolean {
  const q = settings.quiet;
  if (!q) return false;
  const cur = localMinutes(now, q.tz), end = toMin(q.end);
  const diff = (cur - end + 1440) % 1440;
  return diff >= 0 && diff < withinMinutes;
}
