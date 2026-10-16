/**
 * @file src/config-consul.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Consul settings block of the node config, read from the environment. Moved
 *   unchanged out of config.ts when that file reached the 800-line limit; spread into the config
 *   object literal by loadConfig().
 * @structure consulDefaults()
 * @usage `...consulDefaults()` inside loadConfig()
 * @version-history
 *   v1.0.0 — 2026-10-16 — Moved from config.ts (pure extraction, max-file-lines), to make room for the start check (QA audit D8-02).
 */

import type { AimeatConfig } from './config-types.js';

type ConsulConfig = Pick<AimeatConfig,
  'consulEnabled' | 'consulUrl' | 'consulPrefix' | 'consulToken' | 'consulWatchIntervalSeconds' | 'consulDatacenter'>;

/** The Consul block, read from process.env at call time. */
export function consulDefaults(): ConsulConfig {
  return {
    consulEnabled: process.env.AIMEAT_CONSUL_ENABLED === 'true',
    consulUrl: process.env.AIMEAT_CONSUL_URL ?? 'http://localhost:8500',
    consulPrefix: process.env.AIMEAT_CONSUL_PREFIX ?? 'aimeat/config',
    consulToken: process.env.AIMEAT_CONSUL_TOKEN ?? '',
    consulWatchIntervalSeconds: parseInt(process.env.AIMEAT_CONSUL_WATCH_INTERVAL ?? '30', 10),
    consulDatacenter: process.env.AIMEAT_CONSUL_DATACENTER ?? '',
  };
}
