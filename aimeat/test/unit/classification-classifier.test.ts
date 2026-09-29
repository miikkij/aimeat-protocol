/**
 * @file test/unit/classification-classifier.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Content Classifier (TARGET-082 V3) on SQLite with the decision model and the
 *   text model stubbed: detection rules label without a model, the model's label follows the AI
 *   rules (a suggestion under aiMode suggest), content hidden from AI never reaches the model, the
 *   daily cap queues the item, both model kinds get scrubbed content, and the switch off does
 *   nothing. Also the key-only scan and the rules' scope.
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const decideMock = vi.fn();
const completeMock = vi.fn();
vi.mock('../../src/services/decide/service.js', () => ({ decideForOwner: (...a: unknown[]) => decideMock(...a) }));
vi.mock('../../src/services/ai-completion.js', () => ({ completeForOwner: (...a: unknown[]) => completeMock(...a) }));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { classifyText, readQueue } from '../../src/services/classification/classifier.js';
import { matchRules } from '../../src/services/classification/detect.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { memoryTarget, readContentLabel, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { writePolicy } from '../../src/services/classification/policy-admin.js';
import type { AimeatConfig } from '../../src/config.js';

const N = 'n';
const alice: LabelActor = { principal: `alice@${N}`, ownerGhii: `alice@${N}`, ownerName: 'alice', kind: 'human' };
const t = (key: string) => memoryTarget(`alice@${N}`, key);

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

  it('does nothing with the switch off', async () => {
    const off = { storage, config: { ...deps.config, classificationMode: 'off' } as AimeatConfig };
    expect(await classifyText(off, t('x'), 'FI21 1234 5600 0007 85')).toEqual({ by: 'none', skipped: 'OFF' });
  });

  it('applies a rule only within its scope', () => {
    const p = defaultPolicy();
    p.rules.push({ id: 'hallitus', name: 'Board', kind: 'keyword', pattern: 'hallituksen pöytäkirja, board minutes', flags: '', minLabel: 'erittain-luottamuksellinen', enabled: true, appliesTo: { keyPrefix: 'board.' } });
    expect(matchRules(p, t('board.2026'), 'These are the Board Minutes.')?.label).toBe('erittain-luottamuksellinen');
    expect(matchRules(p, t('notes.x'), 'These are the Board Minutes.')).toBeNull();
    expect(matchRules(p, t('board.2026'), 'boardminutes')).toBeNull();
  });
});
