/**
 * @file src/services/workflow/engine-util.ts
 * @description Small pure helpers shared across the workflow engine modules — localized-string
 *   display (loc) and key-template substitution (template). Extracted from engine.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 */
import type { LocalizedString } from '../../models/workflow-schemas.js';

/** Pick a display string from a localized value (prefers en_US, else fi_FI, else first). */
export function loc(s: LocalizedString | undefined): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.en_US ?? s.fi_FI ?? Object.values(s)[0] ?? '';
}

/** Substitute `{name}` template vars from the provided map; unknown names are left literal. */
export function template(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, n: string) => vars[n] ?? `{${n}}`);
}
