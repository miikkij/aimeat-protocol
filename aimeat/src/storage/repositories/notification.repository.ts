/**
 * @file src/storage/repositories/notification.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage interface segment for personal-node push notifications — the contract every
 *   backend implements to store Web Push subscriptions (CRUD, per-node listing/counting) and each
 *   personal node's notification preferences.
 *
 * @structure
 *   - NotificationRepository: interface for push-subscription CRUD + per-node queries
 *   - preference methods: get/upsert/delete a node's NotificationPreferences
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
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
