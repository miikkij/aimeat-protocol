/**
 * @file src/config-types-agent-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The settings that bound what an agent, an ecosystem app or an app may reach, mixed
 *   into AimeatConfig. Moved out of config-types.ts unchanged when that file reached the 800-line
 *   ceiling, in the change that added appOriginSignInRefuse.
 * @structure MCP_CAPABILITY_USE_APPROVAL_VALUES · McpCapabilityUseApproval · mcpCapabilityUseApprovalFrom ·
 *   AgentAccessConfig
 * @usage import type { AgentAccessConfig } from './config-types-agent-access.js';
 * @version-history
 *   v1.1.0 — 2026-11-03 — mcpCapabilityUseApproval (AIMEAT_MCP_CAPABILITY_USE_APPROVAL: off, operators,
 *     ask; default operators), secaudit2026nov02d round 13b.
 *   v1.0.0 — 2026-10-04 — Moved from config-types.ts (a pure move), with appOriginSignInRefuse added.
 */

/**
 * Whether another account's capability over an MCP server where each person signs in with their own
 * account asks the caller's account first (services/mcp-client/capability-consent.ts). Ordered from
 * open to strict: off (nothing asks), operators (a capability of an operator account runs unasked,
 * every other account's asks once), ask (every other account's asks once).
 */
export const MCP_CAPABILITY_USE_APPROVAL_VALUES = ['off', 'operators', 'ask'] as const;
export type McpCapabilityUseApproval = typeof MCP_CAPABILITY_USE_APPROVAL_VALUES[number];

/** The environment's value when it is one of the values, `operators` otherwise. */
export function mcpCapabilityUseApprovalFrom(raw: string | undefined): McpCapabilityUseApproval {
  const v = (raw ?? '').trim().toLowerCase();
  return (MCP_CAPABILITY_USE_APPROVAL_VALUES as readonly string[]).includes(v) ? v as McpCapabilityUseApproval : 'operators';
}

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
  /** MCP Tasks extension (mcp/tasks-extension.ts): a tools/call from a client that declares the
   *  extension and has not finished after this many ms answers with a task handle. 0 = at once. */
  mcpTaskAfterMs: number;
  /** Another account's capability on a personal sign-in MCP server: off · operators (default) · ask.
   *  Read on every call (services/mcp-client/capability-consent.ts). */
  mcpCapabilityUseApproval: McpCapabilityUseApproval;

  // Ecosystem application (GEAI) scope bounds — parallel to the agent knobs above, so an operator
  // can bound ecosystem connections independently of agents.
  defaultEcoScopes: string[];
  maxEcoScopes: string[];
}
