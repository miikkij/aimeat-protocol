import { describe, it, expect } from 'vitest';
import { shouldGate, gatePolicyFromManifest, DEFAULT_ALWAYS_GATE } from '../../src/services/gate-policy.js';

describe('gate-policy.shouldGate', () => {
  it('always-gates floor actions regardless of autonomy or rule', () => {
    for (const action of DEFAULT_ALWAYS_GATE) {
      expect(shouldGate({ action, risk: 'low', rule: 'auto', policy: { autonomy: 'L5' } }))
        .toEqual({ gate: true, reason: 'always_gate' });
    }
  });

  it('rule:auto passes non-floor actions through', () => {
    expect(shouldGate({ action: 'flow:advance', risk: 'high', rule: 'auto' }).gate).toBe(false);
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
