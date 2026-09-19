/**
 * @file src/services/app-build-level-meta.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading `<meta name="aimeat-level">` off a page: the one line both the register gate
 *   (app-artifact-lint.ts) and the level's own findings (app-build-level.ts) need. Its own leaf
 *   file, importing nothing, so the gate can read the level without an import cycle through the
 *   findings. What the three levels MEAN is said in app-build-level.ts.
 * @structure BuildLevel · declaredLevel(html) · registerIsOwed(html)
 * @usage if (!registerIsOwed(html)) return [];
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */

export type BuildLevel = 'proto' | 'plain' | 'fine';

const HEAD_BYTES = 8192;

/** The level the page states, or undefined when it states none (held to `fine`). */
export function declaredLevel(html: string): BuildLevel | undefined {
  const value = /<meta\b[^>]*name\s*=\s*["']aimeat-level["'][^>]*content\s*=\s*["']\s*([a-z]+)\s*["']/i
    .exec(html.slice(0, HEAD_BYTES))?.[1]?.toLowerCase();
  return value === 'proto' || value === 'plain' || value === 'fine' ? value : undefined;
}

/** A committed register is owed by the finest level, and by a page that states no level. */
export function registerIsOwed(html: string): boolean {
  const level = declaredLevel(html);
  return level === undefined || level === 'fine';
}
