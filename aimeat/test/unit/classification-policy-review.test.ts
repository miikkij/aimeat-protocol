/**
 * @file test/unit/classification-policy-review.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the classification levels compare and keep after the TARGET-082 review, pure and
 *   against SqliteStorage(':memory:'). Each block names its finding:
 *   3. a change is judged by what content effectively gets: a rule or the default pointed at a
 *      label of higher rank that protects less, and a change of the classifier, are loosenings; an
 *      AI or a rule moving content to such a label only suggests it;
 *   4. a stored layer is brought up to the current node: it still saves after the node tightened, a
 *      rule override keeps its stricter label when the node changes the pattern, an own label
 *      inherits its base's reader list, and nothing inherits from a retired label;
 *   5. a person's change supersedes an AI's waiting proposal.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-policy-review.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 review, findings 3, 4 and 5. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { defaultPolicy, type ClassificationLabel, type ClassificationPolicy } from '../../src/services/classification/defaults.js';
import * as levels from '../../src/services/classification/levels.js';
import { loosenings, mergePolicy, validateLayer } from '../../src/services/classification/levels.js';
import { readPolicy, reviewPolicy, writePolicy } from '../../src/services/classification/policy-admin.js';
import { setLabel, memoryTarget, ClassificationError, type LabelActor } from '../../src/services/classification/labels.js';
import { NODE_POLICY_KEY } from '../../src/services/classification/policy.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const config = { classificationMode: 'all' as const, nodeId: N };
const person: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human', roles: ['owner'] };
const ai: LabelActor = { principal: `claude#${ALICE}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'ai', roles: ['agent'] };
const rule: LabelActor = { principal: `system@${N}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'rule' };

/** A label of rank 500 that protects content less than any default label above `julkinen`. */
const WEAK: ClassificationLabel = {
  id: 'weak', name: { fi: 'Heikko', en: 'Weak', es: 'Débil' }, rank: 500, color: '#888888', description: '', status: 'active',
  aiVisibility: 'allowed', audit: false, mayLeaveOrganism: true, lowerNeedsJustification: false, audience: null,
};
const withWeak = (): ClassificationPolicy => ({ ...defaultPolicy(), labels: [...defaultPolicy().labels, WEAK] });
const setNode = (storage: SqliteStorage, policy: ClassificationPolicy) => storage.setMemory({
  key: NODE_POLICY_KEY, ownerGaii: `system@${N}`, value: { policy, history: [], proposal: null },
  visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '',
});

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ClassificationError ? e.code : String(e); }
}

describe('finding 3: what content effectively gets', () => {
  it('a rule pointed at a higher-ranked label that protects less gives content away', () => {
    const after = withWeak();
    after.rules = after.rules.map(r => (r.id === 'henkilotunnus' ? { ...r, minLabel: 'weak' } : r));
    const out = loosenings(defaultPolicy(), after).join(' ');
    expect(out).toMatch(/Content rule henkilotunnus finds gets weak instead of erittain-luottamuksellinen, which protects it less: what an AI sees/);
  });

  it('so does a default pointed at one', () => {
    const out = loosenings(defaultPolicy(), { ...withWeak(), defaultLabel: 'weak' }).join(' ');
    expect(out).toMatch(/Unlabelled content gets weak instead of sisainen, which protects it less/);
  });

  it('a new classifier type or provider, a raised or removed cap and a changed on-write list count', () => {
    const before = defaultPolicy();
    const after = { ...before, classifier: { type: 'llm' as const, provider: 'openai', dailyPerOwner: 500, dailyNode: null, onWrite: ['memory' as const] } };
    const out = loosenings(before, after);
    expect(out).toEqual([
      'The classifier changes from jev to llm.',
      "The classifier's provider changes from the default to openai.",
      "The classifier's daily cap per owner goes up from 200 to 500.",
      "The classifier's daily cap for the node is removed.",
      'The content the classifier judges on write changes from none to memory.',
    ]);
    expect(loosenings(after, { ...after, classifier: { ...after.classifier, dailyPerOwner: 100 } })).toEqual([]);
  });

  it('an AI or a rule only suggests a move to such a label, and a person gives a reason', async () => {
    const storage = new SqliteStorage(':memory:');
    await setNode(storage, withWeak());
    const deps = { storage, config };
    const T = memoryTarget(ALICE, 'notes.contract');
    expect((await setLabel(deps, rule, T, { label: 'luottamuksellinen' })).applied).toBe(true);
    expect((await setLabel(deps, rule, T, { label: 'weak' })).pending).toBe('CANNOT_LOWER');
    expect(await code(setLabel(deps, person, T, { label: 'weak' }))).toBe('JUSTIFICATION_REQUIRED');
    expect((await storage.getContentLabel(T))?.label).toBe('luottamuksellinen');
    storage.close();
  });
});

describe('finding 4: a stored layer against the current node', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());

  it('still saves after the node tightened what it overrode, and says what went', async () => {
    const deps = { storage, config: { classificationMode: 'owner' as const, nodeId: N } };
    await writePolicy(deps, person, 'owner', null, { enabled: true, labels: [{ id: 'sisainen', aiVisibility: 'warning' }] });
    const tighter = defaultPolicy();
    tighter.labels = tighter.labels.map(l => (l.id === 'sisainen' ? { ...l, aiVisibility: 'hidden' as const } : l));
    await setNode(storage, tighter);
    const view = await readPolicy(deps, person, 'owner');
    expect(view.dropped).toEqual(["Your change to label sisainen is dropped: the node's label is now at least as strict."]);
    expect((view.stored as { labels?: unknown }).labels).toEqual(undefined);
    const saved = await writePolicy(deps, person, 'owner', null, { ...(view.stored as object), enabled: false });
    expect(saved.applied).toBe(true);
    expect(saved.view.active).toBe(false);
  });

  it('drops a default, an AI mode and a threshold the node already meets', () => {
    const node = { ...defaultPolicy(), aiMode: 'off' as const, aiThreshold: 0.9, defaultLabel: 'erittain-luottamuksellinen' };
    const { layer, dropped } = levels.normaliseLayer(node, { defaultLabel: 'luottamuksellinen', aiMode: 'suggest', aiThreshold: 0.86 });
    expect(layer).toEqual({});
    expect(dropped).toHaveLength(3);
    expect(() => validateLayer(node, layer)).not.toThrow();
  });

  it('a rule override keeps its stricter label when the node changes the pattern', () => {
    const node = defaultPolicy();
    const iban = node.rules.find(r => r.id === 'iban')!;
    node.rules = node.rules.map(r => (r.id === 'iban' ? { ...r, pattern: '\\bFI\\d{16}\\b' } : r));
    const merged = mergePolicy(node, { rules: [{ ...iban, minLabel: 'erittain-luottamuksellinen' }] });
    expect(merged.rules.find(r => r.id === 'iban')).toMatchObject({ pattern: '\\bFI\\d{16}\\b', minLabel: 'erittain-luottamuksellinen' });
    const { layer, dropped } = levels.normaliseLayer(node, { rules: [{ ...iban, minLabel: 'erittain-luottamuksellinen' }] });
    expect(() => validateLayer(node, layer)).not.toThrow();
    expect(dropped.join(' ')).toMatch(/Rule iban now uses the node's changed pattern/);
  });

  it("an own label inherits its base's reader list and intersects its own with it", () => {
    const node = defaultPolicy();
    node.labels = node.labels.map(l => (l.id === 'luottamuksellinen' ? { ...l, audience: { people: ['alice', 'bob'] } } : l));
    const own = (audience?: object) => mergePolicy(node, { labels: [{ ...WEAK, id: 'johto', rank: 25, audience: audience as never }] })
      .labels.find(l => l.id === 'johto')!.audience;
    expect(own(undefined)).toEqual({ people: ['alice', 'bob'] });
    expect(own({ people: ['alice', 'carol'] })).toEqual({ people: ['alice'] });
  });

  it('nothing inherits from a retired label', () => {
    const node = defaultPolicy();
    node.labels = node.labels.map(l => (l.id === 'sisainen' ? { ...l, aiVisibility: 'warning' as const, audit: true }
      : l.id === 'luottamuksellinen' ? { ...l, status: 'retired' as const, aiVisibility: 'allowed' as const, audit: false } : l));
    const own = mergePolicy(node, { labels: [{ ...WEAK, id: 'johto', rank: 25 }] }).labels.find(l => l.id === 'johto')!;
    expect(own).toMatchObject({ aiVisibility: 'warning', audit: true });
  });
});

describe("finding 5: a person's change supersedes an AI's waiting proposal", () => {
  it('drops the proposal, says so in the history, and leaves nothing to accept', async () => {
    const storage = new SqliteStorage(':memory:');
    const deps = { storage, config: { classificationMode: 'owner' as const, nodeId: N } };
    await writePolicy(deps, person, 'owner', null, { enabled: true });
    expect((await writePolicy(deps, ai, 'owner', null, { enabled: false })).pending).toBe('PERSON_APPROVES');
    const out = await writePolicy(deps, person, 'owner', null, { enabled: true, aiMode: 'off' });
    expect(out.view.proposal).toBeNull();
    expect(out.view.history.map(h => h.action)).toEqual(['set', 'propose', 'supersede', 'set']);
    expect(await code(reviewPolicy(deps, person, 'owner', null, 'accept'))).toBe('NO_PROPOSAL');
    expect((await readPolicy(deps, person, 'owner')).active).toBe(true);
    storage.close();
  });
});
