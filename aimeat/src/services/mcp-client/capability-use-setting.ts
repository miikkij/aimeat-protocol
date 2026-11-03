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
 *   an AI too. config-admin-view.ts asks this before anything in a request is applied.
 * @structure CAPABILITY_USE_APPROVAL_PATH · CAPABILITY_USE_APPROVAL_LABEL · capabilityUseApprovalLoosens ·
 *   capabilityUseApprovalChangeRefusal
 * @usage
 *   const refused = capabilityUseApprovalChangeRefusal(caller, config.mcpCapabilityUseApproval, change.value);
 * @version-history
 *   v1.0.0 — 2026-11-03 — Initial (secaudit2026nov02d round 13b).
 */
import { MCP_CAPABILITY_USE_APPROVAL_VALUES } from '../../config-types-agent-access.js';
import { readerKindOf } from '../classification/reader-kind.js';
import type { PolicyCaller, PolicyRefusal } from '../sign-in-policy.js';

export const CAPABILITY_USE_APPROVAL_PATH = 'mcp.capability_use_approval';
/** The setting's name as the Config tab shows it in English (dashboard.cfg_mcp_capability_use_approval). */
export const CAPABILITY_USE_APPROVAL_LABEL = 'Ask before another account\'s tool uses a person\'s sign-in';

const strictness = (value: unknown): number =>
  typeof value === 'string' ? (MCP_CAPABILITY_USE_APPROVAL_VALUES as readonly string[]).indexOf(value) : -1;

/** Whether moving the setting from `from` to `to` asks fewer people. */
export function capabilityUseApprovalLoosens(from: unknown, to: unknown): boolean {
  const a = strictness(from);
  const b = strictness(to);
  return a >= 0 && b >= 0 && b < a;
}

/** The refusal an AI credential gets for a change that asks fewer people, or null. */
export function capabilityUseApprovalChangeRefusal(caller: PolicyCaller, from: unknown, to: unknown): (PolicyRefusal & { details: Record<string, unknown> }) | null {
  if (!capabilityUseApprovalLoosens(from, to) || readerKindOf(caller) === 'human') return null;
  return {
    status: 403, code: 'PERSON_REQUIRED',
    details: { setting: CAPABILITY_USE_APPROVAL_PATH, from, to },
    message: `The setting "${CAPABILITY_USE_APPROVAL_LABEL}" decides who is asked before another account's tool acts as a person `
      + `on a server where each person signs in with their own account. Changing it from ${String(from)} to ${String(to)} asks fewer people, `
      + 'so an AI does not make that change. The node\'s operator makes it signed in themselves, under Admin, Config. '
      + 'An AI may make it stricter: from off to operators, or from operators to ask.',
  };
}
