/**
 * @file push.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Web push notification service -- manages VAPID-based push subscriptions
 *   and sends notifications to individual users or broadcasts to organism members.
 * @structure
 *   - PushPayload interface (notification content shape)
 *   - PushService interface (subscribe, unsubscribe, send, broadcast)
 *   - createPushService() factory (configures web-push with VAPID keys)
 * @usage
 *   import { createPushService } from '../services/push.js';
 *   const push = createPushService(config, storage);
 *   await push.sendNotification(ownerName, { title: '...', body: '...' });
 * @version-history
 *   v1.3.0 -- 2026-11-10 -- A push is written in the recipient's language and names its sender.
 *     `i18n` carries `notiftext.` keys that sendNotification resolves with the owner's locale
 *     (the bell already did this, the push carried the English fallback), and `from` puts the
 *     sender's name before a title that does not already say it. Both are taken off before the
 *     payload is sent. Chrome on Android hides a push behind a spam warning when its on-device
 *     model reads the title, body and button text as deceptive; a member reported several AIMEAT
 *     pushes landing there.
 *   v1.2.1 -- 2026-09-26 -- broadcastToOrganism takes each member's account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.2.0 -- 2026-08-11 -- One subscription per DEVICE (audit H-8): sendNotification fans out over
 *     every device the owner registered and prunes only the endpoint that reported itself gone;
 *     unsubscribe takes an optional endpoint.
 *   v1.0.0 -- 2026-04-15 -- Initial push notification service
 *   v1.1.0 -- 2026-05-21 -- Add stats counter instrumentation (push_sent, push_failed, push_expired_subs)
 */

import { createRequire } from 'node:module';
import type { AimeatConfig } from '../config.js';
import type { Storage, PushSubscriptionRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { localAccountName } from '../utils/gaii.js';
import { createT, toLocale, type Locale } from '../i18n.js';
import { getStats } from './stats.js';
import { displayPrefsFor } from './display-prefs.js';

const require = createRequire(import.meta.url);

/** Words in the reader's language: a locale key under `notiftext.` (full path) and its {var} values. */
export interface PushText { key: string; vars?: Record<string, string | number> }

export interface PushPayload {
  /** The English fallback, sent as is when `i18n.title` is absent or no language has its key. */
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  /** OS-level notification action buttons ({ action, title }); the SW renders + routes these. */
  actions?: Array<{ action: string; title: string; i18n?: PushText }>;
  data?: Record<string, unknown>;
  /** The title and body in the recipient's language, resolved in sendNotification. */
  i18n?: { title?: PushText; body?: PushText };
  /**
   * The sender's name when someone other than the node sent it (an app, an agent, an extension, an
   * outside app). It goes before the title unless the title already names the sender, so the lock
   * screen never shows words with no one behind them.
   */
  from?: string;
}

/** The text a `notiftext.` key gives in this language with its {var} filled; null when no language has the key. */
export function pushTextIn(locale: Locale, text: PushText): string | null {
  const full = `notiftext.${text.key}`;
  const said = createT(locale)(full);
  if (said === full) return null;
  // The bell's {var} form (public/js/services/notifications.js), not the server's {{var}}.
  return said.replace(/\{(\w+)\}/g, (m, name: string) => (text.vars && name in text.vars ? String(text.vars[name]) : m));
}

/** The language a person reads their notifications in: the one on their account, else English. */
export async function pushLocaleOf(storage: Storage, ownerName: string): Promise<Locale> {
  return toLocale((await displayPrefsFor(storage, ownerName)).locale ?? undefined);
}

/** The sender's name before the title, unless the title already says who it is from. */
export function titleWithSender(title: string, from: string | undefined): string {
  const name = from?.trim();
  if (!name || title.toLowerCase().includes(name.toLowerCase())) return title;
  return `${name}: ${title}`;
}

/** What goes on the wire: the words resolved for this owner, and the fields only the node reads taken off. */
async function wirePayload(storage: Storage, ownerName: string, payload: PushPayload): Promise<Omit<PushPayload, 'i18n' | 'from'>> {
  const { i18n, from, actions, ...rest } = payload;
  const wantsWords = !!(i18n?.title || i18n?.body || actions?.some(a => a.i18n));
  const locale = wantsWords ? await pushLocaleOf(storage, ownerName) : 'en';
  const said = (t: PushText | undefined): string | null => (t ? pushTextIn(locale, t) : null);
  return {
    ...rest,
    title: titleWithSender(said(i18n?.title) ?? payload.title, from),
    body: said(i18n?.body) ?? payload.body,
    ...(actions ? { actions: actions.map(a => ({ action: a.action, title: said(a.i18n) ?? a.title })) } : {}),
  };
}

export interface PushService {
  readonly enabled: boolean;
  /**
   * Register one device. A second device joins the first rather than replacing it (audit H-8).
   *
   * `appId` names the app whose OWN ORIGIN this subscription came from, and is omitted for the
   * node's own pages. It is the caller's to resolve from the session, never from a request body.
   */
  subscribe(
    ownerName: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    appId?: string | null,
  ): Promise<PushSubscriptionRecord>;
  /** With `endpoint`, drop that one device; without it, every device this owner has. */
  unsubscribe(ownerName: string, endpoint?: string): Promise<boolean>;
  /**
   * Deliver to every device the owner has registered. True when at least one accepted it.
   *
   * `fromApp` names the app the notification is FROM. When that app has devices of its own, they are
   * the only ones that receive: a person who installed the app and allowed notifications there wants
   * it to arrive as that app, and sending to both would notify them twice for one event. When it has
   * none, the node's own devices receive instead, so an app's notification is never lost for want of
   * being installed.
   */
  sendNotification(ownerName: string, payload: PushPayload, fromApp?: string | null): Promise<boolean>;
  broadcastToOrganism(organismId: string, payload: PushPayload): Promise<number>;
}

export function createPushService(config: AimeatConfig, storage: Storage): PushService {
  const enabled = config.pushEnabled && !!config.vapidPublicKey && !!config.vapidPrivateKey;

  let webpush: typeof import('web-push') | null = null;
  if (enabled) {
    try {
      webpush = require('web-push') as typeof import('web-push');
      webpush.setVapidDetails(
        config.vapidSubject,
        config.vapidPublicKey!,
        config.vapidPrivateKey!,
      );
      logger.info('Push notification service initialized');
    } catch (err) {
      logger.warn('Failed to initialize web-push', { error: String(err) });
    }
  }

  return {
    get enabled() { return enabled && webpush !== null; },

    async subscribe(ownerName, subscription, appId) {
      const record: PushSubscriptionRecord = {
        ownerName,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        createdAt: new Date().toISOString(),
        // Registering is not receiving. A device that has just subscribed has accepted nothing yet,
        // and saying so is the whole point of the column (migration 0074).
        lastUsedAt: null,
        appId: appId ?? null,
      };
      return storage.createPushSubscription(record);
    },

    async unsubscribe(ownerName, endpoint) {
      return storage.deletePushSubscription(ownerName, endpoint);
    },

    async sendNotification(ownerName, payload, fromApp) {
      if (!webpush) return false;
      // FAN OUT. A person has more than one browser, and each is its own row since 2026-08-11.
      // Delivery is per device: one endpoint failing says nothing about the others, so a dead one is
      // pruned on its own and the rest still receive. Sequential on purpose — this is a handful of
      // rows per person, and the push services rate-limit a burst from one sender anyway.
      const all = await storage.listPushSubscriptionsByOwner(ownerName);
      // THE APP'S OWN DEVICES WIN, AND THEY WIN ALONE. An installed app is its own origin, so a
      // notification arriving there wears the app's name and icon rather than this node's, which on
      // iOS is the only way it ever does. Sending to the node's devices as well would notify the
      // person twice for one event. An app with no devices of its own falls back to them, so
      // choosing not to install anything loses nothing.
      const own = fromApp ? all.filter(s => s.appId === fromApp) : [];
      const subs = own.length > 0 ? own : all.filter(s => !s.appId);
      if (!subs.length) return false;
      const wire = JSON.stringify(await wirePayload(storage, ownerName, payload));
      let delivered = 0;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            wire,
            { TTL: 86400 },
          );
          // COUNT THE DELIVERY BEFORE WRITING IT DOWN. The notification has arrived; stamping when
          // this device last accepted one is bookkeeping. With the write above this line, a storage
          // hiccup threw into the catch below and a delivered notification was counted as failed and
          // logged as one, which is the same lie in the other direction from the one being fixed
          // here. Best-effort, and it says so when it does not happen.
          getStats()?.incrementTyped('push_sent', 'general');
          delivered++;
          await storage.markPushSubscriptionDelivered(ownerName, sub.endpoint, new Date().toISOString())
            .catch(err => logger.warn('Push delivered, but its timestamp was not written', {
              ownerName, endpoint: sub.endpoint, error: String(err),
            }));
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // The push service says this registration is gone. Remove THAT endpoint; deleting by
            // owner here would take the person's working devices down with the dead one.
            await storage.deletePushSubscription(ownerName, sub.endpoint);
            logger.info('Push subscription expired, removed', { ownerName, endpoint: sub.endpoint });
            getStats()?.increment('push_expired_subs');
          } else {
            // THE ANSWER IS ALREADY IN HAND, so it goes on the line. `String(err)` renders a
            // WebPushError as "Received unexpected response code" and drops both the status and the
            // service's own words, so a 403 with {"reason":"BadJwtToken"} reached nobody. A peer
            // operator spent an hour on a malformed AIMEAT_VAPID_SUBJECT (a space after "mailto:",
            // which Apple refuses and FCM does not) and could only see it by re-running the send by
            // hand, reading the fields the node had held all along. Reported 2026-09-15.
            const body = (err as { body?: unknown }).body;
            logger.warn('Push notification failed', {
              ownerName, endpoint: sub.endpoint, statusCode,
              // The push service's own refusal, capped: it is a short JSON reason in every service
              // we speak to, and an unbounded body from a remote host does not belong in a log line.
              body: typeof body === 'string' ? body.slice(0, 500) : undefined,
              error: String(err),
            });
          }
          getStats()?.incrementTyped('push_failed', 'general');
        }
      }
      return delivered > 0;
    },

    async broadcastToOrganism(organismId, payload) {
      const organism = await storage.getOrganism(organismId);
      if (!organism) return 0;
      let sent = 0;
      for (const ghii of organism.members) {
        const ownerName = localAccountName(ghii);
        const ok = await this.sendNotification(ownerName, payload);
        if (ok) sent++;
      }
      return sent;
    },
  };
}
