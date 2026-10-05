/**
 * @file src/storage/providers/sqlite/methods/node-ext-escrow.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/node-ext-escrow.ts
 *   (nodeExtEscrowMethods), so a fix in one provider finds its twin by file name. Bodies moved verbatim from
 *   the files named in the version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure nodeExtEscrowMethods
 * @usage Object.assign(SqliteStorage.prototype, nodeExtEscrowMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 15 methods (createExtension, getExtension, listExtensions, …) moved here from
 *     extensions-notify.ts; createExtensionInstance, getExtensionInstance, listExtensionInstances,
 *     updateExtensionInstance, deleteExtensionInstance, deleteExtensionInstancesByOwner,
 *     deserializeExtensionInstance moved here from federation-oauth.ts so the file mirrors
 *     postgres-kysely/methods/node-ext-escrow.ts (secaudit 2026-10, M8).
 */
import type { ExtensionRecord, CortexExtensionRecord, ExtensionInstanceRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const nodeExtEscrowMethods = {

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

  async listExtensions(this: SqliteStorage, opts?: { status?: string; lean?: boolean }): Promise<ExtensionRecord[]> {
    let sql = 'SELECT * FROM extensions';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' WHERE status = ?'; params.push(opts.status); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const records = rows.map(r => this.deserializeExtension(r));
    // lean: same contract as the Postgres provider (scriptContent stripped per action). The database
    // is in-process here so the strip happens after parse — the win is the retained copies, and the
    // two backends return the same shape.
    if (opts?.lean) {
      return records.map(rec => ({ ...rec, actions: rec.actions.map(a => ({ ...a, scriptContent: '' })) }));
    }
    return records;
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

  async listCortexExtensions(this: SqliteStorage, opts?: { status?: string; namespace?: string; visibility?: string; installedBy?: string; lean?: boolean }): Promise<CortexExtensionRecord[]> {
    let sql = 'SELECT * FROM cortex_extensions WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    if (opts?.namespace) { sql += ' AND namespace = ?'; params.push(opts.namespace); }
    if (opts?.visibility) { sql += ' AND visibility = ?'; params.push(opts.visibility); }
    if (opts?.installedBy) { sql += ' AND installedBy = ?'; params.push(opts.installedBy); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    const records = rows.map(r => this.deserializeCortexExtension(r));
    // lean: same contract as the Postgres provider — manifest '' and seed-data entries [] (lib
    // exports/api_surface/prompt content kept). See node.repository.ts.
    if (opts?.lean) {
      return records.map(rec => ({
        ...rec,
        manifest: '',
        components: rec.components.map(c => (c.type === 'seed-data' ? { ...c, entries: [] } : c)),
      }));
    }
    return records;
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
  // ── Extension Instances ──
  // ══════════════════════════════════════════════════════════

  async createExtensionInstance(this: SqliteStorage, record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord> {
    try {
      this.db.prepare(
        `INSERT INTO extension_instances (id, extensionName, config, status, createdBy, createdByAgent, translations, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.extensionName, JSON.stringify(record.config),
        record.status, record.createdBy,
        record.createdByAgent ?? null,
        record.translations ? JSON.stringify(record.translations) : null,
        record.createdAt, record.updatedAt,
      );
      // Read back, for the reason notification preferences now do: returning the caller's own object
      // is what let two fields go unwritten for as long as they did.
      return (await this.getExtensionInstance(record.extensionName, record.id))!;
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`Extension instance "${record.id}" already exists for "${record.extensionName}"`, { cause: err });
      }
      throw err;
    }
  },

  async getExtensionInstance(this: SqliteStorage, extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null> {
    const row = this.db.prepare(
      'SELECT * FROM extension_instances WHERE extensionName = ? AND id = ?'
    ).get(extensionName, instanceId) as Record<string, unknown> | undefined;
    return row ? this.deserializeExtensionInstance(row) : null;
  },

  async listExtensionInstances(this: SqliteStorage, extensionName: string): Promise<ExtensionInstanceRecord[]> {
    // Newest first, which is the order the Postgres twin has always returned. An unordered listing
    // on one backend and a sorted one on the other is a page that looks shuffled to whoever moves.
    const rows = this.db.prepare(
      'SELECT * FROM extension_instances WHERE extensionName = ? ORDER BY createdAt DESC'
    ).all(extensionName) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExtensionInstance(r));
  },

  async updateExtensionInstance(this: SqliteStorage, extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null> {
    const existing = await this.getExtensionInstance(extensionName, instanceId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    // `translations` and `createdByAgent` were in the record and in neither the SET nor the columns,
    // so this answered 200 with the caller's own translations echoed back and the next read served
    // none. Review item 5.4, 2026-09-06.
    this.db.prepare(
      `UPDATE extension_instances SET config = ?, status = ?, createdBy = ?, createdByAgent = ?, translations = ?, createdAt = ?, updatedAt = ?
       WHERE extensionName = ? AND id = ?`
    ).run(
      JSON.stringify(updated.config), updated.status,
      updated.createdBy,
      updated.createdByAgent ?? null,
      updated.translations ? JSON.stringify(updated.translations) : null,
      updated.createdAt, updated.updatedAt,
      extensionName, instanceId,
    );
    return await this.getExtensionInstance(extensionName, instanceId);
  },

  async deleteExtensionInstance(this: SqliteStorage, extensionName: string, instanceId: string): Promise<boolean> {
    const result = this.db.prepare(
      'DELETE FROM extension_instances WHERE extensionName = ? AND id = ?'
    ).run(extensionName, instanceId);
    return result.changes > 0;
  },

  async deleteExtensionInstancesByOwner(this: SqliteStorage, ownerIdentity: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM extension_instances WHERE createdBy = ?').run(ownerIdentity);
    return result.changes;
  },

  deserializeExtensionInstance(this: SqliteStorage, row: Record<string, unknown>): ExtensionInstanceRecord {
    const record: ExtensionInstanceRecord = {
      id: row.id as string,
      extensionName: row.extensionName as string,
      config: JSON.parse(row.config as string),
      status: row.status as ExtensionInstanceRecord['status'],
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
    if (row.createdByAgent) record.createdByAgent = row.createdByAgent as string;
    if (row.translations) record.translations = JSON.parse(row.translations as string);
    return record;
  },
};
