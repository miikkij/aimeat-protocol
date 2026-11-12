/**
 * @file src/routes/agents/constants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared constants for the agents route modules (device-auth TTL). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   2026-11-13 — VALID_MODES moved to models/agent-onboarding-schemas.ts, beside AgentMode, so the agent
 *     profile service no longer imports a route file (structure programme 2026-11, unit 4).
 *   v1.1.0 — 2026-08-13 — Device-auth window 30 min -> 2 h, and DEVICE_AUTH_EXPIRY_SECONDS beside
 *     it: the response's `expires_in` was a second literal, which is how two numbers for one
 *     window eventually disagree.
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 */

/**
 * How long a pending device authorization waits for its human.
 *
 * Two hours, raised from thirty minutes on 2026-08-13. Thirty was fine when the person starting the
 * flow was the person at the keyboard; it is wrong for a fleet runtime being provisioned, where the
 * instance comes up and the human approves it whenever they next look. An expired request costs a
 * whole round of provisioning to redo, and the window is not what protects the flow — the owner's
 * approval is, and the user code is rate-limited against enumeration either way.
 *
 * `expires_in` in the device-authorize response is derived from this, never written out again: the
 * two used to be separate literals, which is how they would eventually disagree.
 */
export const DEVICE_AUTH_EXPIRY_MS = 7_200_000;

/** The same window in seconds, for the RFC 8628 `expires_in` field. */
export const DEVICE_AUTH_EXPIRY_SECONDS = DEVICE_AUTH_EXPIRY_MS / 1000;
