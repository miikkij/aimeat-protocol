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
  data?: Record<string, unknown>;
}

export interface PushService {
  readonly enabled: boolean;
  subscribe(ownerName: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<PushSubscriptionRecord>;
  unsubscribe(ownerName: string): Promise<boolean>;
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

    async unsubscribe(ownerName) {
      return storage.deletePushSubscription(ownerName);
    },

    async sendNotification(ownerName, payload) {
      if (!webpush) return false;
      const sub = await storage.getPushSubscription(ownerName);
      if (!sub) return false;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          { TTL: 86400 },
        );
        await storage.createPushSubscription({ ...sub, lastUsedAt: new Date().toISOString() });
        getStats()?.incrementTyped('push_sent', 'general');
        return true;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await storage.deletePushSubscription(ownerName);
          logger.info('Push subscription expired, removed', { ownerName });
          getStats()?.increment('push_expired_subs');
        } else {
          logger.warn('Push notification failed', { ownerName, error: String(err) });
        }
        getStats()?.incrementTyped('push_failed', 'general');
        return false;
      }
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
