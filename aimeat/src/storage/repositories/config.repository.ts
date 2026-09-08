/**
 * @file src/storage/repositories/config.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-layer interface for persisting admin-editable config values (keyed by dot-path,
 *   stored under a "config:" prefix in the backend), implemented per backend (SQLite / Prisma).
 *
 * @structure
 *   - ConfigRepository: supportsConfigPersistence + set/delete a single value + getAll values
 *
 * @version-history
 *   v1.1.0 — 2026-09-09 — getConfigValue deleted: no caller (readers take getAllConfigValues).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
export interface ConfigRepository {
  /** Returns true if this storage supports config persistence (false for in-memory) */
  supportsConfigPersistence(): boolean;
  /** Set (upsert) a config value by dot-path key */
  setConfigValue(key: string, value: string): Promise<void>;
  /** Delete a config value by dot-path key */
  deleteConfigValue(key: string): Promise<void>;
  /** Get all stored config values as a key-value record */
  getAllConfigValues(): Promise<Record<string, string>>;
}
