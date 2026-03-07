/**
 * Unified config loader — reads values from env vars and config files.
 *
 * Each source normalizes to Record<string, string> keyed by dot-path.
 * Typed parsing happens later via parseConfigValue() when values are
 * applied to the AimeatConfig object.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_TO_DOT_PATH, isImmutable } from './config-schema.js';

/** Load env vars as raw string values keyed by dot-path */
export function loadEnvSource(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [envVar, dotPath] of Object.entries(ENV_TO_DOT_PATH)) {
    const val = process.env[envVar];
    if (val !== undefined) values[dotPath] = val;
  }
  return values;
}

/**
 * Load aimeat.ini or aimeat.json as raw string values keyed by dot-path.
 *
 * Search order:
 *  1. explicit configPath (from --config CLI arg)
 *  2. aimeat.ini in cwd
 *  3. aimeat.json in cwd
 *
 * Returns null if no config file found or parse fails.
 */
export function loadFileSource(configPath?: string): { name: string; values: Record<string, string> } | null {
  // Explicit path (from --config CLI arg)
  if (configPath) {
    const resolved = resolve(configPath);
    if (!existsSync(resolved)) return null;
    try {
      const raw = readFileSync(resolved, 'utf8');
      if (resolved.endsWith('.json')) {
        return { name: `file:${resolved}`, values: flattenToStrings(JSON.parse(raw)) };
      }
      // Assume INI for all other extensions (.ini, .conf, etc.)
      const parsed = parseSimpleIni(raw);
      return { name: `file:${resolved}`, values: flattenToStrings(parsed) };
    } catch { return null; }
  }

  const cwd = process.cwd();

  // Check aimeat.ini first
  const iniPath = resolve(cwd, 'aimeat.ini');
  if (existsSync(iniPath)) {
    try {
      const raw = readFileSync(iniPath, 'utf8');
      const parsed = parseSimpleIni(raw);
      return { name: `file:${iniPath}`, values: flattenToStrings(parsed) };
    } catch { /* ignore parse errors */ }
  }

  // Then aimeat.json
  const jsonPath = resolve(cwd, 'aimeat.json');
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      return { name: `file:${jsonPath}`, values: flattenToStrings(parsed) };
    } catch { /* ignore parse errors */ }
  }

  return null;
}

/**
 * Flatten a nested object into dot-path keys with raw string values.
 * Used for both INI and JSON sources — consistent serialization.
 */
export function flattenToStrings(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      Object.assign(result, flattenToStrings(val as Record<string, unknown>, path));
    } else {
      result[path] = String(val);
    }
  }
  return result;
}

/** Filter out immutable fields from a config values map */
export function filterMutableOnly(values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!isImmutable(k)) result[k] = v;
  }
  return result;
}

// ── Minimal INI Parser ──
// Supports [section] headers and key=value pairs.
// Avoids external dependency — when the `ini` package is available (Task 12)
// this can be swapped for `parse()` from 'ini'.

/**
 * Parse a simple INI file into a nested object.
 * Supports [section] headers (mapped to dot-path parents) and key=value lines.
 * Comments start with ; or #. Inline comments are stripped.
 */
export function parseSimpleIni(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection = '';

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    // Section header: [section_name]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    // Key=value pair
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.substring(0, eqIdx).trim();
    let value = line.substring(eqIdx + 1).trim();

    // Strip inline comments (but not if inside quotes)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIdx = value.search(/\s[;#]/);
      if (commentIdx >= 0) value = value.substring(0, commentIdx).trim();
    } else {
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
    }

    // Place into nested structure
    if (currentSection) {
      if (!result[currentSection] || typeof result[currentSection] !== 'object') {
        result[currentSection] = {};
      }
      (result[currentSection] as Record<string, unknown>)[key] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}
