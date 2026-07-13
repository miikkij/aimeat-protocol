/**
 * @file src/cli/init-wizard/helpers.ts
 * @description Env-file parsing, cancel handling, and input validators for the `aimeat init` wizard. Extracted from src/cli/init-wizard.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/cli/init-wizard.ts (max-file-lines)
 */

import { existsSync, readFileSync } from 'node:fs';
import * as p from '@clack/prompts';
import type { TFunction } from '../../i18n.js';
import { validateNodeId } from '../../utils/gaii.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse a .env file into key-value pairs (ignores comments, handles quotes). */
export function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(path)) return result;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Handle quoted values: extract content between first pair of quotes
    if (val.startsWith('"')) {
      const closeIdx = val.indexOf('"', 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else if (val.startsWith("'")) {
      const closeIdx = val.indexOf("'", 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else {
      // Unquoted: strip inline comments
      const hashIdx = val.indexOf('#');
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    result[key] = val;
  }
  return result;
}

export function bail(t: TFunction): never {
  p.cancel(t('init.cancelled'));
  process.exit(0);
}

export function checkCancel<T>(value: T | symbol, t: TFunction): T {
  if (p.isCancel(value)) bail(t);
  return value as T;
}

// Note: @clack/prompts calls validate() with undefined when input is empty,
// BEFORE applying defaultValue. So all validators must allow empty/undefined
// when a defaultValue is set (the prompt handles it).

export function validatePort(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;  // empty = will use defaultValue
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 65535) return t('init.portInvalid');
}

export function validateNodeIdInput(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;  // empty = will use defaultValue
  if (validateNodeId(val) !== null) return t('init.nodeIdInvalid');
}

export function validateUrl(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    return t('init.baseUrlInvalid');
  }
}

export function validateDbUrl(val: string | undefined, t: TFunction, backend: 'mongodb' | 'postgresql' = 'mongodb'): string | undefined {
  if (!val) return;
  const ok = backend === 'postgresql'
    ? (val.startsWith('postgresql://') || val.startsWith('postgres://'))
    : (val.startsWith('mongodb://') || val.startsWith('mongodb+srv://'));
  if (!ok) {
    return t('init.dbUrlInvalid');
  }
}

export function validatePositiveNum(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  const n = Number(val);
  if (isNaN(n) || n < 0) return t('init.numInvalid');
}

export function validateBurnRate(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  const n = parseFloat(val);
  if (isNaN(n) || n < 0 || n > 1) return t('init.burnRateInvalid');
}
