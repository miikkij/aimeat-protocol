import type { NotificationTemplateRecord } from '../interface.js';

export interface NotificationTemplateRepository {
  getNotificationTemplate(id: string, locale: string): Promise<NotificationTemplateRecord | null>;
  upsertNotificationTemplate(record: NotificationTemplateRecord): Promise<NotificationTemplateRecord>;
  listNotificationTemplates(): Promise<NotificationTemplateRecord[]>;
  deleteAllNotificationTemplates(): Promise<void>;
}
