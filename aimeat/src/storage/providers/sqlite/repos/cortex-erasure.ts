/**
 * @file src/storage/providers/sqlite/repos/cortex-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the cortexes an erased account installed. deleteOwner (methods/owner.ts)
 *   calls it inside its own transaction, after the per-identity passes and the actions published
 *   under the bare account name. A free function over the connection, like the other erasure repos,
 *   so there is no import cycle through the provider class. The rule is ../../../erased-cortex.ts; the
 *   Postgres twin is deleteInstalledCortexesDb in its methods/identity-erasure.ts.
 * @structure deleteInstalledCortexes(db, name, ghiis, opts)
 * @usage deleteInstalledCortexes(this.db, name, ghiiRows.map(r => r.ghii));
 * @version-history
 *   v1.1.0 — 2026-09-26 — `names`, for the operator's decision on a held name (repos/held-names.ts);
 *     the start step and that decision call this same function.
 *   v1.0.0 — 2026-09-26 — Initial: an account deletion takes the cortexes it installed (secaudit
 *     2026-09, R4 "found": the cortex record).
 */
import type Database from 'better-sqlite3';
import { partyIdentities } from '../../../erased-party.js';
import { erasedCortexParts } from '../../../erased-cortex.js';
import { invalidateSchemaLockCache } from '../../../schema-lock-cache.js';

/**
 * Take the cortexes an erased account installed off the node, with what their activation made.
 *
 * The per-identity passes have run, so what sat under the person's GHII and agents is gone already.
 * What is left is found by each record: the actions under the identity it names; and, where one of
 * the person's principals wrote them (the bare name, or `…#name@node`, an ecosystem app of theirs
 * included), the schema locks, the boards with their posts and subscriptions, and the prompt,
 * ontology and seed records. Then the lib files, the kept versions, the dependency edges and the
 * records go. Returns the number of records deleted.
 *
 * SQLite LIKE has no escape character unless it is named, so each pattern names the backslash.
 *
 * `names` limits it to those cortexes: the ones older than the account that holds the name now, when
 * the operator decides they were a previous holder's.
 */
export function deleteInstalledCortexes(
  db: Database.Database, name: string, ghiis: string[], opts: { names?: string[] } = {},
): number {
  if (opts.names && opts.names.length === 0) return 0;
  const only = opts.names ? ` AND name IN (${opts.names.map(() => '?').join(', ')})` : '';
  const rows = db.prepare(`SELECT name, activationArtifacts FROM cortex_extensions WHERE installedBy = ?${only}`)
    .all(name, ...(opts.names ?? [])) as { name: string; activationArtifacts: string }[];
  if (rows.length === 0) return 0;

  const { exact, suffixPatterns } = partyIdentities(name, ghiis);
  // `<column> IN (…) OR <column> LIKE … ESCAPE '\'`, with its parameters: one of the person's principals.
  const theirs = (column: string): { sql: string; params: string[] } => ({
    sql: `(${[`${column} IN (${exact.map(() => '?').join(', ')})`, ...suffixPatterns.map(() => `${column} LIKE ? ESCAPE '\\'`)].join(' OR ')})`,
    params: [...exact, ...suffixPatterns],
  });
  const marks = (list: string[]) => list.map(() => '?').join(', ');

  let locks = 0;
  for (const row of rows) {
    const parts = erasedCortexParts(row.activationArtifacts);
    if (parts.actionIds.length) {
      const by = theirs('providerGaii');
      const provider = parts.actionProvider ? 'providerGaii = ? OR ' : '';
      db.prepare(`DELETE FROM actions WHERE id IN (${marks(parts.actionIds)}) AND (${provider}${by.sql})`)
        .run(...parts.actionIds, ...(parts.actionProvider ? [parts.actionProvider] : []), ...by.params);
    }
    if (parts.schemaKeys.length) {
      const by = theirs('lockedBy');
      locks += db.prepare(`DELETE FROM schemas WHERE keyPattern IN (${marks(parts.schemaKeys)}) AND ${by.sql}`)
        .run(...parts.schemaKeys, ...by.params).changes;
    }
    if (parts.boardIds.length) {
      const by = theirs('ownerGaii');
      const boards = db.prepare(`SELECT id FROM boards WHERE id IN (${marks(parts.boardIds)}) AND ${by.sql}`)
        .all(...parts.boardIds, ...by.params) as { id: string }[];
      for (const b of boards) {
        db.prepare('DELETE FROM board_posts WHERE boardId = ?').run(b.id);
        db.prepare('DELETE FROM board_subscriptions WHERE boardId = ?').run(b.id);
        db.prepare('DELETE FROM boards WHERE id = ?').run(b.id);
      }
    }
    if (parts.memoryKeys.length) {
      const by = theirs('ownerGaii');
      db.prepare(`DELETE FROM memory WHERE key IN (${marks(parts.memoryKeys)}) AND ${by.sql}`)
        .run(...parts.memoryKeys, ...by.params);
    }
    db.prepare('DELETE FROM cortex_lib_files WHERE extName = ?').run(row.name);
    db.prepare("DELETE FROM component_versions WHERE kind = 'cortex' AND name = ?").run(row.name);
    db.prepare("DELETE FROM dependency_edges WHERE fromKind = 'cortex' AND fromRef = ?").run(row.name);
  }
  const drop = db.prepare('DELETE FROM cortex_extensions WHERE installedBy = ? AND name = ?');
  let removed = 0;
  for (const row of rows) removed += drop.run(name, row.name).changes;
  // Every memory write reads the schema locks from a process cache, which a delete refreshes.
  if (locks > 0) invalidateSchemaLockCache();
  return removed;
}
