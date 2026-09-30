/**
 * @file test/unit/classification-documents.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One classification per workspace document or organism record (TARGET-082, decided by
 *   Jouni 2026-09-30), against SqliteStorage(':memory:'): every copy's key (bare, `.draft`,
 *   `.latest`, `.version.N`) has the document's label address, so a label set on one copy reads on
 *   all of them and a publish makes no unlabelled copy; a label a copy carried under its own key
 *   before reads into the document's label, the strictest one winning; the next write folds those
 *   rows away; and the owner lowering the document's label leaves the change in the history and an
 *   audit `changed` row naming the document and from → to.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-documents.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ContentLabelRow, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import {
  documentKeyOf, memoryTarget, labelAddressOf, documentContentKeys, setLabel, labelsFor, readContentLabel, targetId,
  type LabelActor,
} from '../../src/services/classification/labels.js';
import { readerForAgent } from '../../src/services/classification/reader.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { pendingClassificationAudit, resetClassificationAudit } from '../../src/services/classification/audit.js';
import { queuedItemText } from '../../src/services/classification-queue-job.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const ORG = 'o1';
const DOC = `organism.${ORG}.w.ws1.notes.a`;
const stamp = '2026-09-30T12:00:00.000Z';
const alice: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human', roles: ['owner'] };
const rule: LabelActor = { principal: `system@${N}`, ownerGhii: `system@${N}`, ownerName: null, kind: 'rule' };

describe('one classification per document', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage, config: { classificationMode: 'all' as const, nodeId: N }, now: () => stamp });
  const put = (key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
  });
  /** A label row as it was stored under a copy's own key before a document had one address. */
  const oldRow = (key: string, label: string, locked = true): ContentLabelRow => ({
    id: `old-${key}`, kind: 'memory', scope: `organism:${ORG}`, key, ownerGaii: null, label, source: locked ? 'human' : 'rule', locked,
    suggestion: null, justification: null, humanSaid: null,
    history: [{ at: stamp, by: ALICE, source: 'human', action: 'set', from: 'sisainen', to: label }], setBy: ALICE, updatedAt: stamp,
  });
  const labelOf = async (key: string) => {
    const t = memoryTarget(ALICE, key);
    return (await labelsFor(storage, defaultPolicy(), [t])).get(targetId(t))?.label;
  };

  /** alice creates organism o1 and workspace ws1. */
  async function organism(): Promise<void> {
    await storage.createGHII({ username: 'alice', nodeId: N, ghii: ALICE, displayName: 'alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] });
    await put(`organism.${ORG}.w.ws1.meta.manifest`, { manifestVersion: '1', name: 'Board', kind: 'project', objectTypes: [] });
  }

  beforeEach(async () => { storage = new SqliteStorage(':memory:'); resetClassificationAudit(); await organism(); });
  afterEach(() => { storage.close(); resetClassificationAudit(); });

  it('maps every copy of a document to one address, and leaves every other key alone', () => {
    for (const suffix of ['', '.draft', '.latest', '.version.1', '.version.12']) expect(documentKeyOf(`${DOC}${suffix}`)).toBe(DOC);
    expect(documentKeyOf(`organism.${ORG}.tasks.t1.latest`)).toBe(`organism.${ORG}.tasks.t1`);
    // Too short to be a document, or not an organism key: its own address.
    for (const k of [`organism.${ORG}.meta.latest`, `organism.${ORG}.w.ws1.meta.latest`, `organism.${ORG}.w.ws1.meta.manifest`, 'notes.draft', `${DOC}.version.x`]) {
      expect(documentKeyOf(k)).toBe(k);
    }
    expect(memoryTarget(ALICE, `${DOC}.latest`)).toEqual({ kind: 'memory', scope: `organism:${ORG}`, key: DOC });
    expect(memoryTarget(ALICE, 'notes.draft')).toEqual({ kind: 'memory', scope: ALICE, key: 'notes.draft' });
    expect(labelAddressOf({ kind: 'memory', scope: `organism:${ORG}`, key: `${DOC}.draft` }).key).toBe(DOC);
    expect(documentContentKeys(`${DOC}.version.3`)).toEqual([DOC, `${DOC}.latest`, `${DOC}.draft`]);
    expect(documentContentKeys('notes.a')).toEqual(['notes.a']);
  });

  it('a label set on the draft reads on every copy, so publishing makes no unlabelled copy', async () => {
    await setLabel(deps(), alice, memoryTarget(ALICE, `${DOC}.draft`), { label: 'luottamuksellinen' });
    for (const suffix of ['', '.draft', '.latest', '.version.4']) expect(await labelOf(`${DOC}${suffix}`)).toBe('luottamuksellinen');
    const rows = await storage.listContentLabels({ scope: `organism:${ORG}` });
    expect(rows.map(r => r.key)).toEqual([DOC]);
    // An AI reading the published copy sees it with the warning its label asks for.
    const shown = await readerForAgent(deps(), `claude#${ALICE}`).show([{ ownerGaii: ALICE, key: `${DOC}.latest` }], r => memoryTarget(r.ownerGaii, r.key));
    expect((shown[0] as unknown as { classificationWarning?: { label: string } }).classificationWarning?.label).toBe('luottamuksellinen');
  });

  it("a copy's older label reads into the document's, the strictest one winning", async () => {
    await storage.putContentLabel(oldRow(`${DOC}.draft`, 'sisainen'));
    await storage.putContentLabel(oldRow(`${DOC}.version.2`, 'erittain-luottamuksellinen'));
    await storage.putContentLabel(oldRow(`${DOC}.latest`, 'luottamuksellinen'));
    // A sibling document's row is not this document's.
    await storage.putContentLabel(oldRow(`${DOC}b.latest`, 'julkinen'));
    for (const suffix of ['', '.draft', '.latest']) expect(await labelOf(`${DOC}${suffix}`)).toBe('erittain-luottamuksellinen');
    expect(await labelOf(`${DOC}b`)).toBe('julkinen');
    const view = await readContentLabel(deps(), alice, memoryTarget(ALICE, `${DOC}.latest`));
    expect(view).toMatchObject({ target: { key: DOC }, label: 'erittain-luottamuksellinen', locked: true });
    // An AI does not see it: the old strictest label hides it from AI.
    expect(await readerForAgent(deps(), `claude#${ALICE}`).show([{ ownerGaii: ALICE, key: `${DOC}.latest` }], r => memoryTarget(r.ownerGaii, r.key))).toEqual([]);
    // A rule raising from the default does not weaken it: the document starts from the old label.
    const r = await setLabel(deps(), rule, memoryTarget(ALICE, `${DOC}.latest`), { label: 'luottamuksellinen' });
    expect(r).toMatchObject({ applied: false, from: 'erittain-luottamuksellinen' });
  });

  it('the owner lowering the document folds the old rows and leaves the change in the history and the audit log', async () => {
    await storage.putContentLabel(oldRow(`${DOC}.latest`, 'luottamuksellinen'));
    await storage.putContentLabel(oldRow(`${DOC}.version.1`, 'sisainen'));
    const target = memoryTarget(ALICE, `${DOC}.draft`);
    await expect(setLabel(deps(), alice, target, { label: 'julkinen' })).rejects.toMatchObject({ code: 'JUSTIFICATION_REQUIRED' });
    const r = await setLabel(deps(), alice, target, { label: 'julkinen', justification: 'The notes were published.' });
    expect(r).toMatchObject({ applied: true, from: 'luottamuksellinen', label: 'julkinen', source: 'human' });

    const rows = await storage.listContentLabels({ scope: `organism:${ORG}` });
    expect(rows.map(x => x.key)).toEqual([DOC]);
    expect(rows[0]!.history.at(-1)).toMatchObject({ action: 'set', from: 'luottamuksellinen', to: 'julkinen', justification: 'The notes were published.' });
    for (const suffix of ['', '.latest', '.version.1']) expect(await labelOf(`${DOC}${suffix}`)).toBe('julkinen');

    expect(pendingClassificationAudit({ scope: `organism:${ORG}` }).filter(a => a.action === 'changed')).toEqual([
      expect.objectContaining({ key: DOC, label: 'julkinen', reader: ALICE, purpose: 'luottamuksellinen → julkinen (human)' }),
    ]);
  });

  it("the classifier's queue reads a document's text from its current copies", async () => {
    await put(`${DOC}.latest`, 'published text');
    await put(`${DOC}.draft`, 'draft text with IBAN FI21 1234 5600 0007 85');
    const text = await queuedItemText(storage, { scope: `organism:${ORG}`, kind: 'memory', key: DOC, at: stamp });
    expect(text).toContain('published text');
    expect(text).toContain('draft text with IBAN');
    expect(await queuedItemText(storage, { scope: `organism:${ORG}`, kind: 'memory', key: `${DOC}x`, at: stamp })).toBeNull();
  });
});
