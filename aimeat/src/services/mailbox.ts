/**
 * @file src/services/mailbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Store-and-forward mailbox service for offline personal nodes: enqueues items under a
 *   per-node capacity/retention quota, flushes them on reconnect, expires stale items, and emits
 *   stats/Prometheus metrics for enqueue/flush/quota-rejection events.
 *
 * @structure
 *   - MailboxService: constructed with config + storage
 *   - enqueue(): capacity-checked insert with retention-based expiry + metrics
 *   - flush() / cleanExpired() / hasCapacity() / getStats(): drain, GC, quota, and usage reporting
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MailboxItemRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { getStats } from './stats.js';
import { getPromMetrics } from './prometheus.js';

export class MailboxService {
  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {}

  async enqueue(
    personalNodeId: string,
    item: Omit<MailboxItemRecord, 'id' | 'createdAt' | 'expiresAt'>,
  ): Promise<MailboxItemRecord | null> {
    // Check capacity
    const hasRoom = await this.hasCapacity(personalNodeId, item.sizeBytes);
    if (!hasRoom) {
      const stats = getStats();
      if (stats) stats.incrementMailbox('quota_rejections_total');
      const prom = getPromMetrics();
      if (prom) prom.mailboxQuotaRejectionsTotal.inc();
      logger.warn('Mailbox quota exceeded', { personalNodeId, sizeBytes: item.sizeBytes });
      return null;
    }

    const now = new Date();
    const retentionMs = item.retentionDays * 24 * 3600_000;
    const record: MailboxItemRecord = {
      ...item,
      id: uuidv4(),
      expiresAt: new Date(now.getTime() + retentionMs).toISOString(),
      createdAt: now.toISOString(),
    };

    const created = await this.storage.createMailboxItem(record);
    const stats = getStats();
    if (stats) stats.incrementMailbox('enqueued_total');
    const prom = getPromMetrics();
    if (prom) prom.mailboxEnqueuedTotal.inc({ type: item.type });
    logger.info('Mailbox item queued', {
      personalNodeId,
      type: item.type,
      from: item.fromGaii,
      to: item.toGaii,
      sizeBytes: item.sizeBytes,
    });
    return created;
  }

  async flush(personalNodeId: string): Promise<MailboxItemRecord[]> {
    return this.storage.listMailboxItems(personalNodeId);
  }

  async hasCapacity(personalNodeId: string, additionalBytes: number): Promise<boolean> {
    const node = await this.storage.getPersonalNode(personalNodeId);
    if (!node) return false;
    return (node.mailboxUsedBytes + additionalBytes) <= node.mailboxQuotaBytes;
  }

  async cleanExpired(): Promise<number> {
    const removed = await this.storage.cleanExpiredMailboxItems();
    const stats = getStats();
    if (stats && removed > 0) {
      for (let i = 0; i < removed; i++) stats.incrementMailbox('expired_total');
    }
    const prom = getPromMetrics();
    if (prom && removed > 0) prom.mailboxExpiredTotal.inc(removed);
    if (removed > 0) {
      logger.info(`Mailbox cleanup: removed ${removed} expired items`);
    }
    return removed;
  }

  async getStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    return this.storage.getMailboxStats(personalNodeId);
  }
}
