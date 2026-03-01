#!/usr/bin/env node
/**
 * AIMEAT CLI entry point.
 * Delegates to src/index.ts — this file exists as the canonical
 * bin/ binary per the implementation specification (§2).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Auto-load .env: try CWD first, then the package directory (aimeat/)
// From dist/bin/aimeat.js -> go up 2 levels to aimeat/
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..', '..');

if (existsSync('.env')) {
  process.loadEnvFile('.env');
} else if (existsSync(join(pkgRoot, '.env'))) {
  process.loadEnvFile(join(pkgRoot, '.env'));
}

// Dynamic import so .env is loaded before index.ts runs
await import('../src/index.js');
