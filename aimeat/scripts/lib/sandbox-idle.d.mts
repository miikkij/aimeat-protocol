/**
 * @file scripts/lib/sandbox-idle.d.mts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Types for scripts/lib/sandbox-idle.mjs, which scripts/sandbox.ts imports.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
/** How long a sandbox process may go without a request, in ms; 0 means never stop. */
export function idleLimitMs(env?: NodeJS.ProcessEnv): number;
