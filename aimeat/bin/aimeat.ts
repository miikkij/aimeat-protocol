#!/usr/bin/env node
/**
 * AIMEAT CLI entry point.
 * Delegates to src/index.ts — this file exists as the canonical
 * bin/ binary per the implementation specification (§2).
 */
import { existsSync } from 'node:fs';

// Auto-load .env from CWD if present (Node 20.12+)
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Dynamic import so .env is loaded before index.ts runs
await import('../src/index.js');
