/**
 * @file test/unit/living-source-labels.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A living document's source copy inherits the strictest classification of its sources
 *   (TARGET-082 V4, services/living-source-labels.ts), against SqliteStorage(':memory:'): the
 *   strictest source wins; a copy already as strict is not written; a person's locked label is not
 *   changed (the rule leaves a suggestion); with the switch off nothing is read; a failure never
 *   throws. Then the wiring in the unattended pulse (living-pulse.ts), with the librarian and the
 *   model stubbed: a gathered copy and an agent deliverable's copy both carry their source's label.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-source-labels.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { setLabel, memoryTarget, type LabelActor } from '../../src/services/classification/labels.js';
import { inheritSourceLabels, INHERIT_REASON } from '../../src/services/living-source-labels.js';
import { logger } from '../../src/utils/logger.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AgentTaskRecord, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';

const hits: Array<{ key: string; ownerGaii: string; snippet: string; title: string; producer: string }> = [];
vi.mock('../../src/services/librarian.js', () => ({
  librarianSearch: async () => ({ hits: [...hits] }),
}));
vi.mock('../../src/services/ai/completion.js', () => ({
  AiCompletionError: class AiCompletionError extends Error { code = 'X'; },
  completeForOwner: async () => ({ content: 'derived', usage: { costUsd: 0 }, provenance: null }),
}));
const { pulseInstanceServer } = await import('../../src/services/living-pulse.js');

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const BOT = `bot#${ALICE}`;
const ORG = 'org1';
const COPY = `organism.${ORG}.w.ws1.living-src.doc1__s-abc.latest`;
const person: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const rule: LabelActor = { principal: `system@${NODE}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'rule' };
const on = { classificationMode: 'all' as const, nodeId: NODE };
const off = { classificationMode: 'off' as const, nodeId: NODE };
const now = () => new Date().toISOString();

async function put(storage: SqliteStorage, ownerGaii: string, key: string, value: unknown): Promise<void> {
  await storage.setMemory({ key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now(), updatedAt: now() });
}

describe('a living source copy inherits the strictest label of its sources', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); hits.length = 0; });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); });

  it('takes the strictest of several sources, set as a rule with the reason', async () => {
    const a = memoryTarget(ALICE, 'notes.a');
    const b = memoryTarget(ALICE, 'notes.b');
    await setLabel({ storage, config: on }, person, a, { label: 'luottamuksellinen' });
    await setLabel({ storage, config: on }, person, b, { label: 'erittain-luottamuksellinen' });
    await inheritSourceLabels({ storage, config: on }, ALICE, [{ key: COPY, sources: [a, b, memoryTarget(ALICE, 'notes.unlabelled')] }]);
    const row = await storage.getContentLabel(memoryTarget(ALICE, COPY));
    expect(row).toMatchObject({ label: 'erittain-luottamuksellinen', source: 'rule', locked: false, scope: `organism:${ORG}` });
    expect(row?.history.at(-1)).toMatchObject({ by: `system@${NODE}`, source: 'rule', reason: INHERIT_REASON });
  });

  it('writes nothing when the copy is already as strict (a default source into a default copy)', async () => {
    const put = vi.spyOn(storage, 'putContentLabel');
    await inheritSourceLabels({ storage, config: on }, ALICE, [{ key: COPY, sources: [memoryTarget(ALICE, 'notes.plain')] }]);
    expect(put).not.toHaveBeenCalled();
    expect(await storage.getContentLabel(memoryTarget(ALICE, COPY))).toBeFalsy();
  });

  it("never changes a person's locked label: a lower one gets a suggestion, a higher one nothing", async () => {
    // A person labels organism content only as an active member.
    await storage.createGHII({ username: 'alice', nodeId: NODE, ghii: ALICE, displayName: 'Alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: now(), updatedAt: now() } as never);
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, admins: [ALICE],
      members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'open', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: true, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: now(), updatedAt: now(),
    } as OrganismRecord);
    await storage.createMembership({ id: 'm1', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: now() } as OrganismMembershipRecord);
    const src = memoryTarget(ALICE, 'notes.secret');
    await setLabel({ storage, config: on }, person, src, { label: 'luottamuksellinen' });
    await setLabel({ storage, config: on }, person, memoryTarget(ALICE, COPY), { label: 'sisainen' });
    await inheritSourceLabels({ storage, config: on }, ALICE, [{ key: COPY, sources: [src] }]);
    const low = await storage.getContentLabel(memoryTarget(ALICE, COPY));
    expect(low).toMatchObject({ label: 'sisainen', locked: true });
    expect(low?.suggestion).toMatchObject({ label: 'luottamuksellinen', why: 'HUMAN_LABEL', source: 'rule' });

    const COPY2 = COPY.replace('s-abc', 's-def');
    await setLabel({ storage, config: on }, person, memoryTarget(ALICE, COPY2), { label: 'erittain-luottamuksellinen' });
    const before = (await storage.getContentLabel(memoryTarget(ALICE, COPY2)))!.history.length;
    await inheritSourceLabels({ storage, config: on }, ALICE, [{ key: COPY2, sources: [src] }]);
    const high = await storage.getContentLabel(memoryTarget(ALICE, COPY2));
    expect(high).toMatchObject({ label: 'erittain-luottamuksellinen', suggestion: null });
    expect(high!.history.length).toBe(before);
  });

  it('with the switch off reads nothing and writes nothing', async () => {
    const reads = vi.spyOn(storage, 'getContentLabels');
    const mem = vi.spyOn(storage, 'getMemory');
    const writes = vi.spyOn(storage, 'putContentLabel');
    await inheritSourceLabels({ storage, config: off }, ALICE, [{ key: COPY, sources: [memoryTarget(ALICE, 'notes.a')] }]);
    expect(reads).not.toHaveBeenCalled();
    expect(mem).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('a failure logs a warning and never throws', async () => {
    const src = memoryTarget(ALICE, 'notes.a');
    await setLabel({ storage, config: on }, person, src, { label: 'luottamuksellinen' });
    vi.spyOn(storage, 'putContentLabel').mockRejectedValue(new Error('disk full'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    await expect(inheritSourceLabels({ storage, config: on }, ALICE, [{ key: COPY, sources: [src] }])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('inherited label was not set'), expect.objectContaining({ key: COPY }));
  });
});

describe('the unattended pulse labels the copies it writes', () => {
  let storage: SqliteStorage;
  const loc = { orgId: ORG, wsId: 'ws1', docId: 'doc1' };
  const copies = async () => (await storage.listAllMemory({ prefix: `organism.${ORG}.w.ws1.living-src.doc1__`, limit: 50 })).items;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); hits.length = 0; });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); });

  it('a gathered copy carries the label of the item it was copied from', async () => {
    await put(storage, ALICE, 'notes.contract', 'the terms');
    await setLabel({ storage, config: on }, person, memoryTarget(ALICE, 'notes.contract'), { label: 'luottamuksellinen' });
    hits.push({ key: 'notes.contract', ownerGaii: ALICE, snippet: 'the terms', title: 'Contract', producer: ALICE });
    const cfg = { type: 'living-config', charter: { scope: 'x' }, template: [{ slot: 's1', section: 'Summary' }], status: {} };
    await pulseInstanceServer(storage, on as AimeatConfig, ALICE, loc, cfg);
    const [copy] = await copies();
    expect(copy).toBeDefined();
    expect(await storage.getContentLabel(memoryTarget(ALICE, copy.key))).toMatchObject({ label: 'luottamuksellinen', source: 'rule' });
  });

  it("an agent deliverable's copy carries the deliverable's label", async () => {
    await put(storage, BOT, 'out.report', 'agent findings');
    await setLabel({ storage, config: on }, rule, memoryTarget(BOT, 'out.report'), { label: 'erittain-luottamuksellinen' });
    const task: AgentTaskRecord = {
      id: 't1', agentGaii: BOT, ownerGaii: ALICE, title: 'Research', description: 'Research',
      scope: [], rules: [], verification: { userExpects: '', technicalChecks: [] }, resources: {}, todos: [],
      status: 'done', deliverableKey: 'out.report', createdAt: now(), updatedAt: now(),
    } as AgentTaskRecord;
    await storage.createAgentTask(task);
    await put(storage, ALICE, `organism.${ORG}.w.ws1.living-task.doc1__s2.latest`, { taskId: 't1' });
    const cfg = { type: 'living-config', charter: { scope: 'x' }, template: [{ slot: 's2', section: 'Agent', agent: 'bot/offer1' }], status: {} };
    await pulseInstanceServer(storage, on as AimeatConfig, ALICE, loc, cfg);
    const [copy] = await copies();
    expect(copy).toBeDefined();
    expect(await storage.getContentLabel(memoryTarget(ALICE, copy.key))).toMatchObject({ label: 'erittain-luottamuksellinen', source: 'rule' });
  });

  it('with the switch off the pulse writes the copy and no label', async () => {
    await put(storage, ALICE, 'notes.contract', 'the terms');
    hits.push({ key: 'notes.contract', ownerGaii: ALICE, snippet: 'the terms', title: 'Contract', producer: ALICE });
    const labels = vi.spyOn(storage, 'getContentLabels');
    const cfg = { type: 'living-config', charter: { scope: 'x' }, template: [{ slot: 's1', section: 'Summary' }], status: {} };
    await pulseInstanceServer(storage, off as AimeatConfig, ALICE, loc, cfg);
    expect(await copies()).toHaveLength(1);
    expect(labels).not.toHaveBeenCalled();
  });
});
