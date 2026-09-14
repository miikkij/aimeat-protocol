import { describe, it, expect } from 'vitest';
import { shouldGate, gatePolicyFromManifest, DEFAULT_ALWAYS_GATE } from '../../src/services/gate-policy.js';

describe('gate-policy.shouldGate', () => {
  it('always-gates floor actions regardless of autonomy or rule', () => {
    for (const action of DEFAULT_ALWAYS_GATE) {
      expect(shouldGate({ action, risk: 'low', rule: 'auto', policy: { autonomy: 'L5' } }))
        .toEqual({ gate: true, reason: 'always_gate' });
    }
  });

  // THIS TEST ASSERTED THE HOLE, and it is the third of the three cases the repo's rule names: not
  // that the source was broken and not that its setup drifted, but that it pinned the defect as the
  // behaviour. `flow:advance` at HIGH risk with no policy is default autonomy L3, whose threshold
  // is exactly 'high' — so the owner's setting says gate, and the assertion was that the caller's
  // own `rule` overrules it. It does not any more.
  it('rule:auto does NOT overrule the owner: the autonomy threshold is read first', () => {
    // L3 is the default and gates at high. The caller asking to skip it changes nothing.
    expect(shouldGate({ action: 'flow:advance', risk: 'high', rule: 'auto' }))
      .toEqual({ gate: true, reason: 'autonomy_L3_risk_high' });
    // L1 says "gate everything", and until 2026-09-07 one caller-supplied word passed any action
    // outside the eight-name floor and recorded it as decidedBy:'system'.
    expect(shouldGate({ action: 'flow:advance', risk: 'low', rule: 'auto', policy: { autonomy: 'L1' } }))
      .toEqual({ gate: true, reason: 'autonomy_L1_risk_low' });
  });

  it('rule:auto is honoured where the owner already allowed it, and says so in the reason', () => {
    // Below the threshold the answer is auto either way; the reason names which asked for it, so an
    // audit can still see the caller's intent rather than only the level's.
    expect(shouldGate({ action: 'flow:advance', risk: 'low', rule: 'auto', policy: { autonomy: 'L3' } }))
      .toEqual({ gate: false, reason: 'rule_auto' });
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L3' } }))
      .toEqual({ gate: false, reason: 'autonomy_L3_risk_low' });
    // L4 and L5 auto-run every non-floor action; the caller's word is still recorded.
    expect(shouldGate({ action: 'flow:advance', risk: 'high', rule: 'auto', policy: { autonomy: 'L5' } }))
      .toEqual({ gate: false, reason: 'rule_auto' });
    expect(shouldGate({ action: 'flow:advance', risk: 'high', policy: { autonomy: 'L5' } }))
      .toEqual({ gate: false, reason: 'autonomy_L5' });
  });

  it('rule:approve gates, even where autonomy would have auto-run', () => {
    // It was in the declared union and honoured nowhere, so a caller asking to be reviewed was
    // auto-run instead. L5 auto-runs every non-floor action, which is what makes this the case
    // worth pinning: asking for review has to outrank the level.
    expect(shouldGate({ action: 'flow:advance', risk: 'low', rule: 'approve', policy: { autonomy: 'L5' } }))
      .toEqual({ gate: true, reason: 'rule_approve' });
  });

  it('…and the floor still outranks it in the other direction', () => {
    // Order matters both ways: a floor action reports always_gate, not rule_approve, so the reason
    // a caller reads names the rule that actually decided.
    expect(shouldGate({ action: DEFAULT_ALWAYS_GATE[0], rule: 'approve' }))
      .toEqual({ gate: true, reason: 'always_gate' });
  });

  it('autonomy L1 gates everything', () => {
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L1' } }).gate).toBe(true);
  });

  it('autonomy L3 (default) gates high, auto low/medium', () => {
    expect(shouldGate({ action: 'flow:advance', risk: 'high' }).gate).toBe(true);    // default L3
    expect(shouldGate({ action: 'flow:advance', risk: 'medium' }).gate).toBe(false);
    expect(shouldGate({ action: 'flow:advance', risk: 'low' }).gate).toBe(false);
  });

  it('autonomy L2 gates medium+high', () => {
    expect(shouldGate({ action: 'flow:advance', risk: 'medium', policy: { autonomy: 'L2' } }).gate).toBe(true);
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L2' } }).gate).toBe(false);
  });

  it('autonomy L4/L5 auto-runs all non-floor actions', () => {
    expect(shouldGate({ action: 'flow:advance', risk: 'high', policy: { autonomy: 'L4' } }).gate).toBe(false);
    expect(shouldGate({ action: 'deliverable:accept', risk: 'high', policy: { autonomy: 'L5' } }).gate).toBe(false);
  });

  // THE SAME SHAPE AS `rule`, ONE FIELD OVER, and the second half of the 2026-09-07 ruling. `rule`
  // stopped deciding anything because it arrives on req.body and belongs to the caller; `risk`
  // arrives on the same body, from the same caller, and still decided everything.
  it("an agent's own word about its own risk cannot lower the gate below the default", () => {
    // L2 reads `gate ≥ medium`. An agent calling its own action low was auto-approved and the
    // record said decidedBy:'system'.
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L2' }, selfDeclaredRisk: true }))
      .toEqual({ gate: true, reason: 'autonomy_L2_risk_medium_self_declared_floored' });
    // Saying nothing has always meant medium, so a caller that declares nothing is unchanged.
    expect(shouldGate({ action: 'flow:advance', policy: { autonomy: 'L2' }, selfDeclaredRisk: true }))
      .toEqual({ gate: true, reason: 'autonomy_L2_risk_medium' });
    // RAISING is still the caller's to do: more caution than the policy asks for is never refused.
    expect(shouldGate({ action: 'flow:advance', risk: 'high', policy: { autonomy: 'L3' }, selfDeclaredRisk: true }))
      .toEqual({ gate: true, reason: 'autonomy_L3_risk_high' });
  });

  it("a HUMAN member's word is untouched, or L2 would collapse into L1", () => {
    // The person is the party the policy protects, not the party it constrains. Flooring everyone
    // would make `low` decoration and the L2 row a lie.
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L2' } }).gate).toBe(false);
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L2' }, selfDeclaredRisk: false }).gate).toBe(false);
  });

  it('the floor still outranks a self-declared risk in both directions', () => {
    // A floor action gates whatever the agent claims, and reports the floor as the reason.
    expect(shouldGate({ action: 'spend', risk: 'low', policy: { autonomy: 'L5' }, selfDeclaredRisk: true }))
      .toEqual({ gate: true, reason: 'always_gate' });
    // And L4/L5 still auto-run every non-floor action: the floor raises the risk word, it does not
    // override the owner's level.
    expect(shouldGate({ action: 'flow:advance', risk: 'low', policy: { autonomy: 'L5' }, selfDeclaredRisk: true }).gate)
      .toBe(false);
  });

  it('a manifest can empty alwaysGate to opt a class out of the floor', () => {
    expect(shouldGate({ action: 'spend', risk: 'low', policy: { autonomy: 'L5', alwaysGate: [] } }).gate).toBe(false);
  });
});

describe('gate-policy.gatePolicyFromManifest', () => {
  it('reads agentAutonomy + alwaysGate from policy', () => {
    expect(gatePolicyFromManifest({ policy: { agentAutonomy: 'L4', alwaysGate: ['spend'] } }))
      .toEqual({ autonomy: 'L4', alwaysGate: ['spend'] });
  });

  it('is safe on absent/partial manifests', () => {
    expect(gatePolicyFromManifest(null)).toEqual({});
    expect(gatePolicyFromManifest({})).toEqual({});
    expect(gatePolicyFromManifest({ policy: { agentAutonomy: 'nonsense' } })).toEqual({});
  });
});
