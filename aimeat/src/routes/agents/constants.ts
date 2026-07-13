/**
 * @file src/routes/agents/constants.ts
 * @description Shared constants for the agents route modules (mode enum, device-auth TTL). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 */

/** Device authorization code expires after 30 minutes */
export const DEVICE_AUTH_EXPIRY_MS = 1_800_000;

export const VALID_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'] as const;
