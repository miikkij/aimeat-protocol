/**
 * @file env-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CLI config display — shows all settings with current values, defaults,
 *   and descriptions. Usage: aimeat config. Section definitions live in ./env-config/*.
 * @version-history
 *   v1.0.1 — 2026-06-20 — Add App Origin Isolation (H-2) section
 *     (AIMEAT_APP_ORIGIN_ENABLED, AIMEAT_APP_HOST).
 *   v1.1.0 — 2026-07-13 — Extract section definitions into ./env-config/* (max-file-lines).
 */

import { existsSync } from 'node:fs';
import type { AimeatConfig } from '../config.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import { ENV_TO_DOT_PATH } from '../services/config-schema.js';
import type { ConfigSection } from './env-config/shared.js';
import { nodeSections } from './env-config/sections-node.js';
import { federationSections } from './env-config/sections-federation.js';
import { featureSections } from './env-config/sections-features.js';
import { platformSections } from './env-config/sections-platform.js';

export function formatConfig(config: AimeatConfig, provenance?: ConfigProvenance): string {
  const env = process.env;

  const sections: ConfigSection[] = [
    ...nodeSections(config),
    ...federationSections(config),
    ...featureSections(config),
    ...platformSections(config),
  ];

  const lines: string[] = [];
  lines.push('');
  lines.push('  AIMEAT Node Configuration');
  lines.push('  ══════════════════════════════════════════════════════');

  const envFile = existsSync('.env');
  const iniFile = existsSync('aimeat.ini');
  const jsonFile = existsSync('aimeat.json');
  const sources: string[] = [];
  if (envFile) sources.push('.env');
  if (iniFile) sources.push('aimeat.ini');
  if (jsonFile) sources.push('aimeat.json');
  if (provenance) sources.push('database');
  if (sources.length > 0) {
    lines.push(`  Sources: ${sources.join(', ')}`);
  } else {
    lines.push('  Sources: environment variables only (no .env or config file found)');
  }
  lines.push(`  Precedence: database > consul > file > .env > defaults`);
  lines.push('');

  for (const section of sections) {
    lines.push(`  ${section.title}`);
    lines.push('  ' + '─'.repeat(52));

    for (const entry of section.entries) {
      // Determine source tag
      let tag: string;
      if (provenance) {
        const dotPath = ENV_TO_DOT_PATH[entry.envVar];
        const src = dotPath ? provenance.getSource(dotPath) : 'default';
        tag = entry.secret ? '' : ` [${src}]`;
      } else {
        const isDefault = !entry.secret && entry.value === entry.defaultVal;
        const isExplicit = !isDefault && env[entry.envVar] !== undefined;
        tag = entry.secret ? '' : isExplicit ? ' (set)' : ' (default)';
      }

      lines.push(`    ${entry.envVar}${tag}`);
      lines.push(`      ${entry.description}`);
      lines.push(`      Value: ${entry.value}`);
      lines.push('');
    }
  }

  lines.push('  ══════════════════════════════════════════════════════');
  lines.push('  To change a setting, use one of these methods:');
  lines.push('    1. Admin dashboard (persisted to database)');
  lines.push('    2. Edit aimeat.ini or aimeat.json in your node directory');
  lines.push('    3. Edit the .env file');
  lines.push('  Run "aimeat validate" to check for problems.');
  lines.push('');

  return lines.join('\n');
}
