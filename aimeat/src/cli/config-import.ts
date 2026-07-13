/**
 * @file src/cli/config-import.ts
 * @description CLI command `aimeat config import` — loads config values from a file or Consul KV,
 *   classifies them as mutable/immutable/unknown, and writes only the valid mutable ones into the
 *   persistent database after operator confirmation.
 *
 * @structure
 *   - classifyValues: splits incoming dot-path values into mutable/immutable/unknown via the config schema
 *   - confirm: readline Y/n prompt
 *   - runConfigImport(config, options): orchestrates source load → classify → confirm → storage.setConfigValue
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import { existsSync } from 'node:fs';
import * as readline from 'node:readline';
import { loadFileSource } from '../services/config-loader.js';
import { MUTABLE_CONFIG_MAP, isImmutable, parseConfigValue } from '../services/config-schema.js';
import { createConsulConfigService } from '../services/consul-config.js';
import { createStorage } from '../storage/storage-factory.js';
import type { AimeatConfig } from '../config.js';

interface ImportStats {
  mutable: string[];
  immutable: string[];
  unknown: string[];
}

function classifyValues(values: Record<string, string>): ImportStats {
  const mutable: string[] = [];
  const immutable: string[] = [];
  const unknown: string[] = [];

  for (const dotPath of Object.keys(values)) {
    const field = MUTABLE_CONFIG_MAP[dotPath];
    if (field) {
      // Validate the value can be parsed
      try {
        const parsed = parseConfigValue(field, values[dotPath]);
        if (field.validate(parsed)) {
          mutable.push(dotPath);
        } else {
          unknown.push(dotPath); // Valid field but invalid value
        }
      } catch {
        unknown.push(dotPath);
      }
    } else if (isImmutable(dotPath)) {
      immutable.push(dotPath);
    } else {
      unknown.push(dotPath);
    }
  }

  return { mutable, immutable, unknown };
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${message} [Y/n] `, answer => {
      rl.close();
      resolve(!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export async function runConfigImport(
  config: AimeatConfig,
  options: { file?: string; from?: string },
): Promise<void> {
  // Verify persistent storage
  if (config.storageProvider === 'memory') {
    console.error(`Error: Config import requires a persistent database (MongoDB or SQLite). Current storage: ${config.storageProvider}`);
    console.error('Tip: Start with --db sqlite or --db mongodb to enable config persistence.');
    process.exit(1);
  }

  let values: Record<string, string>;

  if (options.from === 'consul') {
    // Import from Consul KV
    const consulService = createConsulConfigService(config);
    if (!consulService) {
      console.error('Error: Consul is not enabled. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL.');
      process.exit(1);
    }
    console.log('Loading config from Consul KV...');
    values = await consulService.loadAll();
  } else if (options.file) {
    // Import from file
    if (!existsSync(options.file)) {
      console.error(`Error: File not found: ${options.file}`);
      process.exit(1);
    }
    console.log(`Loading config from ${options.file}...`);
    const fileSource = loadFileSource(options.file);
    if (!fileSource) {
      console.error(`Error: Could not parse config file: ${options.file}`);
      process.exit(1);
    }
    values = fileSource.values;
  } else {
    console.error('Error: Specify --file <path> or --from consul');
    process.exit(1);
  }

  if (Object.keys(values).length === 0) {
    console.log('No config values found. Nothing to import.');
    return;
  }

  // Classify values
  const stats = classifyValues(values);

  console.log(`\nFound ${Object.keys(values).length} config values:`);
  console.log(`  ${stats.mutable.length} mutable → will import to database`);
  console.log(`  ${stats.immutable.length} immutable → will skip (${stats.immutable.slice(0, 3).join(', ')}${stats.immutable.length > 3 ? ', ...' : ''})`);
  console.log(`  ${stats.unknown.length} unknown/invalid → will skip`);

  if (stats.mutable.length === 0) {
    console.log('\nNo mutable values to import.');
    return;
  }

  // Confirm
  const proceed = await confirm(`\nImport ${stats.mutable.length} mutable values to database?`);
  if (!proceed) {
    console.log('Cancelled.');
    return;
  }

  // Connect to storage and write
  const storage = await createStorage({
    provider: config.storageProvider,
    sqlitePath: config.sqlitePath,
    dbUrl: config.dbUrl ?? undefined,
  });

  let imported = 0;
  for (const dotPath of stats.mutable) {
    try {
      await storage.setConfigValue(dotPath, values[dotPath]);
      imported++;
    } catch (err) {
      console.warn(`  Warning: Failed to import ${dotPath}: ${(err as Error).message}`);
    }
  }

  console.log(`\nImported ${imported} values to database (${stats.immutable.length + stats.unknown.length} skipped)`);
}
