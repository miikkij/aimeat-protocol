/**
 * @file src/storage/repositories/config.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-layer interface for persisting admin-editable config values (keyed by dot-path,
 *   stored under a "config:" prefix in the backend), implemented per backend (SQLite / Prisma).
 *
 * @structure
 *   - ConfigRepository: supportsConfigPersistence + get/set/delete a single value + getAll values
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
export interface ConfigRepository {
  /** Returns true if this storage supports config persistence (false for in-memory) */
  supportsConfigPersistence(): boolean;
  /** Get a single config value by dot-path key */
  getConfigValue(key: string): Promise<string | null>;
  /** Set (upsert) a config value by dot-path key */
  setConfigValue(key: string, value: string): Promise<void>;
  /** Delete a config value by dot-path key */
  deleteConfigValue(key: string): Promise<void>;
  /** Get all stored config values as a key-value record */
  getAllConfigValues(): Promise<Record<string, string>>;
}
