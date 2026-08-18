/**
 * @file package-hash.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Utility for computing SHA-256 content hashes of AIMEAT components.
 *   Used by the package system to detect user customizations after installation.
 * @structure
 *   - computeHash(content: string) — SHA-256 hex hash of content string
 * @usage
 *   import { computeHash } from '../services/package-hash.js';
 *   const hash = computeHash(componentContent);
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phase 3)
 */

import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 hex digest of the given content string.
 * Used for change detection: comparing originalHash at install time
 * against current content to detect user customizations.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
