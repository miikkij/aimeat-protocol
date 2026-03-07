/**
 * CLI command: aimeat config export
 * Exports current config to various formats (env, ini, json, consul).
 */

import ini from 'ini';
import { CONFIG_FIELDS, serializeConfigValue } from '../services/config-schema.js';
import type { AimeatConfig } from '../config.js';
import { createConsulConfigService } from '../services/consul-config.js';

type ExportFormat = 'env' | 'ini' | 'json' | 'consul';

export async function runConfigExport(config: AimeatConfig, format: ExportFormat): Promise<void> {
  if (format === 'consul') {
    return exportToConsul(config);
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
    const value = config[field.key];
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
    const value = config[field.key];
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
    const value = config[field.key];
    if (value !== undefined && value !== null && value !== '') {
      result[section][key] = value;
    }
  }

  return JSON.stringify(result, null, 2) + '\n';
}

async function exportToConsul(config: AimeatConfig): Promise<void> {
  const consulService = createConsulConfigService(config);
  if (!consulService) {
    console.error('Error: Consul is not enabled. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL.');
    process.exit(1);
  }

  let exported = 0;
  for (const field of CONFIG_FIELDS) {
    if (field.immutable) continue;
    const value = config[field.key];
    if (value !== undefined && value !== null) {
      try {
        await consulService.set(field.dotPath, serializeConfigValue(value));
        exported++;
      } catch (err) {
        console.warn(`  Warning: Failed to export ${field.dotPath}: ${(err as Error).message}`);
      }
    }
  }

  console.log(`Exported ${exported} mutable config values to Consul KV`);
}
