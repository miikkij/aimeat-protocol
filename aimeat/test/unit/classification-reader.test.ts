/**
 * @file test/unit/classification-reader.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check component's decisions (TARGET-082 V4) on a real SQLite store with the
 *   switch on for everyone: an AI does not see hidden content and sees warning content with a
 *   warning; a person outside a label's audience does not see it; an AI call with hidden content is
 *   refused whoever asks; content that may not leave its organism stays out of an export while a
 *   person's own export takes everything; a row takes its row space's label; and nobody sets a label
 *   whose audience leaves them out. The review fixes: the system reader's show() reads nothing, the
 *   node's policy is read once per call however many scopes, a long list an AI is shown is one audit
 *   row per label with a count, and warningsNote() says what an AI-call answer carries.
 * @version-history
 *   v1.1.0 — 2026-09-29 — The review fixes (TARGET-082 review, findings 4, 5 and 7).
 *   v1.1.0 — 2026-09-29 — The owner of personal content is never locked out by its label's audience
 *     (TARGET-082 review finding 9); the lockout test moved to organism content.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { readerFor, readerForAgent, systemReader, warningsNote } from '../../src/services/classification/reader.js';
import { pendingClassificationAudit, resetClassificationAudit } from '../../src/services/classification/audit.js';
import { memoryTarget, rowTarget, setLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { writePolicy } from '../../src/services/classification/policy-admin.js';

const N = 'n';
const deps = (storage: SqliteStorage) => ({ storage, config: { classificationMode: 'all' as const, nodeId: N } });
const alice: LabelActor = { principal: `alice@${N}`, ownerGhii: `alice@${N}`, ownerName: 'alice', kind: 'human' };
const aliceAuth = { sub: 'alice', owner: 'alice', roles: ['owner'] };

describe('the check component decides', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => storage.close());

  const rec = (key: string) => ({ ownerGaii: `alice@${N}`, key, value: key });
  const t = (r: { ownerGaii: string; key: string }) => memoryTarget(r.ownerGaii, r.key);

  it('hides hidden content from an AI, warns about warning content, and shows the person everything', async () => {
    const d = deps(storage);
    await setLabel(d, alice, t(rec('secret')), { label: 'erittain-luottamuksellinen' });
    await setLabel(d, alice, t(rec('conf')), { label: 'luottamuksellinen' });
    const items = [rec('secret'), rec('conf'), rec('plain')];

    const ai = readerForAgent(d, `claude#alice@${N}`);
    const seen = await ai.show(items, t);
    expect(seen.map(r => r.key)).toEqual(['conf', 'plain']);
    expect((seen[0] as unknown as { classificationWarning: { label: string } }).classificationWarning.label).toBe('luottamuksellinen');
    expect(ai.warnings.map(w => w.key)).toEqual(['conf']);

    expect((await readerFor(d, aliceAuth).show(items, t)).map(r => r.key)).toEqual(['secret', 'conf', 'plain']);
    expect((await systemReader(d, `alice@${N}`).show(items, t)).length).toBe(3);
  });

  it('refuses an AI call that names hidden content, whoever asks', async () => {
    const d = deps(storage);
    await setLabel(d, alice, t(rec('secret')), { label: 'erittain-luottamuksellinen' });
    for (const reader of [readerFor(d, aliceAuth), systemReader(d, `alice@${N}`)]) {
      await expect(reader.useForAi([t(rec('secret')), t(rec('plain'))], { capability: 'text' }))
        .rejects.toMatchObject({ code: 'CLASSIFIED' });
    }
    await expect(readerFor(d, aliceAuth).useForAi([t(rec('plain'))], { capability: 'text' })).resolves.toBeUndefined();
  });

  it('keeps organism content that may not leave, and lets a person export their own', async () => {
    const d = deps(storage);
    const org = { ownerGaii: `alice@${N}`, key: 'organism.o1.w.ws1.doc.a', value: 'x' };
    const reader = readerFor(d, aliceAuth);
    const out = await reader.leave([org], t, { kind: 'export', organismId: 'o1' });
    expect(out.left.map(l => l.label)).toEqual(['sisainen']);
    const own = await reader.leave([rec('conf')], t, { kind: 'export', organismId: null });
    expect(own.kept.length).toBe(1);
    // A person's own record may go to another node; the organism's may not.
    expect((await reader.leave([rec('plain')], t, { kind: 'federation', peer: 'p' })).left.length).toBe(0);
    expect((await reader.leave([org], t, { kind: 'external', to: 'linkedin' })).left.length).toBe(1);
  });

  it("gives a row its row space's label and hides it from someone outside the audience", async () => {
    const d = deps(storage);
    await writePolicy(d, { ...alice, principal: `alice@${N}` }, 'owner', null, {
      labels: [{ id: 'johto', rank: 40, name: { en: 'Management only' }, audience: { people: ['alice'] } }],
    });
    // The owner-level label applies to alice's personal content; a row of an organism is not hers.
    const mine = t(rec('board-minutes'));
    await setLabel(d, alice, mine, { label: 'johto' });
    const bob = readerFor(d, { sub: 'bob', owner: 'bob', roles: ['owner'] });
    expect(await bob.show([rec('board-minutes')], t)).toEqual([]);
    expect((await readerFor(d, aliceAuth).show([rec('board-minutes')], t)).length).toBe(1);

    const row = rowTarget('o1', 'ws1', 'events', 'r1');
    const reader = readerForAgent(d, `claude#alice@${N}`);
    await storage.putContentLabel({
      ...{ kind: 'row', scope: 'organism:o1', key: 'ws1/events' }, id: 'x', ownerGaii: null, label: 'erittain-luottamuksellinen',
      source: 'human', locked: true, suggestion: null, justification: null, humanSaid: null, history: [], setBy: alice.principal, updatedAt: '2026-09-29T00:00:00Z',
    });
    expect(await reader.show([{ id: 'r1' }], () => row)).toEqual([]);
  });

  it("the system reader's show() reads nothing (finding 5)", async () => {
    const reads = [vi.spyOn(storage, 'getMemory'), vi.spyOn(storage, 'getContentLabels')];
    const items = [rec('a'), rec('b')];
    expect(await systemReader(deps(storage), `alice@${N}`).show(items, t)).toEqual(items);
    for (const r of reads) expect(r).not.toHaveBeenCalled();
  });

  it("reads the node's policy once per call, however many scopes (finding 5)", async () => {
    const read = vi.spyOn(storage, 'getMemory');
    const items = ['alice', 'bob', 'carol'].map(o => ({ ownerGaii: `${o}@${N}`, key: 'k', value: 'v' }));
    await readerForAgent(deps(storage), `claude#alice@${N}`).show(items, t);
    expect(read.mock.calls.filter(([, key]) => key === 'classification.policy.node')).toHaveLength(1);
  });

  it('records a long audited list an AI is shown as one row per label, with the count (finding 4)', async () => {
    const d = deps(storage);
    const items = Array.from({ length: 1000 }, (_, i) => rec(`conf.${i}`));
    // Only the ten labelled items keep an audit trail (luottamuksellinen: audit true).
    for (const r of items.slice(0, 10)) await setLabel(d, alice, t(r), { label: 'luottamuksellinen' });
    resetClassificationAudit();
    await readerForAgent(d, `claude#alice@${N}`).show(items, t);
    expect(pendingClassificationAudit({ ownerGaii: `alice@${N}` })).toMatchObject([
      { action: 'shown', key: '*:luottamuksellinen', count: 10, label: 'luottamuksellinen' },
    ]);
    resetClassificationAudit();
  });

  it('warningsNote says which warning-classified items an AI was given, and nothing when there were none (finding 7)', async () => {
    const d = deps(storage);
    await setLabel(d, alice, t(rec('conf')), { label: 'luottamuksellinen' });
    const ai = readerForAgent(d, `claude#alice@${N}`);
    expect(warningsNote(ai)).toEqual({});
    await ai.useForAi([t(rec('conf'))], { capability: 'text' });
    expect(warningsNote(ai)).toEqual({ classification_warnings: [expect.objectContaining({ key: 'conf', label: 'luottamuksellinen', says: expect.any(String) })] });
  });

  // TARGET-082 review finding 9: the owner of personal content is always inside its audience, so
  // this no longer refuses. It asserted the lockout the finding closes; AUDIENCE_LOCKOUT on organism
  // content is asserted in classification-access.test.ts.
  it("never locks the owner out of their own content, whatever the label's audience", async () => {
    const d = deps(storage);
    await writePolicy(d, alice, 'owner', null, { labels: [{ id: 'hallitus', rank: 45, name: { en: 'Board' }, audience: { people: ['carol'] } }] });
    await expect(setLabel(d, alice, t(rec('x')), { label: 'hallitus' })).resolves.toMatchObject({ applied: true, label: 'hallitus' });
    expect((await readerFor(d, aliceAuth).show([rec('x')], t)).length).toBe(1);
  });
});
