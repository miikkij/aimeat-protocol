import { createRequire } from 'node:module';
import type { AimeatConfig } from '../config.js';
import type { Storage, MailboxItemRecord, PersonalPushSubscriptionRecord, NotificationPreferences } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

export interface MailboxPushPayload {
  type: 'mailbox_alert';
  node_id: string;
  pending_count: number;
  highest_priority_type: string;
  oldest_item_age_minutes: number;
  operator_node: string;
  timestamp: string;
}

export interface NotifyResult {
  sent: boolean;
  channel?: string;
  reason?: string;
}

/** Allowed push service domains (SSRF prevention) */
const ALLOWED_PUSH_DOMAINS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
  'web.push.apple.com',
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ALLOWED_PUSH_DOMAINS.some(domain =>
      url.hostname === domain || url.hostname.endsWith('.' + domain),
    );
  } catch {
    return false;
  }
}

/** Default notification preferences for a new node */
function defaultPreferences(personalNodeId: string, config: AimeatConfig): NotificationPreferences {
  return {
    personalNodeId,
    enabled: true,
    channels: ['web_push'],
    notifyTypes: [...config.pushNotifyTypes],
    cooldownMinutes: config.pushCooldownMin,
    quietHoursUtc: null,
    email: null,
  };
}

export class MailboxNotificationService {
  private webpush: typeof import('web-push') | null = null;
  private cooldownMap = new Map<string, number>();
  private emailCooldownMap = new Map<string, number>();

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {
    if (config.pushEnabled && config.vapidPublicKey && config.vapidPrivateKey) {
      try {
        this.webpush = require('web-push') as typeof import('web-push');
        this.webpush.setVapidDetails(
          config.vapidSubject,
          config.vapidPublicKey,
          config.vapidPrivateKey,
        );
        logger.info('MailboxNotificationService: web-push initialized');
      } catch (err) {
        logger.warn('MailboxNotificationService: failed to initialize web-push', { error: String(err) });
      }
    }
  }

  /**
   * Notify the owner of a personal node that a message has been queued.
   * Fire-and-forget — callers should `void` this.
   */
  async notify(personalNodeId: string, mailboxItem: MailboxItemRecord): Promise<NotifyResult> {
    try {
      const prefs = (await this.storage.getNotificationPreferences(personalNodeId))
        ?? defaultPreferences(personalNodeId, this.config);

      if (!prefs.enabled) {
        return { sent: false, reason: 'notifications_disabled' };
      }

      if (!prefs.notifyTypes.includes(mailboxItem.type)) {
        return { sent: false, reason: 'type_not_configured' };
      }

      const now = Date.now();
      const lastNotified = this.cooldownMap.get(personalNodeId) ?? 0;
      const cooldownMs = prefs.cooldownMinutes * 60_000;
      if (now - lastNotified < cooldownMs) {
        return { sent: false, reason: 'cooldown_active' };
      }

      if (this.isInQuietHours(prefs)) {
        return { sent: false, reason: 'quiet_hours' };
      }

      const stats = await this.storage.getMailboxStats(personalNodeId);
      const items = await this.storage.listMailboxItems(personalNodeId);
      const oldestAge = items.length > 0
        ? Math.round((now - new Date(items[0].createdAt).getTime()) / 60_000)
        : 0;

      const payload: MailboxPushPayload = {
        type: 'mailbox_alert',
        node_id: personalNodeId,
        pending_count: stats.count,
        highest_priority_type: mailboxItem.type,
        oldest_item_age_minutes: oldestAge,
        operator_node: this.config.nodeId,
        timestamp: new Date().toISOString(),
      };

      let sentAny = false;

      if (prefs.channels.includes('web_push') && this.webpush) {
        const subscriptions = await this.storage.listPersonalPushSubscriptions(personalNodeId);
        for (const sub of subscriptions) {
          const ok = await this.sendWebPush(sub, payload);
          if (ok) sentAny = true;
        }
      }

      // Email channel stub (Phase 2)
      if (prefs.channels.includes('email') && prefs.email) {
        const emailSent = await this.sendEmail(personalNodeId, prefs.email, payload);
        if (emailSent) sentAny = true;
      }

      if (sentAny) {
        this.cooldownMap.set(personalNodeId, now);
      }

      return { sent: sentAny, channel: sentAny ? 'web_push' : undefined };
    } catch (err) {
      logger.error('MailboxNotificationService.notify failed', { personalNodeId, error: String(err) });
      return { sent: false, reason: 'internal_error' };
    }
  }

  /** Clear cooldown when a node reconnects */
  clearCooldown(personalNodeId: string): void {
    this.cooldownMap.delete(personalNodeId);
    this.emailCooldownMap.delete(personalNodeId);
  }

  private async sendWebPush(sub: PersonalPushSubscriptionRecord, payload: MailboxPushPayload): Promise<boolean> {
    if (!this.webpush) return false;
    try {
      await this.webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          title: 'AIMEAT: Pending messages',
          body: `${payload.pending_count} message(s) waiting — ${payload.highest_priority_type}`,
          icon: '/icons/icon-192.png',
          tag: 'mailbox-alert',
          data: payload,
        }),
        { TTL: 3600 },
      );
      await this.storage.updatePersonalPushSubscription(sub.id, {
        lastUsedAt: new Date().toISOString(),
        failureCount: 0,
      });
      logger.info('Web push notification sent', { nodeId: sub.personalNodeId, subId: sub.id });
      return true;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await this.storage.deletePersonalPushSubscription(sub.id);
        logger.info('Push subscription expired, removed', { subId: sub.id, nodeId: sub.personalNodeId });
      } else {
        const newCount = sub.failureCount + 1;
        if (newCount >= this.config.pushMaxFailures) {
          await this.storage.deletePersonalPushSubscription(sub.id);
          logger.warn('Push subscription removed after max failures', { subId: sub.id, failures: newCount });
        } else {
          await this.storage.updatePersonalPushSubscription(sub.id, { failureCount: newCount });
          logger.warn('Push notification failed', { subId: sub.id, failureCount: newCount, error: String(err) });
        }
      }
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendEmail(_personalNodeId: string, _email: string, _payload: MailboxPushPayload): Promise<boolean> {
    // Phase 2 implementation
    return false;
  }

  private isInQuietHours(prefs: NotificationPreferences): boolean {
    if (!prefs.quietHoursUtc) return false;
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    const [startH, startM] = prefs.quietHoursUtc.start.split(':').map(Number);
    const [endH, endM] = prefs.quietHoursUtc.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }
}
