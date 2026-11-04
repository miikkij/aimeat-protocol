/**
 * @file src/services/mcp-client/capability-use-setting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node setting mcp.capability_use_approval (AIMEAT_MCP_CAPABILITY_USE_APPROVAL): who is
 *   asked before another account's capability runs a tool on an MCP server where each person signs in
 *   with their own account (capability-consent.ts). Three values, ordered from open to strict:
 *     off        nothing asks; another account's capability runs on the caller's own sign-in.
 *     operators  (default) a capability published by an account with the operator role runs without
 *                asking; every other account's asks once. The operator already holds every right on
 *                the node, so exempting the operator's own capabilities gives no protection away.
 *     ask        every first use of another account's capability asks once, the operator's included.
 *   The developer asked for it on 2026-11-03 ("konfiguroitavaksi .. jotkut haluaa automatiikkaa ...
 *   mutta yritykset voi haluta varmistusta"), secaudit2026nov02d round 13b.
 *
 *   WHO CHANGES IT. A change to a more open value asks fewer people, so an AI credential is refused it
 *   with PERSON_REQUIRED, the way the sign-in policy is guarded (sign-in-policy.ts
 *   signInPolicyChangeRefusal, the same reader-kind test). A change to a stricter value applies from
 *   an AI too. Every config write and reset path asks the rule (config-strictness.ts) before anything in a
 *   request is applied.
 * @structure CAPABILITY_USE_APPROVAL_PATH · CAPABILITY_USE_APPROVAL_LABEL · capabilityUseApprovalLoosens ·
 *   capabilityUseApprovalChangeRefusal
 * @usage
 *   const refused = capabilityUseApprovalChangeRefusal(caller, config.mcpCapabilityUseApproval, change.value);
 * @version-history
 *   v1.1.0 — 2026-11-04 — The order and the refusal's words moved onto the setting's row
 *     (config-schema-access.ts), judged by config-strictness.ts, which every config write and reset path
 *     asks; the answers are the same (codebase analysis 2026-11-03, item B4).
 *   v1.0.0 — 2026-11-03 — Initial (secaudit2026nov02d round 13b).
 */
import { CAPABILITY_USE_APPROVAL_LABEL } from '../../config-types-agent-access.js';
import { settingLoosens, looseningRefusal } from '../config-strictness.js';
import type { PolicyCaller, PolicyRefusal } from '../sign-in-policy.js';

export const CAPABILITY_USE_APPROVAL_PATH = 'mcp.capability_use_approval';
/** The setting's name as the Config tab shows it in English (dashboard.cfg_mcp_capability_use_approval). */
export { CAPABILITY_USE_APPROVAL_LABEL };

/** Whether moving the setting from `from` to `to` asks fewer people (the row's order, off to operators to ask). */
export function capabilityUseApprovalLoosens(from: unknown, to: unknown): boolean {
  return settingLoosens(CAPABILITY_USE_APPROVAL_PATH, from, to);
}

/**
 * The refusal an AI credential gets for a change that asks fewer people, or null. Worded by the
 * setting's row (config-schema-access.ts) and judged by config-strictness.ts, as every write path does.
 */
export function capabilityUseApprovalChangeRefusal(caller: PolicyCaller, from: unknown, to: unknown): (PolicyRefusal & { details: Record<string, unknown> }) | null {
  const r = looseningRefusal(caller, CAPABILITY_USE_APPROVAL_PATH, from, to);
  return r ? { status: r.status, code: r.code, details: r.details ?? {}, message: r.message } : null;
}
