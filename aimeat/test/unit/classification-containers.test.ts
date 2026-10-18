/**
 * @file test/unit/classification-containers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification of containers and the effective label of content (plan
 *   doc-mvdipuyqraas, L1) on a real SQLite store with the switch on for everyone: which containers a
 *   piece of content sits in, the effective label and where it came from, a container counted only
 *   when someone set its label, the batch read (container rows read once per kind and scope, not
 *   once per item), the reader and the federation exit deciding on the effective label, the label
 *   rules on a container (an AI and a rule never lower it, a person lowering needs a reason), who may
 *   set a board's or an app's label, and the detection rules that name a container kind.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ContentLabelTarget } from '../../src/storage/interface.js';
import {
  appTarget, boardPostTarget, boardTarget, containersOf, organismTarget, workspaceTarget,
} from '../../src/services/classification/containers.js';
import { effectiveLabel, effectiveLabels } from '../../src/services/classification/effective.js';
import {
  ClassificationError, memoryTarget, readContentLabel, rowTarget, setLabel, targetId, targetOf, fileTarget, type LabelActor,
} from '../../src/services/classification/labels.js';
import { readerForAgent, readerFor } from '../../src/services/classification/reader.js';
import { leaveToPeer } from '../../src/services/classification/egress.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { ruleApplies } from '../../src/services/classification/detect.js';
import { hideFromAiOnNode, HIDDEN_LABEL } from './classification-fixtures.js';

const N = 'n';
const ALICE = `alice@${N}`;
const deps = (storage: SqliteStorage) => ({ storage, config: { classificationMode: 'all' as const, nodeId: N } });
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const bob: LabelActor = { principal: `bob@${N}`, ownerGhii: `bob@${N}`, ownerName: 'bob', kind: 'human' };
const rule: LabelActor = { principal: `system@${N}`, ownerGhii: `system@${N}`, ownerName: null, kind: 'rule' };
const DOC = 'organism.o1.w.ws1.notes.plan';

/** A label row as a person set it, written straight to the store (a container's access is not the question here). */
async function put(storage: SqliteStorage, t: ContentLabelTarget, label: string, source: 'human' | 'default' = 'human'): Promise<void> {
  await storage.putContentLabel({
    ...t, id: `row-${t.kind}-${t.key}`, ownerGaii: null, label, source, locked: source === 'human',
    suggestion: null, justification: null, humanSaid: null, history: [], setBy: ALICE, updatedAt: '2026-10-18T00:00:00.000Z',
  });
}

describe('containersOf: the containers a piece of content sits in, nearest first', () => {
  it('names the workspace and the organism of organism content, a row and a shared file', () => {
    expect(containersOf(memoryTarget(ALICE, DOC)).map(c => [c.from, c.target.kind, c.target.key]))
      .toEqual([['workspace', 'workspace', 'ws1'], ['organism', 'organism', 'o1']]);
    expect(containersOf(memoryTarget(ALICE, 'organism.o1.notes.kept')).map(c => c.from)).toEqual(['organism']);
    expect(containersOf(rowTarget('o1', 'ws1', 'events', 'r1')).map(c => c.target.key)).toEqual(['ws1', 'o1']);
    expect(containersOf(fileTarget(ALICE, 'plan.png', 'o1/ws1')).map(c => c.target.key)).toEqual(['ws1', 'o1']);
  });

  it('names the organism of a workspace, the board of a post, the app of its namespace, and nothing for the rest', () => {
    expect(containersOf(workspaceTarget('o1', 'ws1'))).toEqual([{ target: organismTarget('o1'), from: 'organism' }]);
    const board = { id: 'board-1', ownerGaii: ALICE };
    expect(containersOf(boardPostTarget(board, 'p1'))).toEqual([{ target: boardTarget(board), from: 'board' }]);
    expect(containersOf(memoryTarget(`eco:drum#alice@${N}`, 'k'))).toEqual([{ target: appTarget(ALICE, 'drum'), from: 'app' }]);
    expect(containersOf(memoryTarget(ALICE, 'notes.x'))).toEqual([]);
    expect(containersOf(memoryTarget(`claude#alice@${N}`, 'notes.x'))).toEqual([]);
    expect(containersOf(organismTarget('o1'))).toEqual([]);
    expect(containersOf(boardTarget(board))).toEqual([]);
    expect(containersOf(appTarget(ALICE, 'notes.html'))).toEqual([]);
  });

  it('addresses an app by its slug, the name its GEAI carries', () => {
    expect(appTarget(`claude#alice@${N}`, 'Notes App.html')).toEqual({ kind: 'app', scope: ALICE, key: 'notes-app-html' });
  });
});

describe('effectiveLabels: the highest of the own label and the containers\' labels', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());

  it('raises a public document to its workspace\'s label and says so; the organism\'s wins when higher', async () => {
    const doc = memoryTarget(ALICE, DOC);
    await put(storage, doc, 'julkinen');
    expect(await effectiveLabel(deps(storage), doc)).toEqual({ label: 'julkinen', from: 'own' });
    await put(storage, workspaceTarget('o1', 'ws1'), 'luottamuksellinen');
    expect(await effectiveLabel(deps(storage), doc)).toEqual({ label: 'luottamuksellinen', from: 'workspace' });
    await put(storage, organismTarget('o1'), 'erittain-luottamuksellinen');
    expect(await effectiveLabel(deps(storage), doc)).toEqual({ label: 'erittain-luottamuksellinen', from: 'organism' });
    // The workspace itself reads its organism's.
    expect(await effectiveLabel(deps(storage), workspaceTarget('o1', 'ws1'))).toEqual({ label: 'erittain-luottamuksellinen', from: 'organism' });
  });

  it('keeps the own label when it is the higher, and an unlabelled container raises nothing', async () => {
    const doc = memoryTarget(ALICE, DOC);
    await put(storage, doc, 'erittain-luottamuksellinen');
    await put(storage, workspaceTarget('o1', 'ws1'), 'luottamuksellinen');
    expect(await effectiveLabel(deps(storage), doc)).toEqual({ label: 'erittain-luottamuksellinen', from: 'own' });
    const other = memoryTarget(ALICE, 'organism.o1.w.ws2.notes.x');
    await put(storage, other, 'julkinen');
    expect(await effectiveLabel(deps(storage), other)).toEqual({ label: 'julkinen', from: 'own' });
  });

  it('does not count a container row that only carries a suggestion over the default', async () => {
    const doc = memoryTarget(ALICE, DOC);
    await put(storage, doc, 'julkinen');
    await put(storage, workspaceTarget('o1', 'ws1'), 'sisainen', 'default');
    expect(await effectiveLabel(deps(storage), doc)).toEqual({ label: 'julkinen', from: 'own' });
  });

  it('reads a board post as its board\'s, and an app\'s data as its app\'s', async () => {
    const board = { id: 'board-1', ownerGaii: ALICE };
    await put(storage, boardTarget(board), 'luottamuksellinen');
    expect(await effectiveLabel(deps(storage), boardPostTarget(board, 'p1'))).toEqual({ label: 'luottamuksellinen', from: 'board' });
    await put(storage, appTarget(ALICE, 'drum'), 'erittain-luottamuksellinen');
    expect(await effectiveLabel(deps(storage), memoryTarget(`eco:drum#alice@${N}`, 'k'))).toEqual({ label: 'erittain-luottamuksellinen', from: 'app' });
    expect(await effectiveLabel(deps(storage), fileTarget(`eco:drum#alice@${N}`, 'f.pdf'))).toEqual({ label: 'erittain-luottamuksellinen', from: 'app' });
  });

  it('reads the containers of a whole page in one query per kind and scope, not one per item', async () => {
    await put(storage, workspaceTarget('o1', 'ws1'), 'luottamuksellinen');
    const targets = Array.from({ length: 200 }, (_, i) => memoryTarget(ALICE, `organism.o1.w.ws1.notes.n${i}`));
    const spy = vi.spyOn(storage, 'getContentLabels');
    const eff = await effectiveLabels(storage, defaultPolicy(), targets);
    expect([...eff.values()].every(e => e.label === 'luottamuksellinen' && e.from === 'workspace')).toBe(true);
    // The own labels (one) and the two container kinds (workspace, organism).
    expect(spy.mock.calls.length).toBe(3);
    expect(eff.get(targetId(targets[0]!))?.row).toBeNull();
  });
});

describe('the reader and the federation exit decide on the effective label', () => {
  let storage: SqliteStorage;
  beforeEach(async () => { storage = new SqliteStorage(':memory:'); await hideFromAiOnNode(storage, N); });
  afterEach(() => storage.close());
  const rec = (key: string) => ({ ownerGaii: ALICE, key, value: key });
  const t = (r: { ownerGaii: string; key: string }) => memoryTarget(r.ownerGaii, r.key);

  it('hides the documents of a workspace hidden from AI from an AI, and shows them to the person', async () => {
    const items = [rec(DOC), rec('organism.o1.w.ws2.notes.other')];
    await put(storage, workspaceTarget('o1', 'ws1'), HIDDEN_LABEL);
    const ai = readerForAgent(deps(storage), `claude#alice@${N}`);
    expect((await ai.show(items, t)).map(r => r.key)).toEqual(['organism.o1.w.ws2.notes.other']);
    expect((await readerFor(deps(storage), { sub: 'alice', owner: 'alice', roles: ['owner'] }).show(items, t)).length).toBe(2);
  });

  it('keeps a public record of a confidential workspace on this node, and names where its label came from', async () => {
    const pub = rec(DOC);
    await put(storage, memoryTarget(ALICE, DOC), 'julkinen');
    expect((await leaveToPeer(deps(storage), [pub], 'peer-1')).map(r => r.key)).toEqual([DOC]);
    await put(storage, workspaceTarget('o1', 'ws1'), 'luottamuksellinen');
    expect(await leaveToPeer(deps(storage), [pub], 'peer-1')).toEqual([]);
    const { left } = await readerFor(deps(storage), { sub: 'alice', owner: 'alice', roles: ['owner'] })
      .leave([pub], t, { kind: 'export', organismId: 'o1' });
    expect(left[0]).toMatchObject({ label: 'luottamuksellinen', from: 'workspace' });
    expect(left[0]!.reason).toMatch(/Confidential \(from its workspace\), which may not leave its organism/);
  });

  it('hides the posts of a board hidden from AI from an AI', async () => {
    const board = { id: 'board-1', ownerGaii: ALICE };
    const posts = [{ id: 'p1' }, { id: 'p2' }];
    const ai = readerForAgent(deps(storage), `claude#alice@${N}`);
    expect((await ai.show(posts, p => boardPostTarget(board, p.id))).length).toBe(2);
    await put(storage, boardTarget(board), HIDDEN_LABEL);
    expect(await ai.show(posts, p => boardPostTarget(board, p.id))).toEqual([]);
  });
});

describe('a container\'s label follows the label rules', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());
  const board = (id: string, owner: string, visibility: 'public' | 'private') => storage.createBoard({
    id, name: id, visibility, ownerGaii: owner, allowedGaiis: [], createdAt: '2026-10-18T00:00:00.000Z',
  });

  it('a person sets a board\'s label and it locks; the label read says own and effective', async () => {
    await board('board-a', ALICE, 'public');
    const t = targetOf(alice, { kind: 'board', board_id: 'board-a' });
    expect(await setLabel(deps(storage), alice, t, { label: 'luottamuksellinen' })).toMatchObject({ applied: true, locked: true });
    const view = await readContentLabel(deps(storage), alice, t);
    expect(view.target).toEqual({ kind: 'board', scope: ALICE, key: 'board-a' });
    expect(view.effective).toMatchObject({ label: 'luottamuksellinen', from: 'own' });
  });

  it('an AI and a rule never lower a container\'s label, and a person lowering it gives a reason', async () => {
    await board('board-a', ALICE, 'public');
    const t = targetOf(alice, { kind: 'board', board_id: 'board-a' });
    await setLabel(deps(storage), alice, t, { label: 'luottamuksellinen' });
    const ai: LabelActor = { ...alice, principal: `claude#alice@${N}`, kind: 'ai', roles: ['agent'] };
    expect(await setLabel(deps(storage), ai, t, { label: 'julkinen', confidence: 1 })).toMatchObject({ applied: false, label: 'luottamuksellinen' });
    expect(await setLabel(deps(storage), rule, boardTarget({ id: 'board-a', ownerGaii: ALICE }), { label: 'julkinen' }))
      .toMatchObject({ applied: false, label: 'luottamuksellinen' });
    await expect(setLabel(deps(storage), alice, t, { label: 'julkinen' })).rejects.toMatchObject({ code: 'JUSTIFICATION_REQUIRED' });
    expect(await setLabel(deps(storage), alice, t, { label: 'julkinen', justification: 'The board is a public notice board.' }))
      .toMatchObject({ applied: true, label: 'julkinen' });
  });

  it('another owner gets 403 on a public board and 404 on a private one or none', async () => {
    await board('board-pub', ALICE, 'public');
    await board('board-priv', ALICE, 'private');
    const as = (id: string) => setLabel(deps(storage), bob, targetOf(bob, { kind: 'board', board_id: id }), { label: 'julkinen' });
    await expect(as('board-pub')).rejects.toMatchObject({ status: 403, code: 'NOT_ALLOWED' });
    await expect(as('board-priv')).rejects.toMatchObject({ status: 404 });
    await expect(as('board-none')).rejects.toMatchObject({ status: 404 });
  });

  it('an app label names an app the owner has; an exception is refused for a container', async () => {
    const t = targetOf(alice, { kind: 'app', app: 'nothing.html' });
    expect(t).toEqual({ kind: 'app', scope: ALICE, key: 'nothing-html' });
    await expect(setLabel(deps(storage), alice, t, { label: 'luottamuksellinen' })).rejects.toMatchObject({ status: 404 });
    expect(() => targetOf(alice, { kind: 'board', board_id: 'a/b' })).toThrow(ClassificationError);
    expect(() => targetOf(alice, { kind: 'workspace', organism_id: 'o1' })).toThrow(ClassificationError);
    expect(() => targetOf(alice, { kind: 'shelf' })).toThrow(/organism, workspace, board, app/);
  });
});

describe('detection rules and containers (L1.6)', () => {
  const base = { id: 'r', name: 'r', kind: 'keyword' as const, pattern: 'salainen', flags: '', minLabel: 'luottamuksellinen', enabled: true };

  it('a rule matches a container only when its kinds name that container', () => {
    expect(ruleApplies(base, boardTarget({ id: 'b', ownerGaii: ALICE }))).toBe(false);
    expect(ruleApplies({ ...base, appliesTo: { kinds: ['board'] } }, boardTarget({ id: 'b', ownerGaii: ALICE }))).toBe(true);
    expect(ruleApplies({ ...base, appliesTo: { kinds: ['board'] } }, organismTarget('o1'))).toBe(false);
    expect(ruleApplies({ ...base, appliesTo: { kinds: ['workspace'], organismId: 'o2' } }, workspaceTarget('o1', 'ws1'))).toBe(false);
    // Content keeps matching a rule with no scope, as before.
    expect(ruleApplies(base, memoryTarget(ALICE, 'notes.x'))).toBe(true);
  });
});
