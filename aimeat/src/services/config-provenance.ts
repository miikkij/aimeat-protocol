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
 *   - awaitsRestart: whether a removed override's value is still the running one
 *
 * @version-history
 *   v1.1.0 — 2026-10-11 — awaitsRestart(): a path whose database override was removed since start
 *     keeps its running value until a restart, and the Config tab says so (Jouni, 2026-10-11).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

export type ConfigSource = 'default' | 'env' | 'file' | 'consul' | 'database';

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
   * True when the path's database override was removed since start and nothing has written the
   * running value since: the node still runs with the removed value, until a restart.
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
