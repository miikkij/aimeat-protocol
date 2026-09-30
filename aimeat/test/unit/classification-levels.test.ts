/**
 * @file test/unit/classification-levels.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three classification policy levels (TARGET-082 V2): a lower level only tightens
 *   the node and a refusal names the node's rule, an own label inherits from the node label below
 *   it, the merge takes the stricter value even from a stale layer, and an AI's loosening waits for
 *   a person while its tightening applies at once.
 * @version-history
 *   v1.2.0 — 2026-09-30 — The node's highest default label is a warning to an AI (option B), so the
 *     loosening refusal names "warning" and the inheriting label inherits a warning.
 *   v1.1.0 — 2026-09-29 — null as no classifier cap: taken at the node level, refused at the owner's.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V2. Initial.
 */
import { describe, it, expect } from 'vitest';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { loosenings, mergePolicy, validateLayer, validateNodePolicy, PolicyError } from '../../src/services/classification/levels.js';
import { readPolicy, reviewPolicy, writePolicy } from '../../src/services/classification/policy-admin.js';
import { ClassificationError, type LabelActor } from '../../src/services/classification/labels.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';

const node = defaultPolicy();
const dilutes = (input: unknown) => {
  try { validateLayer(node, input); } catch (e) { return (e as PolicyError).problems; }
  return [];
};

describe('a lower level only tightens the node', () => {
  it('refuses loosening a node label and names it', () => {
    const p = dilutes({ labels: [{ id: 'erittain-luottamuksellinen', aiVisibility: 'allowed' }] });
    // The node's default is a warning since 2026-09-30 (option B); allowed is still looser.
    expect(p.join(' ')).toMatch(/Node label erittain-luottamuksellinen shows an AI "warning"/);
  });

  it('refuses turning off a node rule, a lower default and a looser AI mode', () => {
    const p = dilutes({
      rules: [{ ...node.rules[0], enabled: false }], defaultLabel: 'julkinen', aiMode: 'auto',
    }).join(' ');
    expect(p).toMatch(/rule henkilotunnus cannot be turned off/);
    expect(p).toMatch(/default label is sisainen/);
    expect(p).toMatch(/AI mode is suggest/);
  });

  it('adds an own label that inherits from the node label below it, and refuses one looser than that', () => {
    const layer = validateLayer(node, { labels: [{ id: 'top-secret', rank: 40, name: { en: 'Top secret' }, audience: { people: ['alice@n'] } }] });
    const top = mergePolicy(node, layer).labels.find(l => l.id === 'top-secret')!;
    expect(top).toMatchObject({ aiVisibility: 'warning', audit: true, mayLeaveOrganism: false, lowerNeedsJustification: true, audience: { people: ['alice@n'] } });
    expect(top.name.en).toBe('Top secret');
    expect(dilutes({ labels: [{ id: 'johto', rank: 25, audit: false }] }).join(' ')).toMatch(/inherits from node label luottamuksellinen/);
    expect(dilutes({ labels: [{ id: 'x', rank: 20 }] }).join(' ')).toMatch(/Rank 20 of label x is taken by node label luottamuksellinen/);
  });

  it('takes null as no classifier cap at the node level and refuses it at the owner level', () => {
    const p = validateNodePolicy({ ...node, classifier: { ...node.classifier, dailyPerOwner: null, dailyNode: null } });
    expect(p.classifier).toMatchObject({ dailyPerOwner: null, dailyNode: null });
    expect(mergePolicy(p, validateLayer(p, { classifier: { type: 'llm' } })).classifier).toMatchObject({ dailyPerOwner: null, dailyNode: null });
    const refusals = (() => {
      try { validateLayer(node, { classifier: { dailyPerOwner: null, dailyNode: null } }); } catch (e) { return (e as PolicyError).problems; }
      return [];
    })().join(' ');
    expect(refusals).toMatch(/classifier\.dailyPerOwner is the operator's, set at the node level/);
    expect(refusals).toMatch(/classifier\.dailyNode is the operator's, set at the node level/);
    expect(() => validateNodePolicy({ ...node, classifier: { ...node.classifier, dailyNode: -1 } })).toThrow(/whole number from 0 to 1000000, or null for no cap/);
  });

  it('merges a stale layer to the stricter value', () => {
    const stricterNode = validateNodePolicy({ ...node, labels: node.labels.map(l => (l.id === 'sisainen' ? { ...l, aiVisibility: 'hidden' } : l)) });
    const merged = mergePolicy(stricterNode, { labels: [{ ...node.labels[1], aiVisibility: 'warning' }] });
    expect(merged.labels.find(l => l.id === 'sisainen')!.aiVisibility).toBe('hidden');
  });

  it('reports what a change gives away, and nothing for a pure tightening', () => {
    const tighter = mergePolicy(node, validateLayer(node, { aiMode: 'off' }));
    expect(loosenings(node, tighter)).toEqual([]);
    expect(loosenings(tighter, node)).toEqual(['The AI mode goes from off to suggest.']);
    expect(loosenings(node, node, { before: true, after: false })).toEqual(['Classification is turned off.']);
  });
});

describe('who changes a level, and what waits for a person', () => {
  const deps = () => ({ storage: new SqliteStorage(':memory:'), config: { classificationMode: 'owner' as const, nodeId: 'n' } });
  const ai: LabelActor = { principal: 'claude#alice@n', ownerGhii: 'alice@n', ownerName: 'alice', kind: 'ai' };
  const person: LabelActor = { ...ai, principal: 'alice@n', kind: 'human' };

  it("applies an AI's tightening at once and keeps its loosening for the person", async () => {
    const d = deps();
    expect((await writePolicy(d, ai, 'owner', null, { enabled: true })).applied).toBe(true);
    const off = await writePolicy(d, ai, 'owner', null, { enabled: false }, { humanSaid: 'turn it off' });
    expect(off).toMatchObject({ applied: false, pending: 'PERSON_APPROVES', loosens: ['Classification is turned off.'] });
    expect((await readPolicy(d, person, 'owner')).active).toBe(true);
    await expect(reviewPolicy(d, ai, 'owner', null, 'accept')).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });
    const accepted = await reviewPolicy(d, person, 'owner', null, 'accept');
    expect(accepted.view).toMatchObject({ active: false, proposal: null });
    d.storage.close();
  });

  it("refuses a non-operator at the node level and a dilution at the owner's", async () => {
    const d = deps();
    await expect(writePolicy(d, person, 'node', null, node)).rejects.toMatchObject({ code: 'OPERATOR_REQUIRED' });
    await expect(writePolicy(d, person, 'owner', null, { aiThreshold: 0.1 })).rejects.toBeInstanceOf(ClassificationError);
    d.storage.close();
  });
});
