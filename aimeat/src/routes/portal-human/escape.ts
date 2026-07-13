/**
 * @file src/routes/portal-human/escape.ts
 * @description HTML-entity (esc) and JS-single-quoted-string (jesc) escaping helpers for the human portal page. Extracted from src/routes/portal-human.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portal-human.ts (max-file-lines)
 */

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escape for embedding in JS single-quoted strings inside template literals */
export function jesc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
