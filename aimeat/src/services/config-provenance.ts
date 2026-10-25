/**
 * @file src/services/config-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Config Provenance Registry — tracks which source layer each config dot-path came
 *   from (defaults → env → file → consul → database), built at startup and updated on runtime writes.
 *
 * @structure
 *   - ConfigSource: the provenance layer union type
 *   - ConfigProvenance: registry with initDefaults + markEnv/markFile/markConsul/markDatabase setters
 *   - getSource / getAll: read a field's source or the whole map
 *   - revertSource: recompute a field's source down the precedence chain after a DB override is removed
 *   - markDatabaseAtRestart: a saved value that takes effect at the next start
 *   - awaitsRestart: whether the running value differs from the one the next start uses
 *
 * @version-history
 *   v1.2.0 — 2026-10-25 — markDatabaseAtRestart(): a value saved for a row that takes effect at the
 *     next start is the database's, and the running value stays until a restart; markConsulAtRestart
 *     is the same for a value the Consul watch brings while the node runs. bindConfigProvenance
 *     / provenanceOf: the MCP tools find the registry the admin Config API uses.
 *   v1.1.0 — 2026-10-11 — awaitsRestart(): a path whose database override was removed since start
 *     keeps its running value until a restart, and the Config tab says so (Jouni, 2026-10-11).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

export type ConfigSource = 'default' | 'env' | 'file' | 'consul' | 'database';

/**
 * The registry of each running config, so a caller that holds the config and not the registry (the
 * MCP tools aimeat_admin_config and aimeat_admin_config_set) reads and marks the same sources the
 * admin Config API does. Keyed weakly: a config that is gone takes its registry with it.
 */
const registries = new WeakMap<object, ConfigProvenance>();
export function bindConfigProvenance(config: object, provenance: ConfigProvenance): void { registries.set(config, provenance); }
export function provenanceOf(config: object): ConfigProvenance | undefined { return registries.get(config); }

export class ConfigProvenance {
  private sources = new Map<string, ConfigSource>();
  /**
   * Paths whose database override was removed since this process started. Removing an override
   * does not change the running value: the node keeps it until a restart reads the value below it
   * again. Kept in memory on purpose, because a restart is what ends the state.
   */
  private awaitingRestart = new Set<string>();

  /** Mark all given dot-paths as coming from defaults */
  initDefaults(dotPaths: string[]): void {
    for (const p of dotPaths) this.sources.set(p, 'default');
  }

  /** Mark fields that were overridden by env vars */
  markEnv(dotPaths: string[]): void {
    for (const p of dotPaths) this.sources.set(p, 'env');
  }

  /** Mark fields that were overridden by file config (aimeat.ini / aimeat.json) */
  markFile(dotPaths: string[]): void {
    for (const p of dotPaths) this.sources.set(p, 'file');
  }

  /** Mark fields that came from Consul KV */
  markConsul(dotPaths: string[]): void {
    for (const p of dotPaths) { this.sources.set(p, 'consul'); this.awaitingRestart.delete(p); }
  }

  /** Mark fields that were loaded from database */
  markDatabase(dotPaths: string[]): void {
    for (const p of dotPaths) { this.sources.set(p, 'database'); this.awaitingRestart.delete(p); }
  }

  /**
   * A value saved to the database for a row that takes effect at the next start (`applies:
   * 'restart'`): the source is the database from then on, and the running value stays the old one
   * until the node restarts, which awaitsRestart() reports.
   */
  markDatabaseAtRestart(dotPaths: string[]): void {
    for (const p of dotPaths) { this.sources.set(p, 'database'); this.awaitingRestart.add(p); }
  }

  /** The same for a value the Consul watch brought while the node runs (it is not stored). */
  markConsulAtRestart(dotPaths: string[]): void {
    for (const p of dotPaths) { this.sources.set(p, 'consul'); this.awaitingRestart.add(p); }
  }

  /**
   * True when the running value is not the one the node starts with next time: the path's database
   * override was removed since start, or a value was saved for a row that takes effect at the next
   * start. Nothing has written the running value since.
   */
  awaitsRestart(dotPath: string): boolean {
    return this.awaitingRestart.has(dotPath);
  }

  /** Get the source for a specific field (unknown fields default to 'default') */
  getSource(dotPath: string): ConfigSource {
    return this.sources.get(dotPath) ?? 'default';
  }

  /** Get all sources as a plain record for serialization */
  getAll(): Record<string, ConfigSource> {
    return Object.fromEntries(this.sources);
  }

  /**
   * Recalculate source for a field after its DB override is deleted.
   * Falls back through the precedence chain: consul → file → env → default.
   */
  revertSource(dotPath: string, envVarExists: boolean, fileValueExists: boolean, consulValueExists: boolean): void {
    if (this.sources.get(dotPath) === 'database') this.awaitingRestart.add(dotPath);
    if (consulValueExists) this.sources.set(dotPath, 'consul');
    else if (fileValueExists) this.sources.set(dotPath, 'file');
    else if (envVarExists) this.sources.set(dotPath, 'env');
    else this.sources.set(dotPath, 'default');
  }
}
