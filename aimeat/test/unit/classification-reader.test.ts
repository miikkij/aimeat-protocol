/**
 * @file test/unit/classification-reader.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check component's decisions (TARGET-082 V4) on a real SQLite store with the
 *   switch on for everyone: an AI does not see hidden content and sees warning content with a
 *   warning; a person outside a label's audience does not see it; an AI call with hidden content is
 *   refused whoever asks; content that may not leave its organism stays out of an export while a
 *   person's own export takes everything; a row takes its row space's label; and nobody sets a label
 *   whose audience leaves them out.
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { readerFor, readerForAgent, systemReader } from '../../src/services/classification/reader.js';
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
    const fed = await reader.leave([rec('plain')], t, { kind: 'federation', peer: 'p' });
    expect(fed.left.length).toBe(1);
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

  it('refuses a label whose audience leaves out the person setting it', async () => {
    const d = deps(storage);
    await writePolicy(d, alice, 'owner', null, { labels: [{ id: 'hallitus', rank: 45, name: { en: 'Board' }, audience: { people: ['carol'] } }] });
    await expect(setLabel(d, alice, t(rec('x')), { label: 'hallitus' })).rejects.toMatchObject({ code: 'AUDIENCE_LOCKOUT' });
  });
});
