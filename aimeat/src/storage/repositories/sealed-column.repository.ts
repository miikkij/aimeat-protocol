/**
 * @file src/storage/repositories/sealed-column.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic contract for the data key's re-encrypt job (services/key-reencrypt/):
 *   read every row of a column that holds a value sealed with the data key, in a stable order and a
 *   page at a time, and write a resealed value back only while the row still holds what was read.
 *
 *   WHY ITS OWN METHODS. The columns below are written by their own services with a plain UPDATE,
 *   and several of them have no method that lists every row across owners (a person's vault, a
 *   person's MCP sign-in, a company's SMTP password). A rotation must reach every row, and its write
 *   must never undo a change another writer made between the read and the write (a token refresh
 *   rewrites a connection's credential), so the write compares the whole stored value first and
 *   writes nothing when it differs. Nothing else in a row is touched: not its status, not its
 *   updatedAt.
 *
 *   ORDER AND RESUMING. Rows come in the order of their id columns, after the id the caller names,
 *   so a job that stopped resumes from the last id it finished and sees each row once.
 *
 *   MEMORY is listed here by key only (`memory`, filtered by a key prefix, the deleted rows left out
 *   and the archived ones kept); the job reads and writes a record through the memory methods
 *   (services/record-cas.ts updateMemoryRecord), on its version.
 * @structure SEALED_COLUMNS · SealedColumn · SealedColumnSpec · SealedColumnRow · SealedColumnRepository
 * @usage
 *   const rows = await storage.listSealedColumn('connection.credential', { after: lastId, limit: 100 });
 *   const written = await storage.swapSealedColumn('connection.credential', row.id, row.value, resealed);
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */

/** Where each column lives in the two providers, its id columns in order, and whether it holds JSON. */
export interface SealedColumnSpec {
  pg: string;
  sqlite: string;
  ids: readonly string[];
  /** The column with the sealed value; null for `memory`, which is listed by id only. */
  column: string | null;
  json: boolean;
}

export const SEALED_COLUMNS = {
  'connection.credential': { pg: 'Connection', sqlite: 'connections', ids: ['id'], column: 'credential', json: false },
  'provider-client.client-secret': { pg: 'ProviderClient', sqlite: 'provider_clients', ids: ['id'], column: 'clientSecret', json: false },
  'mcp-server.credential': { pg: 'McpServer', sqlite: 'mcp_servers', ids: ['id'], column: 'credential', json: false },
  'mcp-server.transport': { pg: 'McpServer', sqlite: 'mcp_servers', ids: ['id'], column: 'transport', json: true },
  'mcp-user-credential.credential': { pg: 'McpUserCredential', sqlite: 'mcp_user_credentials', ids: ['serverId', 'ownerGhii'], column: 'credential', json: false },
  'company-smtp.password': { pg: 'CompanySmtp', sqlite: 'company_smtp', ids: ['companyId'], column: 'passwordEnc', json: false },
  'secret.ciphertext': { pg: 'Secret', sqlite: 'secrets', ids: ['ownerGaii', 'name'], column: 'ciphertext', json: false },
  'ghii.totp-secret': { pg: 'Ghii', sqlite: 'ghiis', ids: ['ghii'], column: 'totpSecret', json: false },
  'system-setting.value': { pg: 'SystemSetting', sqlite: 'system_settings', ids: ['key'], column: 'value', json: false },
  'extension.config': { pg: 'Extension', sqlite: 'extensions', ids: ['name'], column: 'config', json: true },
  'extension-instance.config': { pg: 'ExtensionInstance', sqlite: 'extension_instances', ids: ['extensionName', 'id'], column: 'config', json: true },
  'node-key.private-key': { pg: 'NodeKey', sqlite: 'node_key', ids: ['publicKey'], column: 'privateKey', json: false },
  'memory': { pg: 'Memory', sqlite: 'memory', ids: ['key', 'ownerGaii'], column: null, json: false },
} as const satisfies Record<string, SealedColumnSpec>;

export type SealedColumn = keyof typeof SEALED_COLUMNS;

/** One row: its id values in the order of the spec's `ids`, and the column's value (null for memory). */
export interface SealedColumnRow {
  id: string[];
  value: unknown;
}

export interface SealedColumnRepository {
  /**
   * Up to `limit` rows of `column` whose id comes after `after` (none: from the first), in id order.
   * A row whose column is null is left out. For `memory`, `prefix` names the key prefix (required)
   * and `value` is null.
   */
  listSealedColumn(column: SealedColumn, opts: { after?: string[] | null; limit: number; prefix?: string }): Promise<SealedColumnRow[]>;
  /**
   * Write `next` into the column of row `id` only while the row holds `expected` (compared whole: a
   * string exactly, JSON by value). True when it was written. Nothing else in the row changes.
   * Refused for `memory`, which is written on its version through the memory methods.
   */
  swapSealedColumn(column: SealedColumn, id: string[], expected: unknown, next: unknown): Promise<boolean>;
}
