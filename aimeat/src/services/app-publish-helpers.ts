/**
 * @file src/services/app-publish-helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A small pure helper of the publish (services/app-publish.ts): the clean-up of the
 *   per-locale descriptions. Moved out of app-publish.ts by pure extraction, unchanged, to keep that
 *   file under the line limit.
 * @structure sanitizeDescriptions(input)
 * @usage import { sanitizeDescriptions } from './app-publish-helpers.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Moved out of services/app-publish.ts unchanged. provenanceModelFindings,
 *     moved here at first, went to app-ai-model-hints.ts in a change on main the same day.
 */

/** Drop blank entries and cap each at 2000 characters; `undefined` when nothing survives. */
export function sanitizeDescriptions(input: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const cleaned: Record<string, string> = {};
  for (const [loc, val] of Object.entries(input)) {
    if (typeof val === 'string' && val.trim().length > 0) cleaned[loc] = val.trim().slice(0, 2000);
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
