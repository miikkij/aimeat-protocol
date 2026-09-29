/**
 * @file test/unit/classification-labels.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The label write rules of TARGET-082 (services/classification/labels.ts) against
 *   SqliteStorage(':memory:'): a person's label locks; an AI and a rule never lower and never change a
 *   locked label, and leave a suggestion instead; lowering from a label that asks for a reason needs
 *   one; humanSaid makes an AI's call the person's; the AI mode (suggest, auto, off); a review; who
 *   may label what; who is an AI, decided from the credential.
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import {
  setLabel, reviewLabel, labelsFor, labelActorOf, memoryTarget, fileTarget, rowTarget, targetId,
  ClassificationError, type LabelActor,
} from '../../src/services/classification/labels.js';
import { readerKindOf } from '../../src/services/classification/reader-kind.js';
import { classificationActiveFor, OWNER_POLICY_KEY } from '../../src/services/classification/policy.js';
import * as policyModule from '../../src/services/classification/policy.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const config = { classificationMode: 'all' as const, nodeId: NODE };
const person: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const agent: LabelActor = { principal: `claude#${ALICE}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'ai' };
const rule: LabelActor = { principal: `system@${NODE}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'rule' };
const T = memoryTarget(ALICE, 'notes.contract');

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ClassificationError ? e.code : String(e); }
}

describe('classification labels', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage, config, now: () => '2026-09-29T12:00:00.000Z' });
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); });

  it('a person sets a label and it locks', async () => {
    const r = await setLabel(deps(), person, T, { label: 'luottamuksellinen' });
    expect(r).toMatchObject({ applied: true, label: 'luottamuksellinen', from: 'sisainen', source: 'human', locked: true });
    const row = await storage.getContentLabel(T);
    expect(row?.locked).toBe(true);
    expect(row?.history.at(-1)).toMatchObject({ action: 'set', from: 'sisainen', to: 'luottamuksellinen', source: 'human' });
  });

  it("an AI never changes a person's label: it leaves a suggestion", async () => {
    await setLabel(deps(), person, T, { label: 'sisainen' });
    const r = await setLabel(deps(), agent, T, { label: 'erittain-luottamuksellinen', confidence: 0.99 });
    expect(r).toMatchObject({ applied: false, label: 'sisainen', pending: 'HUMAN_LABEL' });
    const row = await storage.getContentLabel(T);
    expect(row?.label).toBe('sisainen');
    expect(row?.suggestion).toMatchObject({ label: 'erittain-luottamuksellinen', why: 'HUMAN_LABEL', source: 'ai' });
  });

  it('an AI never lowers a label, and neither does a rule', async () => {
    await setLabel(deps(), rule, T, { label: 'luottamuksellinen' });
    expect((await storage.getContentLabel(T))?.label).toBe('luottamuksellinen');
    const byRule = await setLabel(deps(), rule, T, { label: 'julkinen' });
    expect(byRule.pending).toBe('CANNOT_LOWER');
    vi.spyOn(policyModule, 'policyFor').mockResolvedValue({ ...defaultPolicy(), aiMode: 'auto' });
    const byAi = await setLabel(deps(), agent, T, { label: 'julkinen', confidence: 1 });
    expect(byAi.pending).toBe('CANNOT_LOWER');
    expect((await storage.getContentLabel(T))?.label).toBe('luottamuksellinen');
  });

  it('a rule raises an unlocked label on its own', async () => {
    const r = await setLabel(deps(), rule, T, { label: 'erittain-luottamuksellinen', reason: 'IBAN' });
    expect(r).toMatchObject({ applied: true, source: 'rule', locked: false });
  });

  it('the AI mode: suggest waits, auto applies a raise at the threshold, off refuses', async () => {
    const suggest = await setLabel(deps(), agent, T, { label: 'luottamuksellinen', confidence: 0.99 });
    expect(suggest.pending).toBe('AI_SUGGESTS');
    vi.spyOn(policyModule, 'policyFor').mockResolvedValue({ ...defaultPolicy(), aiMode: 'auto' });
    expect((await setLabel(deps(), agent, T, { label: 'luottamuksellinen', confidence: 0.5 })).pending).toBe('BELOW_THRESHOLD');
    expect(await setLabel(deps(), agent, T, { label: 'luottamuksellinen', confidence: 0.9 })).toMatchObject({ applied: true, source: 'ai', locked: false });
    vi.spyOn(policyModule, 'policyFor').mockResolvedValue({ ...defaultPolicy(), aiMode: 'off' });
    expect(await code(setLabel(deps(), agent, T, { label: 'erittain-luottamuksellinen', confidence: 1 }))).toBe('AI_LABELLING_OFF');
  });

  it('lowering from a label that asks for a reason needs one, from a person too', async () => {
    await setLabel(deps(), person, T, { label: 'luottamuksellinen' });
    expect(await code(setLabel(deps(), person, T, { label: 'julkinen' }))).toBe('JUSTIFICATION_REQUIRED');
    const r = await setLabel(deps(), person, T, { label: 'julkinen', justification: 'The contract was published.' });
    expect(r).toMatchObject({ applied: true, label: 'julkinen' });
    expect((await storage.getContentLabel(T))?.justification).toBe('The contract was published.');
  });

  it("humanSaid makes an AI's call the person's, and the words stay on the record", async () => {
    const r = await setLabel(deps(), agent, T, { label: 'luottamuksellinen', humanSaid: 'Merkitse tämä luottamukselliseksi.' });
    expect(r).toMatchObject({ applied: true, source: 'human-via-ai', locked: true });
    const row = await storage.getContentLabel(T);
    expect(row?.humanSaid).toBe('Merkitse tämä luottamukselliseksi.');
    expect(row?.history.at(-1)?.humanSaid).toBe('Merkitse tämä luottamukselliseksi.');
  });

  it('a person accepts or rejects a suggestion; an AI without the words cannot', async () => {
    await setLabel(deps(), person, T, { label: 'sisainen' });
    await setLabel(deps(), agent, T, { label: 'luottamuksellinen', confidence: 0.9 });
    expect(await code(reviewLabel(deps(), agent, T, { decision: 'accept' }))).toBe('PERSON_REQUIRED');
    const acc = await reviewLabel(deps(), person, T, { decision: 'accept' });
    expect(acc).toMatchObject({ applied: true, label: 'luottamuksellinen', source: 'human', locked: true });
    expect((await storage.getContentLabel(T))?.suggestion).toBeNull();
    await setLabel(deps(), rule, T, { label: 'erittain-luottamuksellinen' });
    const rej = await reviewLabel(deps(), person, T, { decision: 'reject' });
    expect(rej.label).toBe('luottamuksellinen');
    const row = await storage.getContentLabel(T);
    expect(row?.suggestion).toBeNull();
    expect(row?.history.at(-1)?.action).toBe('reject');
    expect(await code(reviewLabel(deps(), person, T, { decision: 'accept' }))).toBe('NO_SUGGESTION');
  });

  it("nobody labels someone else's content, and an unknown label is refused", async () => {
    const bob: LabelActor = { principal: `bob@${NODE}`, ownerGhii: `bob@${NODE}`, ownerName: 'bob', kind: 'human' };
    expect(await code(setLabel(deps(), bob, T, { label: 'julkinen' }))).toBe('NOT_FOUND');
    expect(await code(setLabel(deps(), person, T, { label: 'top-secret' }))).toBe('LABEL_UNKNOWN');
    expect(await code(setLabel(deps(), person, rowTarget('o1', 'ws1', 'task', 'r1'), { label: 'julkinen' }))).toBe('NOT_FOUND');
  });

  it('labelsFor answers every target, the default where no row exists', async () => {
    await setLabel(deps(), person, T, { label: 'luottamuksellinen' });
    const other = memoryTarget(ALICE, 'notes.other');
    const file = fileTarget(ALICE, 'docs/a.pdf');
    const map = await labelsFor(storage, defaultPolicy(), [T, other, file]);
    expect(map.get(targetId(T))?.label).toBe('luottamuksellinen');
    expect(map.get(targetId(other))).toEqual({ label: 'sisainen', row: null });
    expect(map.get(targetId(file))?.label).toBe('sisainen');
  });

  it('an organism key belongs to the organism, whoever wrote it', () => {
    expect(memoryTarget(ALICE, 'organism.o1.w.ws1.room.x')).toEqual({ kind: 'memory', scope: 'organism:o1', key: 'organism.o1.w.ws1.room.x' });
    expect(memoryTarget(ALICE, 'notes.a').scope).toBe(ALICE);
  });

  it('who is an AI is decided from the credential', () => {
    expect(readerKindOf({ roles: ['owner'] })).toBe('human');
    expect(readerKindOf({ roles: ['owner', 'operator'] })).toBe('human');
    expect(readerKindOf({ roles: ['app'] })).toBe('human');
    expect(readerKindOf({ roles: ['agent'] })).toBe('ai');
    expect(readerKindOf({ roles: ['ecosystem'] })).toBe('ai');
    expect(readerKindOf({ roles: ['operator'] })).toBe('ai');
    expect(readerKindOf({ roles: ['agent'], anonymous: true })).toBe('anonymous');
    expect(readerKindOf(undefined)).toBe('anonymous');
    expect(readerKindOf({ roles: [] })).toBe('ai');
    const a = labelActorOf({ sub: `claude#${ALICE}`, owner: 'alice', roles: ['agent'] }, NODE);
    expect(a).toMatchObject({ kind: 'ai', ownerGhii: ALICE, ownerName: 'alice', principal: `claude#${ALICE}` });
    expect(() => labelActorOf({ sub: 'x@other', owner: 'x@other', roles: ['federated'], federated: true }, NODE)).toThrow(ClassificationError);
  });

  it('the switch: off reads nothing, all is on, owner reads the owner record', async () => {
    const spy = vi.spyOn(storage, 'getMemory');
    expect(await classificationActiveFor(storage, { classificationMode: 'off' }, ALICE)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(await classificationActiveFor(storage, { classificationMode: 'all' }, 'organism:o1')).toBe(true);
    expect(await classificationActiveFor(storage, { classificationMode: 'owner' }, ALICE)).toBe(false);
    await storage.setMemory({ ownerGaii: ALICE, key: OWNER_POLICY_KEY, value: { enabled: true }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: '2026-09-29T12:00:00.000Z', updatedAt: '2026-09-29T12:00:00.000Z' } as never);
    expect(await classificationActiveFor(storage, { classificationMode: 'owner' }, ALICE)).toBe(true);
    expect(await classificationActiveFor(storage, { classificationMode: 'owner' }, 'organism:o1')).toBe(false);
  });
});
