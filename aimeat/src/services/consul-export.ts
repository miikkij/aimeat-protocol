/**
 * @file src/services/consul-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which config values a push to Consul KV writes. One answer for both callers: the
 *   operator's POST /v1/admin/consul/export (routes/admin-config.ts) and the CLI
 *   `aimeat config export --format consul` (cli/config-export.ts), which each had their own loop.
 *   Secret rows stay out unless the operator asks for them (secrets audit 2026-10-09, S3).
 * @structure ConsulExportPlan · planConsulExport
 * @usage const plan = planConsulExport(config, { includeSecrets: false });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial: the loop of the two callers, in one place, with secret rows left
 *     out unless `includeSecrets` is true.
 */
import type { AimeatConfig } from '../config.js';
import { MUTABLE_CONFIG_MAP, serializeConfigValue, readConfigField } from './config-schema.js';
import { isSealed, isSecretField } from './config-sealing.js';

export interface ConsulExportPlan {
  /** dot-path → serialized value, in the order of the schema. */
  entries: Array<{ path: string; value: string }>;
  /** Sealed paths left out: a sealed value in KV looks editable there and is discarded on import. */
  sealedSkipped: number;
  /** Secret rows left out because the caller did not ask for them. */
  secretsSkipped: number;
  total: number;
}

/**
 * The values to write. A secret row (isSecretField, the test every read door uses) is left out
 * unless `includeSecrets` is true: anyone who can read the KV store could read the node's AI keys
 * and TURN credential otherwise (secrets audit 2026-10-09, S3). The operator passes it on purpose:
 * `include_secrets: true` on the route, `--include-secrets` on the CLI.
 */
export function planConsulExport(config: AimeatConfig, opts: { includeSecrets?: boolean } = {}): ConsulExportPlan {
  const entries: ConsulExportPlan['entries'] = [];
  let sealedSkipped = 0;
  let secretsSkipped = 0;
  for (const [path, field] of Object.entries(MUTABLE_CONFIG_MAP)) {
    if (isSealed(config, path)) { sealedSkipped++; continue; }
    if (isSecretField(field) && opts.includeSecrets !== true) { secretsSkipped++; continue; }
    const value = readConfigField(config, field);
    if (value === undefined || value === null) continue;
    entries.push({ path, value: serializeConfigValue(value) });
  }
  return { entries, sealedSkipped, secretsSkipped, total: Object.keys(MUTABLE_CONFIG_MAP).length };
}
