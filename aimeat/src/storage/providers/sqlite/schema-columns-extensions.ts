/**
 * @file sqlite/schema-columns-extensions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Added columns for existing SQLite databases that an extension's run reads:
 *   extension_instances.createdByAgent/.translations, and the secrets vault's hosts and hostBinding,
 *   which ctx.fetch reads to decide where a secret may go. Called by initializeSchema at the point
 *   where these ALTERs always ran.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Moved out of schema.ts unchanged (max-file-lines), plus secrets.hostBinding:
 *     who bound a secret to its host, and how (mirrors Postgres migration 0099; secrets audit
 *     2026-10-09, item 10).
 */
import type { SafeAddColumn } from './schema-columns-scheduler.js';

export function applyExtensionColumns(safeAddColumn: SafeAddColumn): void {
  // An extension instance's per-locale overrides and the agent that created it. The
  // deserializer has read both since they were added to the record; the table had neither
  // column and the INSERT and UPDATE wrote neither, while updateExtensionInstance returned
  // `{...existing, ...updates}` -- so a PUT answered 200 with the translations echoed back and
  // the next GET served nothing. Review item 5.4, 2026-09-06.
  safeAddColumn('extension_instances', 'createdByAgent', 'TEXT');
  safeAddColumn('extension_instances', 'translations', 'TEXT');

  // The hosts a vault secret may be sent to, bound at its first use. Mirrors Postgres 0078.
  safeAddColumn('secrets', 'hosts', "TEXT NOT NULL DEFAULT '[]'");
  // Who bound it and how: the owner setting the host, or the principal and extension of its first
  // use. JSON, null until bound. Mirrors Postgres 0099.
  safeAddColumn('secrets', 'hostBinding', 'TEXT');
}
