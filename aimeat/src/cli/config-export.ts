/**
 * @file src/cli/config-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CLI command `aimeat config export` — serializes the current AimeatConfig into
 *   env, ini, json, or writes mutable values to Consul KV, using CONFIG_FIELDS metadata.
 *
 * @structure
 *   - runConfigExport: dispatches on format (env/ini/json/consul)
 *   - exportToEnv/exportToIni/exportToJson: render config to the respective text format
 *   - exportToConsul: pushes mutable (non-immutable) config values into Consul KV, secret rows only
 *     with --include-secrets (services/consul-export.ts)
 *
 * @version-history
 *   v1.1.0 — 2026-10-09 — The Consul export uses services/consul-export.ts, the route's plan: sealed
 *     paths and secret rows stay out, the secrets only with --include-secrets (secrets audit
 *     2026-10-09, S3). The env, ini and json formats are unchanged: they are the host's own backup.
 *   (2026-08-28) Reads a row's value through readConfigField, so the site-link rows
 *     (siteLinks.<name>) export like every other row.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

/**
 * CLI command: aimeat config export
 * Exports current config to various formats (env, ini, json, consul).
 */

import ini from 'ini';
import { CONFIG_FIELDS, serializeConfigValue, readConfigField } from '../services/config-schema.js';
import type { AimeatConfig } from '../config.js';
import { createConsulConfigService } from '../services/consul-config.js';
import { planConsulExport } from '../services/consul-export.js';

type ExportFormat = 'env' | 'ini' | 'json' | 'consul';

export async function runConfigExport(
  config: AimeatConfig, format: ExportFormat, opts: { includeSecrets?: boolean } = {},
): Promise<void> {
  if (format === 'consul') {
    return exportToConsul(config, opts.includeSecrets === true);
  }

  const output = format === 'env'
    ? exportToEnv(config)
    : format === 'ini'
      ? exportToIni(config)
      : exportToJson(config);

  process.stdout.write(output);
}

function exportToEnv(config: AimeatConfig): string {
  const lines: string[] = ['# AIMEAT configuration (exported)', ''];
  let lastSection = '';

  for (const field of CONFIG_FIELDS) {
    const section = field.dotPath.split('.')[0];
    if (section !== lastSection) {
      if (lastSection) lines.push('');
      lines.push(`# ${section}`);
      lastSection = section;
    }
    const value = readConfigField(config, field);
    if (value !== undefined && value !== null && value !== '') {
      lines.push(`${field.envVar}=${serializeConfigValue(value)}`);
    }
  }

  return lines.join('\n') + '\n';
}

function exportToIni(config: AimeatConfig): string {
  const sections: Record<string, Record<string, string>> = {};

  for (const field of CONFIG_FIELDS) {
    const parts = field.dotPath.split('.');
    const section = parts.length > 1 ? parts.slice(0, -1).join('.') : 'node';
    const key = parts[parts.length - 1];

    if (!sections[section]) sections[section] = {};
    const value = readConfigField(config, field);
    if (value !== undefined && value !== null && value !== '') {
      sections[section][key] = serializeConfigValue(value);
    }
  }

  return '; AIMEAT configuration (exported)\n\n' + ini.stringify(sections);
}

function exportToJson(config: AimeatConfig): string {
  const result: Record<string, Record<string, unknown>> = {};

  for (const field of CONFIG_FIELDS) {
    const parts = field.dotPath.split('.');
    const section = parts.length > 1 ? parts[0] : 'node';
    const key = parts.length > 1 ? parts.slice(1).join('_') : parts[0];

    if (!result[section]) result[section] = {};
    const value = readConfigField(config, field);
    if (value !== undefined && value !== null && value !== '') {
      result[section][key] = value;
    }
  }

  return JSON.stringify(result, null, 2) + '\n';
}

async function exportToConsul(config: AimeatConfig, includeSecrets: boolean): Promise<void> {
  const consulService = createConsulConfigService(config);
  if (!consulService) {
    console.error('Error: Consul is not enabled. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL.');
    process.exit(1);
  }

  // The same plan the operator's POST /v1/admin/consul/export writes: sealed paths out, and the
  // secret rows out unless --include-secrets was given (secrets audit 2026-10-09, S3).
  const plan = planConsulExport(config, { includeSecrets });
  let exported = 0;
  for (const { path, value } of plan.entries) {
    try {
      await consulService.set(path, value);
      exported++;
    } catch (err) {
      console.warn(`  Warning: Failed to export ${path}: ${(err as Error).message}`);
    }
  }

  console.log(`Exported ${exported} mutable config values to Consul KV`);
  if (plan.secretsSkipped > 0) {
    console.log(`Left out ${plan.secretsSkipped} secret value(s) (AI keys, TURN). Run again with --include-secrets to write them to Consul KV as well.`);
  }
}
