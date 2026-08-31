/**
 * @file src/services/consul-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Consul KV config service — loads, watches, and writes runtime config from HashiCorp
 *   Consul. Values are dot-path keyed under a prefix; only mutable fields are applied (immutable and
 *   host-sealed paths ignored).
 *
 * @structure
 *   - ConsulConfigService interface: loadAll / startWatching / stopWatching / set / health
 *   - createConsulConfigService(config): returns an instance, or null when Consul is disabled
 *   - polling watcher hashes loadAll() output to detect and dispatch config changes
 *
 * @version-history
 *   v1.2.0 — 2026-08-31 — Talks to Consul's HTTP API directly instead of through the `consul`
 *     package, which npm marks "no longer supported" and for which upstream names no successor.
 *     Three calls were all it was used for. NOT safeFetch, and that is the reason this could not
 *     just be moved: safeFetch refuses private and loopback addresses unless
 *     AIMEAT_ALLOW_PRIVATE_EGRESS is set, and a Consul agent is on one in every real deployment.
 *     The URL here is the operator's own AIMEAT_CONSUL_URL, not anything a request can influence,
 *     which is the carve-out security/outbound-fetch-exemptions.json exists for.
 *   (2026-08-28) Applies a value through writeConfigField, so a site-link row (siteLinks.<name>)
 *     lands one level down like every other row.
 *   v1.1.0 — 2026-08-18 — applyConsulValues skips a path the node's host sealed. One edit covers
 *     three callers, and the third is the one nobody had listed: the boot-time load, the import
 *     route, and the LIVE WATCH LOOP, which re-applies whatever the KV store says on every change
 *     without anybody asking. docs/plans/sealed-config-plan.md
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import { isImmutable, MUTABLE_CONFIG_MAP, parseConfigValue, writeConfigField } from './config-schema.js';
import { isSealed } from './config-sealing.js';
import { logger } from '../utils/logger.js';

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

/** One KV entry as Consul's HTTP API returns it: the value is base64. */
interface ConsulKvEntry { Key: string; Value: string | null }

export function createConsulConfigService(config: AimeatConfig): ConsulConfigService | null {
  if (!config.consulEnabled) return null;

  // Trailing slash removed once, so every call below can write `${base}/v1/...` without thinking.
  const base = config.consulUrl.replace(/\/+$/, '');

  /**
   * One call to the Consul agent. The token goes in a header and the datacenter in the query, which
   * is what the agent expects; a 404 is a real answer from a KV read (no keys under the prefix) and
   * is handed back as null rather than thrown.
   */
  async function consulFetch(
    path: string,
    init: RequestInit = {},
    query: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    if (config.consulDatacenter) url.searchParams.set('dc', config.consulDatacenter);
    const headers = new Headers(init.headers);
    if (config.consulToken) headers.set('X-Consul-Token', config.consulToken);
    return await fetch(url.toString(), { ...init, headers });
  }

  const prefix = config.consulPrefix.endsWith('/')
    ? config.consulPrefix
    : config.consulPrefix + '/';

  let watchTimer: ReturnType<typeof setInterval> | null = null;
  let lastHash = '';

  return {
    async loadAll(): Promise<Record<string, string>> {
      try {
        const res = await consulFetch(`/v1/kv/${prefix}`, {}, { recurse: 'true' });
        // 404 is how the KV store says "nothing under this prefix", not a failure.
        if (res.status === 404) return {};
        if (!res.ok) throw new Error(`Consul KV read → HTTP ${res.status}`);
        const keys = await res.json() as ConsulKvEntry[] | null;
        if (!keys) return {};
        const result: Record<string, string> = {};
        for (const entry of keys) {
          const dotPath = entry.Key.replace(prefix, '').replace(/\//g, '.');
          // A key with no value comes back as Value: null. Reading it as an empty string would
          // apply an empty setting; skipping it leaves the running value alone, which is what an
          // operator who created a key without a value meant.
          if (dotPath && entry.Value !== null && !isImmutable(dotPath)) {
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
        } catch (err) { logger.warn('startWatching: ignore watch errors', { error: String(err) }); }
      }, config.consulWatchIntervalSeconds * 1000);
    },

    stopWatching() {
      if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    },

    async set(key: string, value: string): Promise<void> {
      const consulKey = prefix + key.replace(/\./g, '/');
      const res = await consulFetch(`/v1/kv/${consulKey}`, { method: 'PUT', body: value });
      // Consul answers a KV write with the literal body `true` or `false`; a 200 carrying `false`
      // means the write was refused (a failed check-and-set, or an ACL that may read but not write)
      // and reporting that as success would lose the operator's edit in silence.
      if (!res.ok) throw new Error(`Consul KV write → HTTP ${res.status}`);
      if ((await res.text()).trim() !== 'true') {
        throw new Error(`Consul refused the write to ${consulKey}`);
      }
    },

    async health(): Promise<boolean> {
      try {
        const res = await consulFetch('/v1/agent/self');
        return res.ok;
      } catch (err) {
        logger.warn('health: continuing after a suppressed failure', { error: String(err) });
        return false;
      }
    },
  };
}

/**
 * Apply Consul values to runtime config.
 *
 * Used at startup, by the watch callback and by POST /v1/admin/consul/import, which is why the
 * sealed check belongs here rather than at the import door: the watch callback fires on its own, so
 * a rule enforced at that door only would be enforced on one of the three roads in.
 */
export function applyConsulValues(
  config: AimeatConfig,
  values: Record<string, string>,
): { applied: string[]; skipped: string[]; sealed: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  const sealed: string[] = [];
  for (const [dotPath, rawValue] of Object.entries(values)) {
    if (isSealed(config, dotPath)) { sealed.push(dotPath); continue; }
    const field = MUTABLE_CONFIG_MAP[dotPath];
    if (!field) { skipped.push(dotPath); continue; }
    try {
      const value = parseConfigValue(field, rawValue);
      if (!field.validate(value)) { skipped.push(dotPath); continue; }
      writeConfigField(config, field, value);
      applied.push(dotPath);
      // eslint-disable-next-line aimeat/no-silent-catch -- not silent: the key is reported to the caller in the returned `skipped` list
    } catch { skipped.push(dotPath); }
  }
  return { applied, skipped, sealed };
}
