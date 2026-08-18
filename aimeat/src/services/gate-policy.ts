/**
 * @file gate-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CONFIG half of the gate primitive (the gate ENGINE is the routes + storage).
 *   Decides whether a requested action must pause for human approval (a PendingApproval) or may
 *   auto-run with an audit row — driven entirely by data (the manifest's `policy`), never code.
 *   Default posture follows research #3: gate only consequential actions; everything else
 *   auto-runs. So "I don't want gates" = raise autonomy / set rule:'auto'; the only firm floor is
 *   `alwaysGate` (irreversible/expensive classes).
 * @structure
 *   - DEFAULT_ALWAYS_GATE — the safety floor when a manifest declares none
 *   - gatePolicyFromManifest() — pull { autonomy, alwaysGate } out of a manifest's policy
 *   - shouldGate() — pure decision: { gate, reason }
 * @usage
 *   import { shouldGate, gatePolicyFromManifest } from '../services/gate-policy.js';
 *   const d = shouldGate({ action, risk, rule, policy: gatePolicyFromManifest(manifest) });
 *   if (d.gate) { ...create PendingApproval... } else { ...auto-approve + audit... }
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Phase 4: gate decision (alwaysGate floor + autonomy L1–L5 × risk).
 */

export type Autonomy = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type Risk = 'low' | 'medium' | 'high';

/**
 * Action classes that ALWAYS gate regardless of autonomy (research #3 "always-gate"): data
 * egress / external release, money/spend, irreversible/destructive, autonomy escalation, and
 * schema/data-model changes ("AI proposes a data model → I approve"). A manifest can override the
 * list via `policy.alwaysGate` (including emptying it to opt out).
 */
export const DEFAULT_ALWAYS_GATE = [
  'data-model-change',
  'external-release',
  'data-egress',
  'egress',
  'spend',
  'money',
  'destructive',
  'autonomy-escalation',
];

/**
 * Per-autonomy risk threshold: gate an action whose risk is AT OR ABOVE this level. `null` = never
 * gate on autonomy grounds (the floor still applies). Default level is L3 (the dashboard default
 * "Consultant"). L1 = gate everything; L5 = gate nothing but the floor.
 */
const GATE_AT_OR_ABOVE: Record<Autonomy, Risk | null> = {
  L1: 'low',     // gate ≥ low  → everything
  L2: 'medium',  // gate ≥ medium
  L3: 'high',    // gate ≥ high
  L4: null,      // auto all (except floor)
  L5: null,      // auto all (except floor)
};

function riskRank(r: Risk): number {
  return r === 'low' ? 1 : r === 'medium' ? 2 : 3;
}

export interface GatePolicy {
  autonomy?: Autonomy;     // manifest.policy.agentAutonomy
  alwaysGate?: string[];   // manifest.policy.alwaysGate (replaces the default floor when present)
}

/** Extract the gate policy from a manifest value (safe on partial/absent manifests). */
export function gatePolicyFromManifest(manifest: unknown): GatePolicy {
  const policy = (manifest as { policy?: Record<string, unknown> } | null | undefined)?.policy;
  if (!policy || typeof policy !== 'object') return {};
  const autonomy = typeof policy.agentAutonomy === 'string' && /^L[1-5]$/.test(policy.agentAutonomy)
    ? policy.agentAutonomy as Autonomy : undefined;
  const alwaysGate = Array.isArray(policy.alwaysGate)
    ? (policy.alwaysGate as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;
  return { ...(autonomy ? { autonomy } : {}), ...(alwaysGate ? { alwaysGate } : {}) };
}

/**
 * Decide whether an action must be gated. Precedence:
 *   1. action ∈ alwaysGate → gate (the safety floor; wins over rule/autonomy).
 *   2. rule === 'auto'     → auto (explicit pass-through, still audited by the caller).
 *   3. autonomy × risk     → gate if risk ≥ the level's threshold; else auto.
 */
export function shouldGate(input: {
  action: string;
  risk?: Risk;
  rule?: 'approve' | 'auto';
  policy?: GatePolicy;
}): { gate: boolean; reason: string } {
  const risk = input.risk ?? 'medium';
  const alwaysGate = input.policy?.alwaysGate ?? DEFAULT_ALWAYS_GATE;

  if (alwaysGate.includes(input.action)) return { gate: true, reason: 'always_gate' };
  if (input.rule === 'auto') return { gate: false, reason: 'rule_auto' };

  const autonomy = input.policy?.autonomy ?? 'L3';
  const threshold = GATE_AT_OR_ABOVE[autonomy];
  if (threshold === null) return { gate: false, reason: `autonomy_${autonomy}` };
  const gate = riskRank(risk) >= riskRank(threshold);
  return { gate, reason: `autonomy_${autonomy}_risk_${risk}` };
}
