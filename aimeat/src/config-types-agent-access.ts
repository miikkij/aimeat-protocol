/**
 * @file src/config-types-agent-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The settings that bound what an agent, an ecosystem app or an app may reach, mixed
 *   into AimeatConfig. Moved out of config-types.ts unchanged when that file reached the 800-line
 *   ceiling, in the change that added appOriginSignInRefuse.
 * @structure AgentAccessConfig
 * @usage import type { AgentAccessConfig } from './config-types-agent-access.js';
 * @version-history
 *   v1.0.0 — 2026-10-04 — Moved from config-types.ts (a pure move), with appOriginSignInRefuse added.
 */

export interface AgentAccessConfig {
  // Scoped Agent Capabilities (REQ-006)
  defaultAgentScopes: string[];
  maxAgentScopes: string[];
  /** Same-owner device-auth auto-approval (owner or same-owner agent; no cross-owner, no scope escalation). Default true. */
  sameOwnerAutoApprove: boolean;
  /** Refuse sign-in and registration from an app (middleware/app-origin-sign-in.ts). Default false:
   *  each request that would be refused is logged, and nothing is refused yet. */
  appOriginSignInRefuse: boolean;
  /** F1: enforce per-agent scopes on the /v1/mcp tool surface (default true; false = warn-only). */
  mcpEnforceScopes: boolean;
  /** Close an MCP session after this many minutes without a request (fractions allowed, floor
   *  0.05 -- the sub-minute range exists for tests; run production at 30-120). Each session
   *  holds a full tool catalog in memory, and most clients never send the DELETE that would
   *  end it — they just stop talking. A reaped client re-initializes on its next call. */
  mcpSessionIdleMinutes: number;
  /** How often the idle sweep looks, in ms. Read once at boot; the E2E runner pins it to 1000. */
  mcpSessionSweepMs: number;

  // Ecosystem application (GEAI) scope bounds — parallel to the agent knobs above, so an operator
  // can bound ecosystem connections independently of agents.
  defaultEcoScopes: string[];
  maxEcoScopes: string[];
}
