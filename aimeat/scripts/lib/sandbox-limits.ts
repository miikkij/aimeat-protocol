/**
 * @file scripts/lib/sandbox-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sandbox's own ceilings, in one place, because two scripts have to agree on them:
 *   `sandbox.ts` starts the node with them, and the build measurement (`cold-agent/run.ts`) counts
 *   against them before it spends money. When the two disagreed by accident (a node at its default
 *   of 50 apps, a runner that did not count), three finished builds were refused at their publish.
 *
 *   The app ceiling is high ON PURPOSE. A sandbox keeps its history the way a real node does, so
 *   how the measured apps changed from week to week can be read back; it is reset by a person who
 *   decides to, never because a counter ran out.
 * @structure SANDBOX_MAX_APPS
 * @usage import { SANDBOX_MAX_APPS } from './lib/sandbox-limits.js';
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */

/** Published apps one sandbox owner may hold. At 3 builds a run, years of measuring. */
export const SANDBOX_MAX_APPS = 5000;
