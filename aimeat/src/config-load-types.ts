/**
 * @file src/config-load-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What loadConfig() takes and returns. Moved out of config-types.ts (pure extraction,
 *   max-file-lines) when the result gained the settings the start set aside; config.ts re-exports
 *   both, so no importer changes.
 * @structure LoadConfigOptions · LoadConfigResult
 * @usage import type { LoadConfigOptions, LoadConfigResult } from './config.js';
 * @version-history
 *   v1.0.0 — 2026-10-16 — Moved from config-types.ts; LoadConfigResult gains `settingFallbacks` (Jouni,
 *     decision 2026-10-16: a setting the node does not accept runs its default and is recorded).
 */
import type { AimeatConfig } from './config-types.js';
import type { StartSettingFallback } from './config-start-check.js';

export interface LoadConfigOptions {
  /** Path to config file (from --config CLI arg) */
  configPath?: string;
  /** CLI bootstrap overrides keyed by dot-path (e.g. { 'node.port': '8080' }) */
  cliOverrides?: Record<string, string>;
  /**
   * Set aside a setting the node does not accept and run its default (config-start-check.ts). Default
   * true. `aimeat validate`, `aimeat init` and `aimeat config` pass false: they show or repair the
   * environment as it is.
   */
  checkSettings?: boolean;
}

export interface LoadConfigResult {
  config: AimeatConfig;
  /** Dot-paths that resolved from env vars */
  envKeys: string[];
  /** Dot-paths that resolved from file config (aimeat.ini / aimeat.json) */
  fileKeys: string[];
  /** Dot-paths that resolved from CLI args */
  cliKeys: string[];
  /** Name of the file source (e.g. 'file:/path/to/aimeat.ini'), null if no file found */
  fileName: string | null;
  /**
   * The settings whose value the node did not accept, each with the default it runs on instead. The
   * server opens one Security page incident per setting (services/config-setting-incidents.ts).
   */
  settingFallbacks: StartSettingFallback[];
}
