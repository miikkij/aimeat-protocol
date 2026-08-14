/**
 * @file src/storage/repositories/notification-template.repository.ts
 * @description Storage-interface contract for localized notification templates: fetch by id+locale,
 *   upsert, list, and bulk-clear — implemented per backend (SQLite/Prisma).
 *
 * @structure
 *   - NotificationTemplateRepository: interface implemented per backend
 *   - getNotificationTemplate(id, locale) / upsertNotificationTemplate: locale-scoped read + write
 *   - listNotificationTemplates / deleteAllNotificationTemplates: enumeration + reset
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { NotificationTemplateRecord } from '../interface.js';

export interface NotificationTemplateRepository {
  getNotificationTemplate(id: string, locale: string): Promise<NotificationTemplateRecord | null>;
  upsertNotificationTemplate(record: NotificationTemplateRecord): Promise<NotificationTemplateRecord>;
  listNotificationTemplates(): Promise<NotificationTemplateRecord[]>;
  deleteAllNotificationTemplates(): Promise<void>;
}
