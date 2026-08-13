/**
 * @file src/storage/providers/sqlite/methods/extensions-notify.ts
 * @description Site-log, Extension, Escrow, Cortex, Push, Notification, Session, PAT, Email-invitation methods. Extracted from sqlite/index.ts to satisfy max-file-lines; bodies verbatim, bound to SqliteStorage via prototype merge.
 * @version-history
 *   v1.1.0 — 2026-08-13 — revokeSessionsByGaii, matching the Postgres provider.
 *   v1.0.0 — 2026-07-13 — Extracted from providers/sqlite/index.ts (max-file-lines)
 */
import type {
  SiteChangeLogEntry, ExtensionRecord, EscrowHoldRecord, CortexExtensionRecord, PersonalPushSubscriptionRecord, NotificationPreferences,
  NotificationTemplateRecord
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const extensionsNotifyMethods = {
  // ── Site Change Log ──
  // ══════════════════════════════════════════════════════════

  async addSiteChangeLog(this: SqliteStorage, entry: SiteChangeLogEntry): Promise<SiteChangeLogEntry> {
    this.db.prepare(
      `INSERT INTO site_changelog (id, action, summary, changedBy, changedAt) VALUES (?, ?, ?, ?, ?)`
    ).run(entry.id, entry.action, entry.summary, entry.changedBy, entry.changedAt);

    // Keep at most 200 entries (delete oldest beyond 200)
    this.db.prepare(
      `DELETE FROM site_changelog WHERE id NOT IN (SELECT id FROM site_changelog ORDER BY changedAt DESC LIMIT 200)`
    ).run();

    return entry;
  },

  async listSiteChangeLog(this: SqliteStorage, limit: number, cursor?: string): Promise<SiteChangeLogEntry[]> {
    const sql = 'SELECT * FROM site_changelog ORDER BY changedAt DESC';
    const params: unknown[] = [];

    const allRows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    let entries = allRows.map(r => ({
      id: r.id as string,
      action: r.action as SiteChangeLogEntry['action'],
      summary: r.summary as string,
      changedBy: r.changedBy as string,
      changedAt: r.changedAt as string,
    }));

    if (cursor) {
      const idx = entries.findIndex(e => e.id === cursor);
      if (idx >= 0) entries = entries.slice(idx + 1);
    }
    return entries.slice(0, limit);
  },

  // ══════════════════════════════════════════════════════════
  // ── Extensions ──
  // ══════════════════════════════════════════════════════════

  async createExtension(this: SqliteStorage, record: ExtensionRecord): Promise<ExtensionRecord> {
    try {
      this.db.prepare(
        `INSERT INTO extensions (name, version, description, author, status, requiredApis,
         actions, config, limits, federation, instances, installedBy, installedAt, activatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.name, record.version, record.description, record.author,
        record.status, JSON.stringify(record.requiredApis),
        JSON.stringify(record.actions), JSON.stringify(record.config),
        JSON.stringify(record.limits), JSON.stringify(record.federation),
        record.instances ? JSON.stringify(record.instances) : null,
        record.installedBy, record.installedAt, record.activatedAt ?? null,
      );
      return record;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Extension "${record.name}" already exists`, { cause: err });
      }
      throw err;
    }
  },

  async getExtension(this: SqliteStorage, name: string): Promise<ExtensionRecord | null> {
    const row = this.db.prepare('SELECT * FROM extensions WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeExtension(row) : null;
  },

  async listExtensions(this: SqliteStorage, opts?: { status?: string }): Promise<ExtensionRecord[]> {
    let sql = 'SELECT * FROM extensions';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExtension(r));
  },

  async updateExtension(this: SqliteStorage, name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
    const existing = await this.getExtension(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE extensions SET version = ?, description = ?, author = ?, status = ?,
       requiredApis = ?, actions = ?, config = ?, limits = ?, federation = ?,
       instances = ?, installedBy = ?, installedAt = ?, activatedAt = ? WHERE name = ?`
    ).run(
      updated.version, updated.description, updated.author, updated.status,
      JSON.stringify(updated.requiredApis), JSON.stringify(updated.actions),
      JSON.stringify(updated.config), JSON.stringify(updated.limits),
      JSON.stringify(updated.federation),
      updated.instances ? JSON.stringify(updated.instances) : null,
      updated.installedBy, updated.installedAt, updated.activatedAt ?? null, name,
    );
    return updated;
  },

  async deleteExtension(this: SqliteStorage, name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM extensions WHERE name = ?').run(name);
    return result.changes > 0;
  },

  deserializeExtension(this: SqliteStorage, row: Record<string, unknown>): ExtensionRecord {
    const record: ExtensionRecord = {
      name: row.name as string,
      version: row.version as string,
      description: row.description as string,
      author: row.author as string,
      status: row.status as ExtensionRecord['status'],
      requiredApis: JSON.parse(row.requiredApis as string),
      actions: JSON.parse(row.actions as string),
      config: JSON.parse(row.config as string),
      limits: JSON.parse(row.limits as string),
      federation: JSON.parse(row.federation as string),
      installedBy: row.installedBy as string,
      installedAt: row.installedAt as string,
    };
    if (row.activatedAt) record.activatedAt = row.activatedAt as string;
    if (row.instances) record.instances = JSON.parse(row.instances as string);
    return record;
  },

  // ══════════════════════════════════════════════════════════
  // ── Escrow Holds ──
  // ══════════════════════════════════════════════════════════

  async createEscrowHold(this: SqliteStorage, record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
    this.db.prepare(
      `INSERT INTO escrow_holds (holdId, fromGaii, amount, reason, status, extensionName, createdAt, releasedAt, releasedTo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.holdId, record.fromGaii, record.amount, record.reason,
      record.status, record.extensionName, record.createdAt,
      record.releasedAt ?? null, record.releasedTo ?? null,
    );
    return record;
  },

  async getEscrowHold(this: SqliteStorage, holdId: string): Promise<EscrowHoldRecord | null> {
    const row = this.db.prepare('SELECT * FROM escrow_holds WHERE holdId = ?').get(holdId) as Record<string, unknown> | undefined;
    return row ? this.deserializeEscrowHold(row) : null;
  },

  async listEscrowHolds(this: SqliteStorage, fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
    let sql = 'SELECT * FROM escrow_holds WHERE fromGaii = ?';
    const params: unknown[] = [fromGaii];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeEscrowHold(r));
  },

  async releaseEscrowHold(this: SqliteStorage, holdId: string, toGaii: string): Promise<EscrowHoldRecord | null> {
    const hold = await this.getEscrowHold(holdId);
    if (!hold) return null;
    if (hold.status !== 'held') return null;
    const updated: EscrowHoldRecord = {
      ...hold,
      status: 'released',
      releasedTo: toGaii,
      releasedAt: new Date().toISOString(),
    };
    this.db.prepare(
      'UPDATE escrow_holds SET status = ?, releasedTo = ?, releasedAt = ? WHERE holdId = ?'
    ).run(updated.status, updated.releasedTo, updated.releasedAt, holdId);
    return updated;
  },

  async refundEscrowHold(this: SqliteStorage, holdId: string): Promise<EscrowHoldRecord | null> {
    const hold = await this.getEscrowHold(holdId);
    if (!hold) return null;
    if (hold.status !== 'held') return null;
    const updated: EscrowHoldRecord = {
      ...hold,
      status: 'refunded',
      releasedAt: new Date().toISOString(),
    };
    this.db.prepare(
      'UPDATE escrow_holds SET status = ?, releasedAt = ? WHERE holdId = ?'
    ).run(updated.status, updated.releasedAt, holdId);
    return updated;
  },

  deserializeEscrowHold(this: SqliteStorage, row: Record<string, unknown>): EscrowHoldRecord {
    const record: EscrowHoldRecord = {
      holdId: row.holdId as string,
      fromGaii: row.fromGaii as string,
      amount: row.amount as number,
      reason: row.reason as string,
      status: row.status as EscrowHoldRecord['status'],
      extensionName: row.extensionName as string,
      createdAt: row.createdAt as string,
    };
    if (row.releasedAt) record.releasedAt = row.releasedAt as string;
    if (row.releasedTo) record.releasedTo = row.releasedTo as string;
    return record;
  },

  // ── Cortex Extensions ──────────────────────────────────────────

  async createCortexExtension(this: SqliteStorage, record: CortexExtensionRecord): Promise<CortexExtensionRecord> {
    const existing = this.db.prepare('SELECT name FROM cortex_extensions WHERE name = ?').get(record.name);
    if (existing) throw new Error(`Cortex extension "${record.name}" already exists`);
    this.db.prepare(`INSERT INTO cortex_extensions (name, namespace, shortName, apiVersion, version, description, author, license, tags, labels, aimeatCompat, status, visibility, installedAt, activatedAt, installedBy, manifest, components, activationArtifacts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.name, record.namespace, record.shortName, record.apiVersion, record.version,
      record.description, record.author, record.license ?? null,
      JSON.stringify(record.tags), JSON.stringify(record.labels),
      record.aimeatCompat ?? null, record.status, record.visibility ?? 'private', record.installedAt, record.activatedAt ?? null,
      record.installedBy, record.manifest,
      JSON.stringify(record.components), JSON.stringify(record.activationArtifacts),
    );
    return record;
  },

  async getCortexExtension(this: SqliteStorage, name: string): Promise<CortexExtensionRecord | null> {
    const row = this.db.prepare('SELECT * FROM cortex_extensions WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.deserializeCortexExtension(row) : null;
  },

  async listCortexExtensions(this: SqliteStorage, opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string }): Promise<CortexExtensionRecord[]> {
    let sql = 'SELECT * FROM cortex_extensions WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.namespace) { sql += ' AND namespace = ?'; params.push(opts.namespace); }
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    if (opts?.installedBy) { sql += ' AND installedBy = ?'; params.push(opts.installedBy); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeCortexExtension(r));
  },

  async updateCortexExtension(this: SqliteStorage, name: string, updates: Partial<CortexExtensionRecord>): Promise<CortexExtensionRecord | null> {
    const existing = await this.getCortexExtension(name);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    this.db.prepare(`UPDATE cortex_extensions SET namespace=?, shortName=?, apiVersion=?, version=?, description=?, author=?, license=?, tags=?, labels=?, aimeatCompat=?, status=?, visibility=?, installedAt=?, activatedAt=?, installedBy=?, manifest=?, components=?, activationArtifacts=? WHERE name=?`).run(
      merged.namespace, merged.shortName, merged.apiVersion, merged.version,
      merged.description, merged.author, merged.license ?? null,
      JSON.stringify(merged.tags), JSON.stringify(merged.labels),
      merged.aimeatCompat ?? null, merged.status, merged.visibility ?? 'private', merged.installedAt, merged.activatedAt ?? null,
      merged.installedBy, merged.manifest,
      JSON.stringify(merged.components), JSON.stringify(merged.activationArtifacts), name,
    );
    return merged;
  },

  async deleteCortexExtension(this: SqliteStorage, name: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM cortex_extensions WHERE name = ?').run(name);
    if (result.changes > 0) {
      this.db.prepare('DELETE FROM cortex_lib_files WHERE extName = ?').run(name);
    }
    return result.changes > 0;
  },

  async setCortexLibFile(this: SqliteStorage, extName: string, libName: string, content: string): Promise<void> {
    this.db.prepare('INSERT OR REPLACE INTO cortex_lib_files (extName, libName, content) VALUES (?, ?, ?)').run(extName, libName, content);
  },

  async getCortexLibFile(this: SqliteStorage, extName: string, libName: string): Promise<string | null> {
    const row = this.db.prepare('SELECT content FROM cortex_lib_files WHERE extName = ? AND libName = ?').get(extName, libName) as { content: string } | undefined;
    return row?.content ?? null;
  },

  async deleteCortexLibFile(this: SqliteStorage, extName: string, libName: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM cortex_lib_files WHERE extName = ? AND libName = ?').run(extName, libName);
    return result.changes > 0;
  },

  deserializeCortexExtension(this: SqliteStorage, row: Record<string, unknown>): CortexExtensionRecord {
    return {
      name: row.name as string,
      namespace: row.namespace as string,
      shortName: row.shortName as string,
      apiVersion: row.apiVersion as string,
      version: row.version as string,
      description: row.description as string,
      author: row.author as string,
      license: row.license as string | undefined,
      tags: JSON.parse(row.tags as string || '[]'),
      labels: JSON.parse(row.labels as string || '{}'),
      aimeatCompat: row.aimeatCompat as string | undefined,
      status: row.status as 'inactive' | 'active',
      visibility: (row.visibility as string) === 'public' ? 'public' : 'private',
      installedAt: row.installedAt as string,
      activatedAt: row.activatedAt as string | undefined,
      installedBy: row.installedBy as string,
      manifest: row.manifest as string,
      components: JSON.parse(row.components as string || '[]'),
      activationArtifacts: JSON.parse(row.activationArtifacts as string || '{}'),
    };
  },

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
      `INSERT INTO notification_preferences (personalNodeId, enabled, channels, notifyTypes, cooldownMinutes, quietHoursUtc, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(personalNodeId) DO UPDATE SET
         enabled = excluded.enabled,
         channels = excluded.channels,
         notifyTypes = excluded.notifyTypes,
         cooldownMinutes = excluded.cooldownMinutes,
         quietHoursUtc = excluded.quietHoursUtc,
         email = excluded.email`
    ).run(
      prefs.personalNodeId,
      prefs.enabled ? 1 : 0,
      JSON.stringify(prefs.channels),
      JSON.stringify(prefs.notifyTypes),
      prefs.cooldownMinutes,
      prefs.quietHoursUtc ? JSON.stringify(prefs.quietHoursUtc) : null,
      prefs.email,
    );
    return prefs;
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

  // ══════════════════════════════════════════════════════════
  // ── Sessions (P3-7: Server-Side Session Tracking) ──
  // ══════════════════════════════════════════════════════════

  mapSessionRow(this: SqliteStorage, row: Record<string, unknown>): import('../../../../storage/repositories/session.repository.js').SessionRecord {
    return {
      sessionId: row.sessionId as string,
      gaii: row.gaii as string,
      owner: row.owner as string,
      issuedAt: row.issuedAt as string,
      expiresAt: row.expiresAt as string,
      revoked: row.revoked === 1 || row.revoked === true,
      refreshTokenHash: (row.refreshTokenHash as string | null) ?? null,
      prevTokenHash: (row.prevTokenHash as string | null) ?? null,
      prevValidUntil: (row.prevValidUntil as string | null) ?? null,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      idleExpiresAt: (row.idleExpiresAt as string | null) ?? null,
      absoluteExpiresAt: (row.absoluteExpiresAt as string | null) ?? null,
      deviceLabel: (row.deviceLabel as string | null) ?? null,
      userAgent: (row.userAgent as string | null) ?? null,
    };
  },

  async createSession(this: SqliteStorage, session: { sessionId: string; gaii: string; owner: string; issuedAt: string; expiresAt: string }): Promise<void> {
    this.db.prepare(
      'INSERT INTO sessions (sessionId, gaii, owner, issuedAt, expiresAt, revoked) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(session.sessionId, session.gaii, session.owner, session.issuedAt, session.expiresAt);
  },

  async createOwnerSession(this: SqliteStorage, session: {
    sessionId: string; gaii: string; owner: string; issuedAt: string;
    refreshTokenHash: string; idleExpiresAt: string; absoluteExpiresAt: string;
    lastUsedAt: string; deviceLabel?: string | null; userAgent?: string | null;
  }): Promise<void> {
    // expiresAt mirrors the idle window so listActiveSessions reflects refresh-token life.
    this.db.prepare(
      `INSERT INTO sessions
         (sessionId, gaii, owner, issuedAt, expiresAt, revoked,
          refreshTokenHash, idleExpiresAt, absoluteExpiresAt, lastUsedAt, deviceLabel, userAgent)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.sessionId, session.gaii, session.owner, session.issuedAt, session.idleExpiresAt,
      session.refreshTokenHash, session.idleExpiresAt, session.absoluteExpiresAt, session.lastUsedAt,
      session.deviceLabel ?? null, session.userAgent ?? null,
    );
  },

  async listActiveSessions(this: SqliteStorage, owner: string): Promise<import('../../../../storage/repositories/session.repository.js').SessionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM sessions WHERE owner = ? AND revoked = 0 ORDER BY issuedAt DESC'
    ).all(owner) as Record<string, unknown>[];
    return rows.map((r) => this.mapSessionRow(r));
  },

  async getSessionByRefreshHash(this: SqliteStorage, tokenHash: string): Promise<import('../../../../storage/repositories/session.repository.js').SessionRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM sessions WHERE refreshTokenHash = ? OR prevTokenHash = ? LIMIT 1'
    ).get(tokenHash, tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapSessionRow(row) : null;
  },

  async rotateSessionRefresh(this: SqliteStorage, sessionId: string, update: {
    refreshTokenHash: string; prevTokenHash: string | null; prevValidUntil: string | null;
    idleExpiresAt: string; expiresAt: string; lastUsedAt: string;
  }): Promise<void> {
    this.db.prepare(
      `UPDATE sessions SET refreshTokenHash = ?, prevTokenHash = ?, prevValidUntil = ?,
         idleExpiresAt = ?, expiresAt = ?, lastUsedAt = ? WHERE sessionId = ?`
    ).run(
      update.refreshTokenHash, update.prevTokenHash, update.prevValidUntil,
      update.idleExpiresAt, update.expiresAt, update.lastUsedAt, sessionId,
    );
  },

  async revokeSession(this: SqliteStorage, sessionId: string): Promise<boolean> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE sessionId = ? AND revoked = 0').run(sessionId);
    return result.changes > 0;
  },

  async revokeAllSessions(this: SqliteStorage, owner: string): Promise<number> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE owner = ? AND revoked = 0').run(owner);
    return result.changes;
  },

  async revokeSessionsByGaii(this: SqliteStorage, gaii: string): Promise<number> {
    const result = this.db.prepare('UPDATE sessions SET revoked = 1 WHERE gaii = ? AND revoked = 0').run(gaii);
    return result.changes;
  },

  async isSessionRevoked(this: SqliteStorage, sessionId: string): Promise<boolean> {
    const row = this.db.prepare('SELECT revoked FROM sessions WHERE sessionId = ?').get(sessionId) as { revoked: number } | undefined;
    if (!row) return false; // session not tracked = not revoked
    return row.revoked === 1;
  },

  async pruneExpiredSessions(this: SqliteStorage, nowIso: string): Promise<number> {
    // Remove fully-dead rows: past their expiry (legacy JWT exp / owner idle window)
    // or past the absolute cap. Revoked-but-unexpired rows are kept so isSessionRevoked
    // still rejects their (short-lived) access tokens.
    const result = this.db.prepare(
      `DELETE FROM sessions
        WHERE expiresAt < ?
           OR (absoluteExpiresAt IS NOT NULL AND absoluteExpiresAt < ?)`
    ).run(nowIso, nowIso);
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
  // ── Personal Access Tokens ──
  // ══════════════════════════════════════════════════════════

  mapPatRow(this: SqliteStorage, row: Record<string, unknown>): import('../../../../storage/repositories/pat.repository.js').PatRecord {
    return {
      id: row.id as string,
      tokenHash: row.tokenHash as string,
      label: row.label as string,
      owner: row.owner as string,
      scopes: row.scopes ? JSON.parse(row.scopes as string) : [],
      grantOwner: row.grantOwner === 1 || row.grantOwner === true,
      grantOperator: row.grantOperator === 1 || row.grantOperator === true,
      readOwnerData: row.readOwnerData === 1 || row.readOwnerData === true,
      gaii: row.gaii as string,
      createdAt: row.createdAt as string,
      expiresAt: (row.expiresAt as string | null) ?? null,
      lastUsedAt: (row.lastUsedAt as string | null) ?? null,
      revoked: row.revoked === 1 || row.revoked === true,
    };
  },

  async createPat(this: SqliteStorage, pat: import('../../../../storage/repositories/pat.repository.js').PatRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO personal_access_tokens
         (id, tokenHash, label, owner, scopes, grantOwner, grantOperator, readOwnerData, gaii, createdAt, expiresAt, lastUsedAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      pat.id, pat.tokenHash, pat.label, pat.owner, JSON.stringify(pat.scopes ?? []),
      pat.grantOwner ? 1 : 0, pat.grantOperator ? 1 : 0, pat.readOwnerData ? 1 : 0,
      pat.gaii, pat.createdAt, pat.expiresAt ?? null, pat.lastUsedAt ?? null,
    );
  },

  async getPatByHash(this: SqliteStorage, tokenHash: string): Promise<import('../../../../storage/repositories/pat.repository.js').PatRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM personal_access_tokens WHERE tokenHash = ? AND revoked = 0 LIMIT 1'
    ).get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapPatRow(row) : null;
  },

  async listPats(this: SqliteStorage, owner: string): Promise<import('../../../../storage/repositories/pat.repository.js').PatRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM personal_access_tokens WHERE owner = ? AND revoked = 0 ORDER BY createdAt DESC'
    ).all(owner) as Record<string, unknown>[];
    return rows.map((r) => this.mapPatRow(r));
  },

  async revokePat(this: SqliteStorage, id: string, owner: string): Promise<boolean> {
    const result = this.db.prepare(
      'UPDATE personal_access_tokens SET revoked = 1 WHERE id = ? AND owner = ? AND revoked = 0'
    ).run(id, owner);
    return result.changes > 0;
  },

  async touchPat(this: SqliteStorage, id: string, usedAtIso: string): Promise<void> {
    this.db.prepare('UPDATE personal_access_tokens SET lastUsedAt = ? WHERE id = ?').run(usedAtIso, id);
  },

  // ══════════════════════════════════════════════════════════
  // ── Email invitations ──
  // ══════════════════════════════════════════════════════════

  mapInvitationRow(this: SqliteStorage, row: Record<string, unknown>): import('../../../../storage/repositories/invitation.repository.js').InvitationRecord {
    return {
      id: row.id as string,
      tokenHash: row.tokenHash as string,
      organismId: (row.organismId as string | null) ?? null,
      orgRole: (row.orgRole as 'member' | 'admin') ?? 'member',
      type: (row.type as 'link' | 'code' | 'registration') ?? 'link',
      workspaces: row.workspaces ? JSON.parse(row.workspaces as string) : [],
      email: row.email as string,
      emailHash: row.emailHash as string,
      invitedBy: row.invitedBy as string,
      provisionedOwner: (row.provisionedOwner as string | null) ?? null,
      message: (row.message as string | null) ?? null,
      status: row.status as 'pending' | 'accepted' | 'cancelled' | 'expired',
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
      acceptedAt: (row.acceptedAt as string | null) ?? null,
      acceptedBy: (row.acceptedBy as string | null) ?? null,
      returnUrl: (row.returnUrl as string | null) ?? null,
      meta: row.meta ? JSON.parse(row.meta as string) : null,
    };
  },

  async createInvitation(this: SqliteStorage, rec: import('../../../../storage/repositories/invitation.repository.js').InvitationRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO invitations
         (id, tokenHash, organismId, orgRole, type, workspaces, email, emailHash, invitedBy, provisionedOwner, message, status, createdAt, expiresAt, acceptedAt, acceptedBy, returnUrl, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      rec.id, rec.tokenHash, rec.organismId, rec.orgRole, rec.type ?? 'link', JSON.stringify(rec.workspaces ?? []),
      rec.email, rec.emailHash, rec.invitedBy, rec.provisionedOwner ?? null, rec.message ?? null, rec.status,
      rec.createdAt, rec.expiresAt, rec.acceptedAt ?? null, rec.acceptedBy ?? null, rec.returnUrl ?? null,
      rec.meta ? JSON.stringify(rec.meta) : null,
    );
  },

  async getInvitationByHash(this: SqliteStorage, tokenHash: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const row = this.db.prepare('SELECT * FROM invitations WHERE tokenHash = ? LIMIT 1').get(tokenHash) as Record<string, unknown> | undefined;
    return row ? this.mapInvitationRow(row) : null;
  },

  async getInvitation(this: SqliteStorage, id: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const row = this.db.prepare('SELECT * FROM invitations WHERE id = ? LIMIT 1').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapInvitationRow(row) : null;
  },

  async listInvitationsByOrganism(this: SqliteStorage, organismId: string, opts?: { status?: string }): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord[]> {
    const rows = opts?.status
      ? this.db.prepare('SELECT * FROM invitations WHERE organismId = ? AND status = ? ORDER BY createdAt DESC').all(organismId, opts.status) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM invitations WHERE organismId = ? ORDER BY createdAt DESC').all(organismId) as Record<string, unknown>[];
    return rows.map((r) => this.mapInvitationRow(r));
  },

  async listInvitationsByEmailHash(this: SqliteStorage, emailHash: string, opts?: { status?: string; type?: string }): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord[]> {
    const where: string[] = ['emailHash = ?'];
    const values: unknown[] = [emailHash];
    if (opts?.status) { where.push('status = ?'); values.push(opts.status); }
    if (opts?.type) { where.push('type = ?'); values.push(opts.type); }
    const rows = this.db.prepare(
      `SELECT * FROM invitations WHERE ${where.join(' AND ')} ORDER BY createdAt DESC`
    ).all(...values) as Record<string, unknown>[];
    return rows.map((r) => this.mapInvitationRow(r));
  },

  async countInvitationsByInviter(this: SqliteStorage, invitedBy: string, opts?: { organismId?: string; type?: 'link' | 'code'; statuses?: string[] }): Promise<number> {
    const where: string[] = ['invitedBy = ?'];
    const values: unknown[] = [invitedBy];
    if (opts?.organismId) { where.push('organismId = ?'); values.push(opts.organismId); }
    if (opts?.type) { where.push('type = ?'); values.push(opts.type); }
    if (opts?.statuses && opts.statuses.length) {
      where.push(`status IN (${opts.statuses.map(() => '?').join(', ')})`);
      values.push(...opts.statuses);
    }
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM invitations WHERE ${where.join(' AND ')}`).get(...values) as { n: number };
    return row.n;
  },

  async getCodeInvitationByProvisionedOwner(this: SqliteStorage, owner: string): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const row = this.db.prepare(
      "SELECT * FROM invitations WHERE type = 'code' AND provisionedOwner = ? ORDER BY createdAt DESC LIMIT 1"
    ).get(owner) as Record<string, unknown> | undefined;
    return row ? this.mapInvitationRow(row) : null;
  },

  async updateInvitation(this: SqliteStorage, id: string, updates: Partial<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord>): Promise<import('../../../../storage/repositories/invitation.repository.js').InvitationRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.acceptedAt !== undefined) { fields.push('acceptedAt = ?'); values.push(updates.acceptedAt); }
    if (updates.acceptedBy !== undefined) { fields.push('acceptedBy = ?'); values.push(updates.acceptedBy); }
    if (updates.orgRole !== undefined) { fields.push('orgRole = ?'); values.push(updates.orgRole); }
    if (updates.workspaces !== undefined) { fields.push('workspaces = ?'); values.push(JSON.stringify(updates.workspaces ?? [])); }
    if (fields.length) {
      values.push(id);
      this.db.prepare(`UPDATE invitations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    return this.getInvitation(id);
  },

  async cleanupExpiredInvitations(this: SqliteStorage, nowIso: string): Promise<number> {
    // Only magic-link invites auto-expire. Code invites provisioned a real account, so they are
    // reclaimed by an explicit cancel (which deletes the account) — never blindly swept to 'expired'.
    const result = this.db.prepare(
      `UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND type = 'link' AND expiresAt <= ?`
    ).run(nowIso);
    return result.changes;
  },

  // ══════════════════════════════════════════════════════════
};
