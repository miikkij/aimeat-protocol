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
 *   v1.1.0 -- 2026-09-06 -- rule:'approve' is honoured. It was in the declared union and read
 *     nowhere, so a caller asking to be gated was auto-run instead.
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
 *   1. action ∈ alwaysGate  → gate (the safety floor; wins over everything).
 *   2. rule === 'approve'   → gate (the caller asking for review; cannot be undone by autonomy).
 *   3. autonomy × risk      → gate if risk ≥ the level's threshold. THE OWNER'S SETTING, and it
 *                             outranks the caller's `rule`.
 *   4. rule === 'auto'      → auto, where step 3 already allowed it. Recorded in the reason so an
 *                             audit can see the caller asked; it no longer decides anything.
 *
 * WHOSE VALUE IS WHOSE, which is the whole of it. `policy` comes from the organism's manifest and
 * belongs to the OWNER. `rule` arrives on `req.body` (routes/organisms/gates.ts) and belongs to the
 * CALLER — the agent. Until 2026-09-07 step 4 was evaluated third, before autonomy was read at all,
 * so an organism set to L1 — whose own table says `gate ≥ low → everything` — passed any action
 * outside the eight-name floor the moment a caller sent `rule: 'auto'`, and recorded it as
 * `decidedBy: 'system'`. A policy the party it constrains can opt out of is not a policy; it is the
 * shape invariant 15 names, a permission word that is not enforced on every door.
 *
 * The previous note here argued that step 1 makes this safe. It is right about the floor and silent
 * about the case: the floor is eight named actions, and L1 promises all of them and everything else.
 * Either L1 means what it says or the word is decoration. Ruled 2026-09-07: L1 means it.
 *
 * WHAT THIS COSTS. `rule: 'auto'` no longer changes an outcome anywhere — where autonomy gates it
 * is overruled, and where autonomy does not it was already going to pass. It stays in the union and
 * in the reason because the caller's intent is worth recording, but it is now a label rather than a
 * control. `rule: 'approve'` is unaffected and still binds: asking for MORE review than the policy
 * requires is not a thing an owner's setting needs protecting from.
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
  // `approve` was in the declared union and honoured nowhere, so a caller ASKING to be gated was
  // auto-run instead — the union's safer half was decorative. It sits below the floor and above
  // everything else, which is the only order that leaves both halves meaning what they say.
  if (input.rule === 'approve') return { gate: true, reason: 'rule_approve' };

  const autonomy = input.policy?.autonomy ?? 'L3';
  const threshold = GATE_AT_OR_ABOVE[autonomy];
  if (threshold !== null && riskRank(risk) >= riskRank(threshold)) {
    return { gate: true, reason: `autonomy_${autonomy}_risk_${risk}` };
  }
  // Past the owner's threshold. The caller's pass-through is honoured here and only here, so the
  // reason still says which of the two let it through.
  if (input.rule === 'auto') return { gate: false, reason: 'rule_auto' };
  return { gate: false, reason: threshold === null ? `autonomy_${autonomy}` : `autonomy_${autonomy}_risk_${risk}` };
}
