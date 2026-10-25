/**
 * @file src/services/config-schema-extension-load.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Config-tab rows for the operator's limits on extension load (config-extension-load.ts):
 *   the answer bytes one run's ctx.fetch calls may hold in flight together. Under the `extensions`
 *   group of the Config tab. Stored in the database and read on every use, so a saved value applies
 *   to the next run; 0 is "no limit" on every row.
 * @structure EXTENSION_LOAD_CONFIG_FIELDS
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial: extensions.fetch_inflight_mb (secaudit2026oct22, lead 782).
 */
// Typed by the keys alone, not AimeatConfig, which would close an import cycle through
// config-types.ts; config-schema.ts checks each key against AimeatConfig where it spreads the rows.
import type { ConfigFieldShape } from './config-field-def.js';

const whole = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;

type ExtensionLoadKey = 'extensionFetchInflightMb';

export const EXTENSION_LOAD_CONFIG_FIELDS: ConfigFieldShape<ExtensionLoadKey>[] = [
  { key: 'extensionFetchInflightMb', dotPath: 'extensions.fetch_inflight_mb', envVar: 'AIMEAT_EXT_FETCH_INFLIGHT_MB', type: 'number', validate: whole, immutable: false, description: 'Most answer data one extension run\'s fetches may hold at the same time, in megabytes; a fetch past it waits for an earlier one to finish (default 128, 0 is no limit)', range: '0-4096' },
];
