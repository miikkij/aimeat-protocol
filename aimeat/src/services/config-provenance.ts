/**
 * Config Provenance Registry — tracks where each config value originated.
 *
 * Built during startup as each config source layer is applied:
 *   1. defaults → 2. env → 3. file → 4. consul → 5. database
 *
 * Updated at runtime when admin writes change values.
 */

export type ConfigSource = 'default' | 'env' | 'file' | 'consul' | 'database';

export class ConfigProvenance {
  private sources = new Map<string, ConfigSource>();

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
    for (const p of dotPaths) this.sources.set(p, 'consul');
  }

  /** Mark fields that were loaded from database */
  markDatabase(dotPaths: string[]): void {
    for (const p of dotPaths) this.sources.set(p, 'database');
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
    if (consulValueExists) this.sources.set(dotPath, 'consul');
    else if (fileValueExists) this.sources.set(dotPath, 'file');
    else if (envVarExists) this.sources.set(dotPath, 'env');
    else this.sources.set(dotPath, 'default');
  }
}
