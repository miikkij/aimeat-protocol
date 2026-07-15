/**
 * @file src/storage/providers/postgres-kysely/methods/notifications.ts
 * @description Notification domain for the Postgres+Kysely backend: personal-node push subscriptions
 *   (PersonalPushSubscription), per-node notification preferences (NotificationPreference), and the
 *   operator notification templates (NotificationTemplate, keyed by (templateId, locale)). The plain
 *   PushSubscription table lives in the node domain. Translated to match the Prisma provider.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: notifications on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { NotificationPreferences, NotificationTemplateRecord, PersonalPushSubscriptionRecord } from '../../../interface.js';
import type { NotificationPreference, NotificationTemplate, PersonalPushSubscription } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoN = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));

function toPush(r: Selectable<PersonalPushSubscription>): PersonalPushSubscriptionRecord {
  return {
    id: r.id, personalNodeId: r.personalNodeId, ownerName: r.ownerName, endpoint: r.endpoint,
    keys: r.keys as unknown as PersonalPushSubscriptionRecord['keys'], failureCount: r.failureCount,
    createdAt: iso(r.createdAt), lastUsedAt: isoN(r.lastUsedAt),
  };
}
function toPrefs(r: Selectable<NotificationPreference>): NotificationPreferences {
  return {
    personalNodeId: r.personalNodeId, enabled: r.enabled, channels: (r.channels ?? []) as NotificationPreferences['channels'],
    notifyTypes: r.notifyTypes ?? [], cooldownMinutes: r.cooldownMinutes,
    quietHoursUtc: (r.quietHoursUtc ?? null) as NotificationPreferences['quietHoursUtc'], email: r.email ?? null,
    locale: r.locale ?? undefined,
  };
}
function toTemplate(r: Selectable<NotificationTemplate>): NotificationTemplateRecord {
  return {
    id: r.templateId, locale: r.locale, fields: r.fields as unknown as NotificationTemplateRecord['fields'],
    placeholders: r.placeholders ?? [], updatedAt: iso(r.updatedAt), updatedBy: r.updatedBy,
  };
}

export const notificationMethods = {
  // ── Personal-node push subscriptions ──
  async createPersonalPushSubscription(this: PostgresKyselyStorage, r: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord> {
    const [row] = await this.db.insertInto('PersonalPushSubscription').values({
      id: r.id, personalNodeId: r.personalNodeId, ownerName: r.ownerName, endpoint: r.endpoint, keys: jsonb(r.keys),
      failureCount: r.failureCount, createdAt: new Date(r.createdAt), lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toPush(row);
  },
  async getPersonalPushSubscription(this: PostgresKyselyStorage, id: string): Promise<PersonalPushSubscriptionRecord | null> {
    const r = await this.db.selectFrom('PersonalPushSubscription').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toPush(r) : null;
  },
  async listPersonalPushSubscriptions(this: PostgresKyselyStorage, personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]> {
    return (await this.db.selectFrom('PersonalPushSubscription').selectAll().where('personalNodeId', '=', personalNodeId).execute()).map(toPush);
  },
  async updatePersonalPushSubscription(this: PostgresKyselyStorage, id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean> {
    const data: Record<string, unknown> = {};
    if (updates.failureCount !== undefined) data.failureCount = updates.failureCount;
    if (updates.lastUsedAt !== undefined) data.lastUsedAt = updates.lastUsedAt ? new Date(updates.lastUsedAt) : null;
    if (updates.endpoint !== undefined) data.endpoint = updates.endpoint;
    if (updates.keys !== undefined) data.keys = jsonb(updates.keys);
    if (Object.keys(data).length === 0) return true;
    const r = await this.db.updateTable('PersonalPushSubscription').set(data as never).where('id', '=', id).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },
  async deletePersonalPushSubscription(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('PersonalPushSubscription').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
  async deletePersonalPushSubscriptionsByNode(this: PostgresKyselyStorage, personalNodeId: string): Promise<number> {
    const r = await this.db.deleteFrom('PersonalPushSubscription').where('personalNodeId', '=', personalNodeId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async countPersonalPushSubscriptions(this: PostgresKyselyStorage, personalNodeId: string): Promise<number> {
    const r = await this.db.selectFrom('PersonalPushSubscription').select(eb => eb.fn.countAll<number>().as('n')).where('personalNodeId', '=', personalNodeId).executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  // ── Notification preferences (upsert by personalNodeId) ──
  async getNotificationPreferences(this: PostgresKyselyStorage, personalNodeId: string): Promise<NotificationPreferences | null> {
    const r = await this.db.selectFrom('NotificationPreference').selectAll().where('personalNodeId', '=', personalNodeId).executeTakeFirst();
    return r ? toPrefs(r) : null;
  },
  async upsertNotificationPreferences(this: PostgresKyselyStorage, p: NotificationPreferences): Promise<NotificationPreferences> {
    const shared = { enabled: p.enabled, channels: p.channels, notifyTypes: p.notifyTypes, cooldownMinutes: p.cooldownMinutes, quietHoursUtc: jsonb(p.quietHoursUtc ?? null), email: p.email ?? null, locale: p.locale ?? null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('NotificationPreference').values({ personalNodeId: p.personalNodeId, ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.column('personalNodeId').doUpdateSet(shared as any)).execute();
    return p;
  },
  async deleteNotificationPreferences(this: PostgresKyselyStorage, personalNodeId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('NotificationPreference').where('personalNodeId', '=', personalNodeId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  // ── Notification templates (upsert by (templateId, locale)) ──
  async getNotificationTemplate(this: PostgresKyselyStorage, id: string, locale: string): Promise<NotificationTemplateRecord | null> {
    const r = await this.db.selectFrom('NotificationTemplate').selectAll().where('templateId', '=', id).where('locale', '=', locale).executeTakeFirst();
    return r ? toTemplate(r) : null;
  },
  async upsertNotificationTemplate(this: PostgresKyselyStorage, r: NotificationTemplateRecord): Promise<NotificationTemplateRecord> {
    const shared = { fields: jsonb(r.fields), placeholders: r.placeholders, updatedAt: new Date(r.updatedAt), updatedBy: r.updatedBy };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('NotificationTemplate').values({ templateId: r.id, locale: r.locale, ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.columns(['templateId', 'locale']).doUpdateSet(shared as any)).execute();
    return r;
  },
  async listNotificationTemplates(this: PostgresKyselyStorage): Promise<NotificationTemplateRecord[]> {
    return (await this.db.selectFrom('NotificationTemplate').selectAll().execute()).map(toTemplate);
  },
  async deleteAllNotificationTemplates(this: PostgresKyselyStorage): Promise<void> {
    await this.db.deleteFrom('NotificationTemplate').execute();
  },
};
