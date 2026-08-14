/**
 * @file push.ts
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
import { getStats } from './stats.js';

const require = createRequire(import.meta.url);

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  /** OS-level notification action buttons ({ action, title }); the SW renders + routes these. */
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, unknown>;
}

export interface PushService {
  readonly enabled: boolean;
  /** Register one device. A second device joins the first rather than replacing it (audit H-8). */
  subscribe(ownerName: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<PushSubscriptionRecord>;
  /** With `endpoint`, drop that one device; without it, every device this owner has. */
  unsubscribe(ownerName: string, endpoint?: string): Promise<boolean>;
  /** Deliver to every device the owner has registered. True when at least one accepted it. */
  sendNotification(ownerName: string, payload: PushPayload): Promise<boolean>;
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

    async subscribe(ownerName, subscription) {
      const record: PushSubscriptionRecord = {
        ownerName,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      return storage.createPushSubscription(record);
    },

    async unsubscribe(ownerName, endpoint) {
      return storage.deletePushSubscription(ownerName, endpoint);
    },

    async sendNotification(ownerName, payload) {
      if (!webpush) return false;
      // FAN OUT. A person has more than one browser, and each is its own row since 2026-08-11.
      // Delivery is per device: one endpoint failing says nothing about the others, so a dead one is
      // pruned on its own and the rest still receive. Sequential on purpose — this is a handful of
      // rows per person, and the push services rate-limit a burst from one sender anyway.
      const subs = await storage.listPushSubscriptionsByOwner(ownerName);
      if (!subs.length) return false;
      let delivered = 0;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify(payload),
            { TTL: 86400 },
          );
          await storage.createPushSubscription({ ...sub, lastUsedAt: new Date().toISOString() });
          getStats()?.incrementTyped('push_sent', 'general');
          delivered++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // The push service says this registration is gone. Remove THAT endpoint; deleting by
            // owner here would take the person's working devices down with the dead one.
            await storage.deletePushSubscription(ownerName, sub.endpoint);
            logger.info('Push subscription expired, removed', { ownerName, endpoint: sub.endpoint });
            getStats()?.increment('push_expired_subs');
          } else {
            logger.warn('Push notification failed', { ownerName, endpoint: sub.endpoint, error: String(err) });
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
        const ownerName = ghii.split('@')[0];
        const ok = await this.sendNotification(ownerName, payload);
        if (ok) sent++;
      }
      return sent;
    },
  };
}
