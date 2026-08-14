/**
 * @file src/utils/env-config/shared.ts
 * @description Shared ConfigEntry/ConfigSection types + secret-masking helpers for the `aimeat config` display. Extracted from src/utils/env-config.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from env-config.ts (max-file-lines)
 */

export interface ConfigEntry {
  envVar: string;
  description: string;
  value: string;
  defaultVal: string;
  secret?: boolean;
}

export interface ConfigSection {
  title: string;
  entries: ConfigEntry[];
}

export function mask(val: string): string {
  if (val.length <= 4) return '****';
  return val.slice(0, 2) + '*'.repeat(val.length - 4) + val.slice(-2);
}

export function maskUrl(url: string): string {
  return url.replace(/\/\/([^@]+)@/, '//*****@');
}
