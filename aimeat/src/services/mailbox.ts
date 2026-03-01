import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MailboxItemRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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
    if (removed > 0) {
      logger.info(`Mailbox cleanup: removed ${removed} expired items`);
    }
    return removed;
  }

  async getStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    return this.storage.getMailboxStats(personalNodeId);
  }
}
