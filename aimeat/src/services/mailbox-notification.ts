import { createRequire } from 'node:module';
import type { AimeatConfig } from '../config.js';
import type { Storage, MailboxItemRecord, PersonalPushSubscriptionRecord, NotificationPreferences } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { resolveTemplate } from './notification-templates.js';
import { getStats } from './stats.js';

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
  private emailTransport: import('nodemailer').Transporter | null = null;
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

    // Email transport (Phase 2)
    if (config.smtpHost && config.smtpUser) {
      try {
        const nodemailer = require('nodemailer') as typeof import('nodemailer');
        this.emailTransport = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          auth: {
            user: config.smtpUser,
            pass: config.smtpPass ?? '',
          },
          tls: {
            rejectUnauthorized: config.smtpRejectUnauthorized,
          },
        });
        logger.info('MailboxNotificationService: email transport initialized');
      } catch (err) {
        logger.warn('MailboxNotificationService: failed to initialize email transport', { error: String(err) });
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
        getStats()?.incrementTyped('mailbox_notif_blocked', 'disabled');
        return { sent: false, reason: 'notifications_disabled' };
      }

      if (!prefs.notifyTypes.includes(mailboxItem.type)) {
        return { sent: false, reason: 'type_not_configured' };
      }

      const now = Date.now();
      const lastNotified = this.cooldownMap.get(personalNodeId) ?? 0;
      const cooldownMs = prefs.cooldownMinutes * 60_000;
      if (now - lastNotified < cooldownMs) {
        getStats()?.incrementTyped('mailbox_notif_blocked', 'cooldown');
        return { sent: false, reason: 'cooldown_active' };
      }

      if (this.isInQuietHours(prefs)) {
        getStats()?.incrementTyped('mailbox_notif_blocked', 'quiet_hours');
        return { sent: false, reason: 'quiet_hours' };
      }

      const stats = await this.storage.getMailboxStats(personalNodeId);
      // Only fetch oldest item for age calculation (limit 1 to avoid loading all items)
      const oldestItems = await this.storage.listMailboxItems(personalNodeId, { limit: 1 });
      const oldestAge = oldestItems.length > 0
        ? Math.round((now - new Date(oldestItems[0].createdAt).getTime()) / 60_000)
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

      const locale = prefs.locale ?? 'en';
      let sentAny = false;
      const sentChannels: string[] = [];

      if (prefs.channels.includes('web_push') && this.webpush) {
        const subscriptions = await this.storage.listPersonalPushSubscriptions(personalNodeId);
        for (const sub of subscriptions) {
          const ok = await this.sendWebPush(sub, payload, locale);
          if (ok) { sentAny = true; sentChannels.push('web_push'); getStats()?.incrementTyped('mailbox_notif_sent', 'push'); }
        }
      }

      // Email channel
      if (prefs.channels.includes('email') && prefs.email) {
        const emailSent = await this.sendEmail(personalNodeId, prefs.email, payload, locale);
        if (emailSent) { sentAny = true; sentChannels.push('email'); getStats()?.incrementTyped('mailbox_notif_sent', 'email'); }
      }

      if (sentAny) {
        this.cooldownMap.set(personalNodeId, now);
      }

      const uniqueChannels = [...new Set(sentChannels)];
      return { sent: sentAny, channel: uniqueChannels.join(',') || undefined };
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

  private async sendWebPush(sub: PersonalPushSubscriptionRecord, payload: MailboxPushPayload, locale: string): Promise<boolean> {
    if (!this.webpush) return false;
    try {
      const tpl = await resolveTemplate(this.storage, 'web_push_mailbox', locale, {
        count: payload.pending_count,
        type: payload.highest_priority_type,
      });
      await this.webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          title: tpl.title ?? 'AIMEAT: Pending messages',
          body: tpl.body,
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
      getStats()?.incrementTyped('mailbox_notif_failed', 'push');
      return false;
    }
  }

  private async sendEmail(personalNodeId: string, email: string, payload: MailboxPushPayload, locale: string): Promise<boolean> {
    if (!this.emailTransport) return false;

    // Check email-specific rate limit
    const now = Date.now();
    const lastEmail = this.emailCooldownMap.get(personalNodeId) ?? 0;
    const emailCooldownMs = this.config.emailRateLimitMin * 60_000;
    if (now - lastEmail < emailCooldownMs) {
      return false;
    }

    try {
      const tpl = await resolveTemplate(this.storage, 'email_mailbox', locale, {
        count: payload.pending_count,
        type: payload.highest_priority_type,
        nodeId: payload.node_id,
        age: payload.oldest_item_age_minutes,
      });
      await this.emailTransport.sendMail({
        from: this.config.smtpFrom,
        to: email,
        subject: tpl.subject ?? `AIMEAT: ${payload.pending_count} pending message(s) for your node`,
        text: [
          tpl.body,
          '',
          '---',
          'This notification was sent by the AIMEAT Protocol.',
          'To unsubscribe, update your notification preferences via PATCH /v1/personal/anchor/<nodeId>/notifications',
        ].join('\n'),
      });

      this.emailCooldownMap.set(personalNodeId, now);
      logger.info('Email notification sent', { personalNodeId, email: email.substring(0, 3) + '***' });
      return true;
    } catch (err) {
      logger.error('Email notification failed', { personalNodeId, error: String(err) });
      getStats()?.incrementTyped('mailbox_notif_failed', 'email');
      return false;
    }
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
