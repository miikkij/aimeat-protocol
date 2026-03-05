import type { PersonalPushSubscriptionRecord, NotificationPreferences } from '../interface.js';

export interface NotificationRepository {
  createPersonalPushSubscription(record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord>;
  getPersonalPushSubscription(id: string): Promise<PersonalPushSubscriptionRecord | null>;
  listPersonalPushSubscriptions(personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]>;
  updatePersonalPushSubscription(id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean>;
  deletePersonalPushSubscription(id: string): Promise<boolean>;
  deletePersonalPushSubscriptionsByNode(personalNodeId: string): Promise<number>;
  countPersonalPushSubscriptions(personalNodeId: string): Promise<number>;
  getNotificationPreferences(personalNodeId: string): Promise<NotificationPreferences | null>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  deleteNotificationPreferences(personalNodeId: string): Promise<boolean>;
}
