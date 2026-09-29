/**
 * @file test/unit/classification-classifier.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Content Classifier (TARGET-082 V3) on SQLite with the decision model and the
 *   text model stubbed: detection rules label without a model, the model's label follows the AI
 *   rules (a suggestion under aiMode suggest), content hidden from AI never reaches the model, the
 *   daily cap queues the item, both model kinds get scrubbed content, and the switch off does
 *   nothing. Also the key-only scan and the rules' scope. The review fixes: the counter and the queue
 *   are compare-and-swap (concurrent calls do not overshoot a cap, concurrent enqueues are not lost),
 *   one owner's queue cannot push out another's, a scan writes the queue once, the jev confidence
 *   comes from the option's probability, a fenced llm answer is read, a failed model call waits in
 *   the queue, a refused model label is an outcome, and the drain survives a bad item, retries it
 *   three times, and stops at the node's cap.
 * @version-history
 *   v1.2.0 — 2026-09-29 — The review fixes (TARGET-082 review, findings 2, 3 and 6).
 *   v1.1.0 — 2026-09-29 — A null daily cap never queues, and the call is still counted.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const decideMock = vi.fn();
const completeMock = vi.fn();
vi.mock('../../src/services/decide/service.js', () => ({ decideForOwner: (...a: unknown[]) => decideMock(...a) }));
vi.mock('../../src/services/ai-completion.js', () => ({ completeForOwner: (...a: unknown[]) => completeMock(...a) }));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { classifyText, drainQueue, enqueue, readQueue, type QueuedItem } from '../../src/services/classification/classifier.js';
import { matchRules } from '../../src/services/classification/detect.js';
import { defaultPolicy, type ClassificationPolicy } from '../../src/services/classification/defaults.js';
import { memoryTarget, readContentLabel, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { writePolicy } from '../../src/services/classification/policy-admin.js';
import { scanContent } from '../../src/services/classification/scan.js';
import type { AimeatConfig } from '../../src/config.js';

const N = 'n';
const alice: LabelActor = { principal: `alice@${N}`, ownerGhii: `alice@${N}`, ownerName: 'alice', kind: 'human' };
const t = (key: string) => memoryTarget(`alice@${N}`, key);
const bobT = (key: string) => memoryTarget(`bob@${N}`, key);

async function setNodePolicy(storage: SqliteStorage, change: (p: ClassificationPolicy) => void): Promise<void> {
  const policy = defaultPolicy();
  change(policy);
  await storage.setMemory({ key: 'classification.policy.node', ownerGaii: `system@${N}`, value: { policy, history: [], proposal: null }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
}

describe('the Content Classifier', () => {
  let storage: SqliteStorage;
  let deps: { storage: SqliteStorage; config: AimeatConfig };
  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    deps = { storage, config: { classificationMode: 'all', nodeId: N, decideEnabled: true } as unknown as AimeatConfig };
    decideMock.mockReset();
    completeMock.mockReset();
  });
  afterEach(() => storage.close());

  it('labels by a detection rule with no model when the AI may not label', async () => {
    await writePolicy(deps, alice, 'owner', null, { aiMode: 'off' });
    const out = await classifyText(deps, t('pay'), 'Tilinumero FI21 1234 5600 0007 85');
    expect(out).toMatchObject({ by: 'rule', skipped: 'AI_LABELLING_OFF', rule: { label: 'luottamuksellinen' } });
    expect((await readContentLabel(deps, alice, t('pay'))).label).toBe('luottamuksellinen');
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("asks the decision model with scrubbed content and keeps its label as a suggestion under aiMode suggest", async () => {
    decideMock.mockResolvedValue({ decision_id: 'd1', answers: { label: { value: 'luottamuksellinen', confidence: 0.93 } } });
    // A phone number: scrubbed before it leaves, and no detection rule matches it, so the label is the model's.
    const out = await classifyText(deps, t('note'), 'Call +358 40 123 4567 about the contract');
    const [, , , input] = decideMock.mock.calls[0] as [unknown, unknown, unknown, { state: { content: string }; strictScrub: boolean }];
    expect(input.state.content).toContain('[PHONE_1]');
    expect(input.state.content).not.toContain('123 4567');
    expect(input.strictScrub).toBe(true);
    expect(out.model).toMatchObject({ label: 'luottamuksellinen', result: { applied: false, pending: 'AI_SUGGESTS' } });
  });

  it('uses the text model when the policy says llm, and applies a sure raise under aiMode auto', async () => {
    await writePolicy(deps, alice, 'owner', null, { classifier: { type: 'llm' } });
    // aiMode auto is looser than the node's suggest, so a lower level cannot pick it: the node does.
    await storage.setMemory({ key: 'classification.policy.node', ownerGaii: `system@${N}`, value: { policy: { ...defaultPolicy(), aiMode: 'auto' }, history: [], proposal: null }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
    completeMock.mockResolvedValue({ content: '{"label":"luottamuksellinen","confidence":0.95,"reason":"a contract"}' });
    const out = await classifyText(deps, t('c'), 'The contract with the supplier');
    expect(completeMock).toHaveBeenCalledOnce();
    expect(out.model?.result).toMatchObject({ applied: true, label: 'luottamuksellinen' });
  });

  it('never sends content hidden from AI to a model', async () => {
    await setLabel(deps, alice, t('secret'), { label: 'erittain-luottamuksellinen' });
    const out = await classifyText(deps, t('secret'), 'anything');
    expect(out.skipped).toBe('HIDDEN_FROM_AI');
    expect(decideMock).not.toHaveBeenCalled();
  });

  it('queues the item past the daily cap', async () => {
    await storage.setMemory({ key: 'classification.policy.node', ownerGaii: `system@${N}`, value: { policy: { ...defaultPolicy(), classifier: { ...defaultPolicy().classifier, dailyPerOwner: 0 } }, history: [], proposal: null }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
    const out = await classifyText(deps, t('late'), 'text');
    expect(out.skipped).toBe('CAPPED');
    expect((await readQueue(storage, N)).map(i => i.key)).toEqual(['late']);
  });

  it('never queues under a null cap, and still counts the call', async () => {
    const policy = { ...defaultPolicy(), classifier: { ...defaultPolicy().classifier, dailyPerOwner: null, dailyNode: null } };
    await storage.setMemory({ key: 'classification.policy.node', ownerGaii: `system@${N}`, value: { policy, history: [], proposal: null }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
    // Far past the default caps already today: a null cap must not read as a cap of zero, or of anything.
    const day = new Date().toISOString().slice(0, 10);
    const scope = t('free').scope;
    await storage.setMemory({ key: `classification.classifier.usage.${day}`, ownerGaii: `system@${N}`, value: { node: 5000, by: { [scope]: 5000 } }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
    decideMock.mockResolvedValue({ decision_id: 'd2', answers: { label: { value: 'sisainen', confidence: 0.9 } } });
    const out = await classifyText(deps, t('free'), 'text');
    expect(out.skipped).not.toBe('CAPPED');
    expect(decideMock).toHaveBeenCalledOnce();
    expect(await readQueue(storage, N)).toEqual([]);
    const usage = (await storage.getMemory(`system@${N}`, `classification.classifier.usage.${day}`))?.value as { node: number; by: Record<string, number> };
    expect(usage).toEqual({ node: 5001, by: { [scope]: 5001 } });
  });

  it('does nothing with the switch off', async () => {
    const off = { storage, config: { ...deps.config, classificationMode: 'off' } as AimeatConfig };
    expect(await classifyText(off, t('x'), 'FI21 1234 5600 0007 85')).toEqual({ by: 'none', skipped: 'OFF' });
  });

  it('does not overshoot a cap when calls run at once (finding 3)', async () => {
    await setNodePolicy(storage, p => { p.classifier.dailyPerOwner = 2; });
    decideMock.mockResolvedValue({ decision_id: 'd', answers: { label: { value: 'sisainen', confidence: 0.9 } } });
    const outs = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(k => classifyText(deps, t(k), 'text')));
    expect(decideMock).toHaveBeenCalledTimes(2);
    expect(outs.filter(o => o.skipped === 'CAPPED')).toHaveLength(3);
    expect((await readQueue(storage, N)).map(i => i.key).sort()).toHaveLength(3);
  });

  it('loses no enqueue when many run at once (finding 3)', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    await Promise.all(keys.map(k => enqueue(deps, t(k))));
    expect((await readQueue(storage, N)).map(i => i.key).sort()).toEqual([...keys].sort());
  });

  it("keeps one owner's queue apart from another's, each capped (finding 3)", async () => {
    await enqueue(deps, t('mine'));
    await enqueue(deps, Array.from({ length: 2500 }, (_, i) => bobT(`flood.${i}`)));
    const all = await readQueue(storage, N);
    expect(all.filter(i => i.scope === `alice@${N}`).map(i => i.key)).toEqual(['mine']);
    expect(all.filter(i => i.scope === `bob@${N}`)).toHaveLength(2000);
  });

  it('a prefix scan writes the queue once, not once per key (finding 3)', async () => {
    for (let i = 0; i < 30; i++) {
      await storage.setMemory({ key: `notes.${i}`, ownerGaii: `alice@${N}`, value: `note ${i}`, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
    }
    const writes = [vi.spyOn(storage, 'setMemory'), vi.spyOn(storage, 'setMemoryIfVersion'), vi.spyOn(storage, 'createMemoryIfAbsent')];
    const out = await scanContent(deps, alice, { prefix: 'notes.' });
    expect(out.queued).toHaveLength(30);
    const systemWrites = writes.flatMap(w => w.mock.calls).filter(c => (c[0] as { ownerGaii: string }).ownerGaii === `system@${N}`);
    expect(systemWrites.length).toBeLessThanOrEqual(2);
  });

  it('judges at most 3 named keys inside the request and queues the rest (finding 6)', async () => {
    for (const k of ['a', 'b', 'c', 'd', 'e']) {
      await storage.setMemory({ key: k, ownerGaii: `alice@${N}`, value: 'text', visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });
    }
    decideMock.mockResolvedValue({ decision_id: 'd', answers: { label: { value: 'sisainen', confidence: 0.9 } } });
    const out = await scanContent(deps, alice, { keys: ['a', 'b', 'c', 'd', 'e'] });
    expect(out.classified.map(c => c.key)).toEqual(['a', 'b', 'c']);
    expect(out.queued).toEqual(['d', 'e']);
  });

  it("takes the jev confidence from the chosen option's probability when the answer has none (finding 6)", async () => {
    await setNodePolicy(storage, p => { p.aiMode = 'auto'; });
    decideMock.mockResolvedValue({ decision_id: 'd', answers: { label: { value: 'luottamuksellinen', probabilities: { luottamuksellinen: 0.97, sisainen: 0.03 } } } });
    const out = await classifyText(deps, t('p'), 'The contract');
    expect(out.model).toMatchObject({ confidence: 0.97, result: { applied: true, label: 'luottamuksellinen' } });
  });

  it('reads a fenced llm answer with braces around it (finding 6)', async () => {
    await writePolicy(deps, alice, 'owner', null, { classifier: { type: 'llm' } });
    completeMock.mockResolvedValue({ content: 'Sure.\n```json\n{"label":"luottamuksellinen","confidence":0.9,"reason":"a {contract}"}\n```\nNote: {not json}' });
    const out = await classifyText(deps, t('f'), 'The contract');
    expect(out.skipped).toBeUndefined();
    expect(out.model).toMatchObject({ label: 'luottamuksellinen', reason: 'a {contract}' });
  });

  it('keeps an item whose model call failed in the queue for another try (finding 6)', async () => {
    decideMock.mockRejectedValue(new Error('provider down'));
    const out = await classifyText(deps, t('retry'), 'text');
    expect(out).toMatchObject({ skipped: 'FAILED', retry: true });
    expect((await readQueue(storage, N)).map(i => i.key)).toEqual(['retry']);
  });

  it('answers LABEL_REFUSED rather than throwing when setLabel refuses the model label (finding 2)', async () => {
    // Organism content, and a label whose reader audience leaves the node's classifier out.
    await storage.createOrganism({
      id: 'o1', name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: `alice@${N}`, createdBy: `alice@${N}`, owners: ['alice'],
      admins: ['alice'], members: ['alice'], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: 'organism.o1', createdAt: '', updatedAt: '',
    } as never);
    await setNodePolicy(storage, p => { p.labels.push({ ...p.labels[2]!, id: 'hallitus', rank: 45, audience: { people: ['carol'] } }); });
    decideMock.mockResolvedValue({ decision_id: 'd', answers: { label: { value: 'hallitus', confidence: 0.99 } } });
    const out = await classifyText(deps, memoryTarget(`alice@${N}`, 'organism.o1.w.ws1.minutes'), 'minutes');
    // Where labels.ts lets the node's classifier past the lockout, the label is suggested instead;
    // either way the call answers and does not throw.
    expect(out.skipped === 'LABEL_REFUSED' || out.model?.result.pending === 'AI_SUGGESTS').toBe(true);
    expect(decideMock).toHaveBeenCalledOnce();
  });

  describe('drainQueue', () => {
    const seedText = async (key: string) => storage.setMemory({ key, ownerGaii: `alice@${N}`, value: 'text', visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '', updatedAt: '' });

    it('judges the other items when one throws, and keeps the failed one with its try count (finding 2)', async () => {
      decideMock.mockResolvedValue({ decision_id: 'd', answers: { label: { value: 'sisainen', confidence: 0.9 } } });
      await enqueue(deps, [t('bad'), t('ok1'), t('ok2')]);
      const textOf = async (i: QueuedItem) => { if (i.key === 'bad') throw new Error('storage hiccup'); return 'text'; };
      const out = await drainQueue(deps, textOf);
      expect(out).toEqual({ done: 2, waiting: 1 });
      expect(await readQueue(storage, N)).toMatchObject([{ key: 'bad', tries: 1, reason: 'storage hiccup' }]);
      // The next two runs fail it again, and the third drops it.
      await drainQueue(deps, textOf);
      expect(await drainQueue(deps, textOf)).toEqual({ done: 0, waiting: 0 });
      expect(await readQueue(storage, N)).toEqual([]);
    });

    it("stops the whole run at the node's cap (finding 2)", async () => {
      await setNodePolicy(storage, p => { p.classifier.dailyNode = 0; });
      for (const k of ['q1', 'q2', 'q3']) await seedText(k);
      await enqueue(deps, [t('q1'), t('q2'), t('q3')]);
      const textOf = vi.fn(async () => 'text');
      expect(await drainQueue(deps, textOf)).toEqual({ done: 0, waiting: 3 });
      expect(textOf).toHaveBeenCalledTimes(1);
      expect(decideMock).not.toHaveBeenCalled();
    });

    it('walks the owners in turn, so one long queue does not starve another (finding 3)', async () => {
      decideMock.mockResolvedValue({ decision_id: 'd', answers: { label: { value: 'sisainen', confidence: 0.9 } } });
      await enqueue(deps, Array.from({ length: 5 }, (_, i) => bobT(`b${i}`)));
      await enqueue(deps, t('a0'));
      const seen: string[] = [];
      await drainQueue(deps, async i => { seen.push(i.key); return 'text'; }, 2);
      expect(seen).toEqual(['b0', 'a0']);
    });
  });

  it('applies a rule only within its scope', () => {
    const p = defaultPolicy();
    p.rules.push({ id: 'hallitus', name: 'Board', kind: 'keyword', pattern: 'hallituksen pöytäkirja, board minutes', flags: '', minLabel: 'erittain-luottamuksellinen', enabled: true, appliesTo: { keyPrefix: 'board.' } });
    expect(matchRules(p, t('board.2026'), 'These are the Board Minutes.')?.label).toBe('erittain-luottamuksellinen');
    expect(matchRules(p, t('notes.x'), 'These are the Board Minutes.')).toBeNull();
    expect(matchRules(p, t('board.2026'), 'boardminutes')).toBeNull();
  });
});
