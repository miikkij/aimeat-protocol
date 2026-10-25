/**
 * @file src/config-extension-load.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's settings for how much load extensions may put on this node: the answer
 *   bytes one run's ctx.fetch calls may hold in flight together, the bytes one extension namespace
 *   may hold, and the number of instances one extension may have. Each is a row on the admin Config
 *   tab (services/config-schema-extension-load.ts), read on every use, so a saved value applies to
 *   the next run. 0 is "no limit" on every one of them.
 *
 *   Its own file because config.ts and config-types.ts are at the line ceiling; it imports nothing
 *   (config-decide.ts gives the reason).
 * @structure ExtensionLoadConfig · EXT_FETCH_INFLIGHT_MB_DEFAULT · extensionLoadDefaults()
 * @usage
 *   import { extensionLoadDefaults } from './config-extension-load.js';
 *   const config = { ...extensionLoadDefaults(), ... };
 * @version-history
 *   v1.1.0 — 2026-10-25 — extensionNamespaceMaxMb (AIMEAT_EXT_NAMESPACE_MAX_MB) and extensionMaxInstances
 *     (AIMEAT_EXT_MAX_INSTANCES), both no limit by default (secaudit2026oct22, lead 750).
 *   v1.0.0 — 2026-10-25 — Initial: extensionFetchInflightMb (AIMEAT_EXT_FETCH_INFLIGHT_MB), the
 *     in-flight fetch budget that was the constant EXT_FETCH_INFLIGHT_BYTES (secaudit2026oct22, lead 782).
 */

/** The in-flight fetch budget of one run when nothing sets it, in megabytes. */
export const EXT_FETCH_INFLIGHT_MB_DEFAULT = 128;

export interface ExtensionLoadConfig {
  /**
   * The most answer bytes, in megabytes, that one extension run's ctx.fetch calls may hold in
   * flight together; a call past it waits for a slot (services/extension-host-bounds.ts). 0: no limit.
   */
  extensionFetchInflightMb: number;
  /**
   * The most bytes, in megabytes, one extension namespace (`ext:{name}`, and each instance's
   * `ext:{name}.{id}`) may hold before ctx.memory.set refuses a NEW key; an existing key is still
   * updated (services/quota.ts). Separate from the owner's own memory limits. 0: no limit (the default).
   */
  extensionNamespaceMaxMb: number;
  /** The most instances one extension may have; POST /v1/extensions/:name/instances refuses past it. 0: no limit (the default). */
  extensionMaxInstances: number;
}

/** A whole number from 0 up from its raw env string; `fallback` when absent, not a number or negative. */
export function wholeFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function extensionLoadDefaults(): ExtensionLoadConfig {
  return {
    extensionFetchInflightMb: wholeFromEnv(process.env.AIMEAT_EXT_FETCH_INFLIGHT_MB, EXT_FETCH_INFLIGHT_MB_DEFAULT),
    extensionNamespaceMaxMb: wholeFromEnv(process.env.AIMEAT_EXT_NAMESPACE_MAX_MB, 0),
    extensionMaxInstances: wholeFromEnv(process.env.AIMEAT_EXT_MAX_INSTANCES, 0),
  };
}
