/**
 * @file src/services/config-schema-extension-load.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Config-tab rows for the operator's limits on extension load (config-extension-load.ts):
 *   the answer bytes one run's ctx.fetch calls may hold in flight together, the bytes one extension
 *   namespace may hold, the instances one extension may have and the ctx.email messages one account's
 *   extensions may send in an hour. Under the `extensions`
 *   group of the Config tab. Stored in the database and read on every use, so a saved value applies
 *   to the next run; 0 is "no limit" on every row.
 * @structure EXTENSION_LOAD_CONFIG_FIELDS
 * @version-history
 *   v1.2.0 — 2026-10-25 — extensions.email_per_hour (secaudit2026oct22, lead 325).
 *   v1.1.0 — 2026-10-25 — extensions.namespace_max_mb and extensions.max_instances (secaudit2026oct22, lead 750).
 *   v1.0.0 — 2026-10-25 — Initial: extensions.fetch_inflight_mb (secaudit2026oct22, lead 782).
 */
// Typed by the keys alone, not AimeatConfig, which would close an import cycle through
// config-types.ts; config-schema.ts checks each key against AimeatConfig where it spreads the rows.
import type { ConfigFieldShape } from './config-field-def.js';

const whole = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;

type ExtensionLoadKey = 'extensionFetchInflightMb' | 'extensionNamespaceMaxMb' | 'extensionMaxInstances' | 'extensionEmailPerHour';

export const EXTENSION_LOAD_CONFIG_FIELDS: ConfigFieldShape<ExtensionLoadKey>[] = [
  { key: 'extensionFetchInflightMb', dotPath: 'extensions.fetch_inflight_mb', envVar: 'AIMEAT_EXT_FETCH_INFLIGHT_MB', type: 'number', validate: whole, immutable: false, description: 'Most answer data one extension run\'s fetches may hold at the same time, in megabytes; a fetch past it waits for an earlier one to finish (default 128, 0 is no limit)', range: '0-4096' },
  // Separate from the owner's own memory limits (quota.memory_mb): an extension's namespace belongs to
  // the extension, not to a person (Jouni, 2026-10-25).
  { key: 'extensionNamespaceMaxMb', dotPath: 'extensions.namespace_max_mb', envVar: 'AIMEAT_EXT_NAMESPACE_MAX_MB', type: 'number', validate: whole, immutable: false, description: 'Most data one extension\'s memory may hold, in megabytes, each copy of an extension counted on its own. Past it a new key is refused and an existing key is still updated. Separate from people\'s own memory limits (default 0, no limit)', range: '0-100000' },
  { key: 'extensionMaxInstances', dotPath: 'extensions.max_instances', envVar: 'AIMEAT_EXT_MAX_INSTANCES', type: 'number', validate: whole, immutable: false, description: 'Most copies (instances) one extension may have; past it a new copy is refused (default 0, no limit)', range: '0-10000' },
  // A fair or an expo may need far more than the default; the operator raises it or sets 0 (Jouni, 2026-10-25).
  { key: 'extensionEmailPerHour', dotPath: 'extensions.email_per_hour', envVar: 'AIMEAT_EXT_EMAIL_PER_HOUR', type: 'number', validate: whole, immutable: false, description: 'Most emails one account\'s extensions may send in an hour through ctx.email, all its extensions together; past it a send is refused until the hour turns (default 200, 0 is no limit)', range: '0-1000000' },
];
