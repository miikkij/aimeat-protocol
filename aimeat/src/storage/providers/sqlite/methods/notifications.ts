/**
 * @file src/storage/providers/sqlite/methods/notifications.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/notifications.ts
 *   (notificationMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim from
 *   the files named in the version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure notificationMethods
 * @usage Object.assign(SqliteStorage.prototype, notificationMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 17 methods (createPersonalPushSubscription, getPersonalPushSubscription,
 *     listPersonalPushSubscriptions, …) moved here from extensions-notify.ts so the file mirrors
 *     postgres-kysely/methods/notifications.ts (secaudit 2026-10, M8).
 */
import type {
  PersonalPushSubscriptionRecord, NotificationPreferences, NotificationTemplateRecord,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const notificationMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Personal Push Subscriptions (REQ-007) ──
  // ══════════════════════════════════════════════════════════

  async createPersonalPushSubscription(this: SqliteStorage, record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord> {
    this.db.prepare(
      `INSERT INTO personal_push_subscriptions (id, personalNodeId, ownerName, endpoint, keys, failureCount, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.personalNodeId,
      record.ownerName,
      record.endpoint,
      JSON.stringify(record.keys),
      record.failureCount,
      record.createdAt,
      record.lastUsedAt,
    );
    return record;
  },

  async getPersonalPushSubscription(this: SqliteStorage, id: string): Promise<PersonalPushSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_push_subscriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.deserializePersonalPushSubscription(row) : null;
  },

  async listPersonalPushSubscriptions(this: SqliteStorage, personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM personal_push_subscriptions WHERE personalNodeId = ?').all(personalNodeId) as Record<string, unknown>[];
    return rows.map(r => this.deserializePersonalPushSubscription(r));
  },

  async updatePersonalPushSubscription(this: SqliteStorage, id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean> {
    const existing = await this.getPersonalPushSubscription(id);
    if (!existing) return false;
    const merged = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE personal_push_subscriptions
       SET personalNodeId = ?, ownerName = ?, endpoint = ?, keys = ?, failureCount = ?, createdAt = ?, lastUsedAt = ?
       WHERE id = ?`
    ).run(
      merged.personalNodeId,
      merged.ownerName,
      merged.endpoint,
      JSON.stringify(merged.keys),
      merged.failureCount,
      merged.createdAt,
      merged.lastUsedAt,
      id,
    );
    return true;
  },

  async deletePersonalPushSubscription(this: SqliteStorage, id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM personal_push_subscriptions WHERE id = ?').run(id);
    return result.changes > 0;
  },

  async deletePersonalPushSubscriptionsByNode(this: SqliteStorage, personalNodeId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(personalNodeId);
    return result.changes;
  },

  async countPersonalPushSubscriptions(this: SqliteStorage, personalNodeId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM personal_push_subscriptions WHERE personalNodeId = ?').get(personalNodeId) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  },

  deserializePersonalPushSubscription(this: SqliteStorage, row: Record<string, unknown>): PersonalPushSubscriptionRecord {
    return {
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      ownerName: row.ownerName as string,
      endpoint: row.endpoint as string,
      keys: JSON.parse(row.keys as string),
      failureCount: row.failureCount as number,
      createdAt: row.createdAt as string,
      lastUsedAt: (row.lastUsedAt as string) ?? null,
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Notification Preferences (REQ-007) ──
  // ══════════════════════════════════════════════════════════

  async getNotificationPreferences(this: SqliteStorage, personalNodeId: string): Promise<NotificationPreferences | null> {
    const row = this.db.prepare('SELECT * FROM notification_preferences WHERE personalNodeId = ?').get(personalNodeId) as Record<string, unknown> | undefined;
    return row ? this.deserializeNotificationPreferences(row) : null;
  },

  async upsertNotificationPreferences(this: SqliteStorage, prefs: NotificationPreferences): Promise<NotificationPreferences> {
    this.db.prepare(
      `INSERT INTO notification_preferences (personalNodeId, enabled, channels, notifyTypes, cooldownMinutes, quietHoursUtc, email, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(personalNodeId) DO UPDATE SET
         enabled = excluded.enabled,
         channels = excluded.channels,
         notifyTypes = excluded.notifyTypes,
         cooldownMinutes = excluded.cooldownMinutes,
         quietHoursUtc = excluded.quietHoursUtc,
         email = excluded.email,
         locale = excluded.locale`
    ).run(
      prefs.personalNodeId,
      prefs.enabled ? 1 : 0,
      JSON.stringify(prefs.channels),
      JSON.stringify(prefs.notifyTypes),
      prefs.cooldownMinutes,
      prefs.quietHoursUtc ? JSON.stringify(prefs.quietHoursUtc) : null,
      prefs.email,
      prefs.locale ?? null,
    );
    // READ IT BACK, rather than handing the caller their own object again. Returning the input is
    // what made `locale` look saved for as long as it was: the column did not exist, the field was
    // not in the INSERT, and every caller was told the write took. What comes back now is what the
    // database holds, so the NEXT field somebody forgets to store shows up on the first read.
    return this.deserializeNotificationPreferences(
      this.db.prepare('SELECT * FROM notification_preferences WHERE personalNodeId = ?').get(prefs.personalNodeId) as Record<string, unknown>,
    );
  },

  async deleteNotificationPreferences(this: SqliteStorage, personalNodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(personalNodeId);
    return result.changes > 0;
  },

  deserializeNotificationPreferences(this: SqliteStorage, row: Record<string, unknown>): NotificationPreferences {
    return {
      personalNodeId: row.personalNodeId as string,
      enabled: (row.enabled as number) === 1,
      channels: JSON.parse(row.channels as string),
      notifyTypes: JSON.parse(row.notifyTypes as string),
      cooldownMinutes: row.cooldownMinutes as number,
      quietHoursUtc: row.quietHoursUtc ? JSON.parse(row.quietHoursUtc as string) : null,
      email: (row.email as string) ?? null,
      ...(row.locale ? { locale: row.locale as string } : {}),
    };
  },

  // ══════════════════════════════════════════════════════════
  // ── Notification Templates (Phase 3.2) ──
  // ══════════════════════════════════════════════════════════

  async getNotificationTemplate(this: SqliteStorage, id: string, locale: string): Promise<NotificationTemplateRecord | null> {
    const row = this.db.prepare('SELECT * FROM notification_templates WHERE id = ? AND locale = ?').get(id, locale) as Record<string, unknown> | undefined;
    return row ? this.deserializeNotificationTemplate(row) : null;
  },

  async upsertNotificationTemplate(this: SqliteStorage, record: NotificationTemplateRecord): Promise<NotificationTemplateRecord> {
    this.db.prepare(`
      INSERT INTO notification_templates (id, locale, fields, placeholders, updatedAt, updatedBy)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, locale) DO UPDATE SET fields = excluded.fields, placeholders = excluded.placeholders, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy
    `).run(record.id, record.locale, JSON.stringify(record.fields), JSON.stringify(record.placeholders), record.updatedAt, record.updatedBy);
    return record;
  },

  async listNotificationTemplates(this: SqliteStorage): Promise<NotificationTemplateRecord[]> {
    const rows = this.db.prepare('SELECT * FROM notification_templates ORDER BY id, locale').all() as Record<string, unknown>[];
    return rows.map(r => this.deserializeNotificationTemplate(r));
  },

  async deleteAllNotificationTemplates(this: SqliteStorage): Promise<void> {
    this.db.prepare('DELETE FROM notification_templates').run();
  },

  deserializeNotificationTemplate(this: SqliteStorage, row: Record<string, unknown>): NotificationTemplateRecord {
    return {
      id: row.id as string,
      locale: row.locale as string,
      fields: JSON.parse(row.fields as string),
      placeholders: JSON.parse(row.placeholders as string),
      updatedAt: row.updatedAt as string,
      updatedBy: row.updatedBy as string,
    };
  },
};
