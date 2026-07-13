/**
 * @file src/services/consul-config.ts
 * @description Consul KV config service — loads, watches, and writes runtime config from HashiCorp
 *   Consul. Values are dot-path keyed under a prefix; only mutable fields are applied (immutable ignored).
 *
 * @structure
 *   - ConsulConfigService interface: loadAll / startWatching / stopWatching / set / health
 *   - createConsulConfigService(config): returns an instance, or null when Consul is disabled
 *   - polling watcher hashes loadAll() output to detect and dispatch config changes
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import Consul from 'consul';
import type { AimeatConfig } from '../config.js';
import { isImmutable, MUTABLE_CONFIG_MAP, parseConfigValue } from './config-schema.js';

export interface ConsulConfigService {
  /** Load all config values from Consul KV (mutable only, raw strings) */
  loadAll(): Promise<Record<string, string>>;
  /** Start watching for changes */
  startWatching(onUpdate: (changes: Record<string, string>) => void): void;
  /** Stop watching */
  stopWatching(): void;
  /** Write a config value to Consul */
  set(key: string, value: string): Promise<void>;
  /** Check connectivity */
  health(): Promise<boolean>;
}

export function createConsulConfigService(config: AimeatConfig): ConsulConfigService | null {
  if (!config.consulEnabled) return null;

  const parsedUrl = new URL(config.consulUrl);
  const consul = new Consul({
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port || '8500', 10),
    secure: config.consulUrl.startsWith('https'),
    defaults: {
      token: config.consulToken || undefined,
      dc: config.consulDatacenter || undefined,
    },
  });

  const prefix = config.consulPrefix.endsWith('/')
    ? config.consulPrefix
    : config.consulPrefix + '/';

  let watchTimer: ReturnType<typeof setInterval> | null = null;
  let lastHash = '';

  return {
    async loadAll(): Promise<Record<string, string>> {
      try {
        const keys = await consul.kv.get({ key: prefix, recurse: true }) as Array<{ Key: string; Value: string }> | undefined;
        if (!keys) return {};
        const result: Record<string, string> = {};
        for (const entry of keys) {
          const dotPath = entry.Key.replace(prefix, '').replace(/\//g, '.');
          if (dotPath && !isImmutable(dotPath)) {
            result[dotPath] = Buffer.from(entry.Value, 'base64').toString('utf8');
          }
        }
        return result;
      } catch (err) {
        console.warn('[consul] Failed to load config:', (err as Error).message);
        return {};
      }
    },

    startWatching(onUpdate) {
      watchTimer = setInterval(async () => {
        try {
          const values = await this.loadAll();
          const hash = JSON.stringify(values);
          if (hash !== lastHash) {
            lastHash = hash;
            onUpdate(values);
          }
        } catch { /* ignore watch errors */ }
      }, config.consulWatchIntervalSeconds * 1000);
    },

    stopWatching() {
      if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    },

    async set(key: string, value: string): Promise<void> {
      const consulKey = prefix + key.replace(/\./g, '/');
      await consul.kv.set(consulKey, value);
    },

    async health(): Promise<boolean> {
      try {
        await consul.agent.self();
        return true;
      } catch { return false; }
    },
  };
}

/**
 * Apply Consul values to runtime config.
 * Used both at startup and by the watch callback.
 */
export function applyConsulValues(
  config: AimeatConfig,
  values: Record<string, string>,
): { applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [dotPath, rawValue] of Object.entries(values)) {
    const field = MUTABLE_CONFIG_MAP[dotPath];
    if (!field) { skipped.push(dotPath); continue; }
    try {
      const value = parseConfigValue(field, rawValue);
      if (!field.validate(value)) { skipped.push(dotPath); continue; }
      (config as unknown as Record<string, unknown>)[field.key] = value;
      applied.push(dotPath);
    } catch { skipped.push(dotPath); }
  }
  return { applied, skipped };
}
