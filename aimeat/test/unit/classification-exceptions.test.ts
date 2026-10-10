/**
 * @file test/unit/classification-exceptions.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Jouni's decisions of 2026-09-30 on classification, against SqliteStorage(':memory:')
 *   with classification on for everyone:
 *   1. the exceptions list: a person makes an exception for one item with a reason, an AI credential
 *      cannot (PERSON_REQUIRED), another owner neither makes, sees nor withdraws one; an exception in
 *      force lets the item leave and the use is audited; a withdrawn or expired one does not;
 *   2. an AI sending content out leaves behind what a label hides from AI, the person's own content
 *      included, unless an 'ai-send' or 'leave' exception is in force; the reason names the Data
 *      Wallet; an 'ai-send' exception in force also shows the item to an AI reader, audited as used;
 *   3. an app does what it is built for: a lowering without a justification, a policy change that
 *      gives something away, an accepted proposal and suggestion, and content sent out against its
 *      label all apply, and each is an automatic exception naming the app and the act;
 *   4. the list is bounded (an app's same act merges), an owner's erasure and the retention prune
 *      remove records, and a month with a person's exception in force stays.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-exceptions.test.ts
 * @version-history
 *   v1.3.0 — 2026-10-10 — An app's AI call refused for another item records no automatic 'ai-send'
 *     exception (secaudit 2026-10-10 I10).
 *   v1.2.0 — 2026-09-30 — An exception lapses when the item's label is raised after it (TARGET-082
 *     second review, finding S2). An app's AI call takes content hidden from AI, as an exception.
 *   v1.1.0 — 2026-09-30 — An 'ai-send' exception shows the item to an AI reader (reader.show()).
 *   v1.0.0 — 2026-09-30 — Initial (Jouni's decisions of 2026-09-30).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { labelActorOf, memoryTarget, setLabel, reviewLabel, type LabelActor } from '../../src/services/classification/labels.js';
import { readerFor, readerForAgent, EXCEPTION_HINT } from '../../src/services/classification/reader.js';
import { writePolicy, reviewPolicy } from '../../src/services/classification/policy-admin.js';
import { makeException, readExceptions, removeException } from '../../src/services/classification/exception-admin.js';
import { activeExceptionsFor, addException, listExceptions, purgeExceptions, pruneExceptions } from '../../src/services/classification/exceptions.js';
import { pendingClassificationAudit, resetClassificationAudit } from '../../src/services/classification/audit.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const AGENT = `claude#${ALICE}`;
const ORG = 'o1';
const DOC = `organism.${ORG}.w.ws1.notes.a`;
const APP = 'alice/crm.html';
const stamp = '2026-09-30T12:00:00.000Z';

const person = (name: string): LabelActor => labelActorOf({ sub: name, owner: name, roles: ['owner'] }, N);
const alice = person('alice');
const bob = person('bob');
const agent = labelActorOf({ sub: AGENT, owner: 'alice', roles: ['agent'] }, N);
const pat = labelActorOf({ sub: 'alice', owner: 'alice', roles: ['owner'], via: 'pat' } as never, N);
const appAuth = { sub: ALICE, owner: 'alice', roles: ['app'], app: APP, app_grant: 'appgrant-1' };
const app = labelActorOf(appAuth, N);

type Rec = { ownerGaii: string; key: string };
const t = (r: Rec) => memoryTarget(r.ownerGaii, r.key);
const own = (key: string): Rec => ({ ownerGaii: ALICE, key });
const orgDoc: Rec = { ownerGaii: ALICE, key: `${DOC}.latest` };

describe('classification exceptions and apps (decided 2026-09-30)', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage, config: { classificationMode: 'all' as const, nodeId: N } });
  const put = (key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
  });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    resetClassificationAudit();
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] });
    await put(`organism.${ORG}.w.ws1.meta.manifest`, { manifestVersion: '1', name: 'Board', kind: 'project', objectTypes: [] });
    // alice's own label that hides content from AI: 'hidden' is her choice, no default uses it.
    await writePolicy(deps(), alice, 'owner', null, { labels: [{ id: 'salainen', rank: 40, name: { en: 'Secret' }, aiVisibility: 'hidden' }] });
  });
  afterEach(() => { storage.close(); resetClassificationAudit(); });

  describe("a person's exception", () => {
    it('lets an organism item leave, records the use, and stops when withdrawn', async () => {
      const reader = readerFor(deps(), { sub: 'alice', owner: 'alice', roles: ['owner'] });
      const where = { kind: 'export' as const, organismId: null };
      const before = await reader.leave([orgDoc], t, where);
      expect(before.left).toHaveLength(1);
      expect(before.left[0]!.reason).toContain(EXCEPTION_HINT);

      const e = await makeException(deps(), alice, { key: `${DOC}.draft`, action: 'leave', reason: 'The board approved sharing the minutes.' });
      expect(e).toMatchObject({
        by: ALICE, byKind: 'human', auto: false, action: 'leave', scope: `organism:${ORG}`, organismId: ORG,
        target: { kind: 'memory', key: DOC }, label: 'sisainen', reason: 'The board approved sharing the minutes.', until: null,
      });
      const after = await reader.leave([orgDoc], t, where);
      expect(after.kept).toEqual([orgDoc]);
      const rows = pendingClassificationAudit({ scope: `organism:${ORG}` }).filter(r => r.action === 'exception');
      expect(rows.map(r => r.purpose)).toEqual(expect.arrayContaining([
        expect.stringMatching(new RegExp(`^made ${e.id} \\(leave\\): The board approved`)),
        expect.stringMatching(new RegExp(`^used ${e.id} \\(leave\\) → export: The board approved`)),
      ]));

      const listed = await readExceptions(deps(), alice, 'organism', ORG);
      expect(listed.exceptions.map(x => x.id)).toEqual([e.id]);
      const gone = await removeException(deps(), alice, e.id);
      expect(gone).toMatchObject({ id: e.id, withdrawnBy: ALICE });
      expect((await reader.leave([orgDoc], t, where)).left).toHaveLength(1);
      // Withdrawn, it stays on the list for the audit.
      expect((await readExceptions(deps(), alice, 'organism', ORG)).exceptions[0]).toMatchObject({ id: e.id, withdrawnAt: expect.any(String) });
    });

    it("lapses when the item's label is raised after it was made, by rank or by a field", async () => {
      const reader = readerFor(deps(), { sub: 'alice', owner: 'alice', roles: ['owner'] });
      const where = { kind: 'export' as const, organismId: null };
      await makeException(deps(), alice, { key: DOC, action: 'leave', reason: 'The board approved sharing the minutes.' });
      expect((await reader.leave([orgDoc], t, where)).kept).toEqual([orgDoc]);

      // Raised by rank and by fields (audited, warning to AI): the exception was made for Internal.
      await setLabel(deps(), alice, t(orgDoc), { label: 'luottamuksellinen' });
      expect((await reader.leave([orgDoc], t, where)).left).toHaveLength(1);

      // A label of LOWER rank that hides content from AI is stricter by a field: the exception lapses too.
      await writePolicy(deps(), alice, 'owner', null, { labels: [{ id: 'salainen', rank: 40, name: { en: 'Secret' }, aiVisibility: 'hidden' }, { id: 'piilo', rank: 5, name: { en: 'Low but hidden' }, aiVisibility: 'hidden' }] });
      await makeException(deps(), alice, { key: 'notes.plan', action: 'ai-send', reason: 'The assistant mails the plan.' });
      await setLabel(deps(), alice, t(own('notes.plan')), { label: 'piilo' });
      const agentReader = readerForAgent(deps(), AGENT);
      expect(await agentReader.show([own('notes.plan')], t)).toEqual([]);
    });

    it('an ai-send exception serves an AI reader only; an expired exception serves nobody', async () => {
      await makeException(deps(), alice, { key: DOC, action: 'ai-send', reason: 'The assistant posts the agenda.' });
      const person = readerFor(deps(), { sub: 'alice', owner: 'alice', roles: ['owner'] });
      expect((await person.leave([orgDoc], t, { kind: 'external', to: 'mail' })).left).toHaveLength(1);
      expect((await readerForAgent(deps(), AGENT).leave([orgDoc], t, { kind: 'external', to: 'mail' })).kept).toEqual([orgDoc]);

      const soon = new Date(Date.now() + 60_000).toISOString();
      await makeException({ ...deps(), now: () => new Date(Date.now() - 120_000).toISOString() }, alice, { key: `organism.${ORG}.w.ws1.notes.b`, action: 'leave', reason: 'For a minute.', until: soon });
      const later = { ...deps(), now: () => new Date(Date.now() + 120_000).toISOString() };
      const active = await listExceptions(later, { level: 'organism', subject: ORG, activeOnly: true });
      expect(active.map(x => x.target?.key)).toEqual([DOC]);
    });

    it('is refused for an AI credential, needs a reason and a known action, and refuses another owner', async () => {
      for (const ai of [agent, pat]) {
        await expect(makeException(deps(), ai, { key: DOC, action: 'leave', reason: 'x' })).rejects.toMatchObject({ code: 'PERSON_REQUIRED', status: 403 });
      }
      await expect(makeException(deps(), alice, { key: DOC, action: 'leave' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(makeException(deps(), alice, { key: DOC, action: 'lower', reason: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(makeException(deps(), alice, { key: DOC, action: 'leave', reason: 'x', until: '2020-01-01T00:00:00Z' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      // bob is not a member of the organism: its content does not exist for him.
      await expect(makeException(deps(), bob, { key: DOC, action: 'leave', reason: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const e = await makeException(deps(), alice, { key: 'notes.mine', action: 'leave', reason: 'Mine to send.' });
      expect(e).toMatchObject({ scope: ALICE, ownerGaii: ALICE, target: { key: 'notes.mine' } });
      expect((await readExceptions(deps(), bob, 'owner', null)).exceptions).toEqual([]);
      expect((await readExceptions(deps(), alice, 'owner', null)).exceptions.map(x => x.id)).toEqual([e.id]);
      await expect(readExceptions(deps(), bob, 'organism', ORG)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(readExceptions(deps(), bob, 'node', null)).rejects.toMatchObject({ code: 'OPERATOR_REQUIRED' });
      await expect(removeException(deps(), bob, e.id)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await expect(removeException(deps(), agent, e.id)).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });
      // The owner's agent reads the owner's list, as it reads the owner's audit log.
      expect((await readExceptions(deps(), agent, 'owner', null)).exceptions.map(x => x.id)).toEqual([e.id]);
    });
  });

  describe('an AI sending content out', () => {
    it("leaves behind the person's own content a label hides from AI, unless an exception is in force", async () => {
      await setLabel(deps(), alice, t(own('secret')), { label: 'salainen' });
      await setLabel(deps(), alice, t(own('conf')), { label: 'erittain-luottamuksellinen' });
      const items = [own('secret'), own('conf'), own('plain')];
      const where = { kind: 'export' as const, organismId: null };
      const ai = await readerForAgent(deps(), AGENT).leave(items, t, where);
      // Highly confidential is a warning by default (option B), so it goes; the hidden one stays.
      expect(ai.kept.map(r => r.key)).toEqual(['conf', 'plain']);
      expect(ai.left).toEqual([{ item: own('secret'), label: 'salainen', reason: `classified Secret, which no AI may send out. ${EXCEPTION_HINT}` }]);
      // The person's own export takes everything, as before.
      expect((await readerFor(deps(), { sub: 'alice', owner: 'alice', roles: ['owner'] }).leave(items, t, where)).left).toEqual([]);

      await makeException(deps(), alice, { key: 'secret', action: 'ai-send', reason: 'The accountant needs the key file.' });
      expect((await readerForAgent(deps(), AGENT).leave(items, t, where)).kept.map(r => r.key)).toEqual(['secret', 'conf', 'plain']);
      expect(pendingClassificationAudit({ ownerGaii: ALICE }).some(r => r.action === 'exception' && r.reader === AGENT && /^used .* \(ai-send\) → export/.test(r.purpose ?? ''))).toBe(true);
    });

    it("shows an AI what an 'ai-send' exception lets it send, and nothing else: the AI cannot send what it cannot see", async () => {
      await setLabel(deps(), alice, t(own('secret')), { label: 'salainen' });
      await setLabel(deps(), alice, t(own('other')), { label: 'salainen' });
      const items = [own('secret'), own('other'), own('plain')];
      const ai = readerForAgent(deps(), AGENT);
      expect((await ai.show(items, t)).map(r => r.key)).toEqual(['plain']);

      // A 'leave' exception is about leaving, not about what an AI reads.
      await makeException(deps(), alice, { key: 'other', action: 'leave', reason: 'I send it myself.' });
      expect((await ai.show(items, t)).map(r => r.key)).toEqual(['plain']);

      const e = await makeException(deps(), alice, { key: 'secret', action: 'ai-send', reason: 'The assistant mails the key file to the accountant.' });
      resetClassificationAudit();
      expect((await ai.show(items, t)).map(r => r.key)).toEqual(['secret', 'plain']);
      const rows = pendingClassificationAudit({ ownerGaii: ALICE });
      expect(rows.filter(r => r.action === 'exception').map(r => [r.reader, r.readerKind, r.key, r.purpose])).toEqual([
        [AGENT, 'ai', 'secret', `used ${e.id} (ai-send) → shown: The assistant mails the key file to the accountant.`],
      ]);
      expect(rows.some(r => r.action === 'refused' && r.key === 'other')).toBe(true);
      // An anonymous reader is read as an AI, and a person's exception is no permission for it.
      expect((await readerFor(deps(), null).show(items, t)).map(r => r.key)).toEqual(['plain']);

      await removeException(deps(), alice, e.id);
      expect((await ai.show(items, t)).map(r => r.key)).toEqual(['plain']);
    });
  });

  describe('an app does what it is built for, and each act is an exception', () => {
    const appExceptions = async (action: string) => (await listExceptions(deps(), { level: 'all' })).filter(e => e.auto && e.action === action);

    it('lowers a label without a justification; a person still needs one, an AI only suggests', async () => {
      await setLabel(deps(), alice, t(own('deal')), { label: 'luottamuksellinen' });
      await expect(setLabel(deps(), alice, t(own('deal')), { label: 'sisainen' })).rejects.toMatchObject({ code: 'JUSTIFICATION_REQUIRED' });
      expect(await setLabel(deps(), agent, t(own('deal')), { label: 'sisainen' })).toMatchObject({ applied: false });
      expect(await appExceptions('lower')).toEqual([]);

      expect(await setLabel(deps(), app, t(own('deal')), { label: 'sisainen' })).toMatchObject({ applied: true, label: 'sisainen' });
      expect(await appExceptions('lower')).toEqual([expect.objectContaining({
        byKind: 'app', auto: true, app: APP, by: app.principal, scope: ALICE, target: { kind: 'memory', key: 'deal' }, label: 'sisainen',
        reason: `app ${APP} lowered luottamuksellinen → sisainen`,
      })]);
      // A raise is no exception.
      await setLabel(deps(), app, t(own('deal')), { label: 'luottamuksellinen' });
      expect(await appExceptions('lower')).toHaveLength(1);
    });

    it("accepts a lowering the person's words asked for, and the accept is an exception", async () => {
      await setLabel(deps(), alice, t(own('min')), { label: 'luottamuksellinen' });
      expect(await setLabel(deps(), agent, t(own('min')), { label: 'julkinen', humanSaid: 'Tämä voi olla julkinen.' })).toMatchObject({ pending: 'PERSON_APPROVES' });
      expect(await reviewLabel(deps(), app, t(own('min')), { decision: 'accept' })).toMatchObject({ applied: true, label: 'julkinen' });
      expect(await appExceptions('review')).toEqual([expect.objectContaining({ reason: expect.stringContaining(`app ${APP} accepted the suggestion lowering luottamuksellinen → julkinen`) })]);
    });

    it('changes a policy in a way that gives something away, and accepts an AI proposal that does', async () => {
      await writePolicy(deps(), alice, 'owner', null, { enabled: true });
      const off = await writePolicy(deps(), app, 'owner', null, { enabled: false });
      expect(off).toMatchObject({ applied: true });
      expect(await appExceptions('policy')).toEqual([expect.objectContaining({ scope: ALICE, target: null, label: null, reason: expect.stringContaining(`app ${APP} changed the owner policy, which gives away:`) })]);

      await writePolicy(deps(), alice, 'owner', null, { enabled: true });
      expect(await writePolicy(deps(), agent, 'owner', null, { enabled: false })).toMatchObject({ pending: 'PERSON_APPROVES' });
      expect(await appExceptions('policy')).toHaveLength(1);
      expect(await reviewPolicy(deps(), app, 'owner', null, 'accept')).toMatchObject({ applied: true });
      expect(await appExceptions('review')).toEqual([expect.objectContaining({ reason: expect.stringContaining(`app ${APP} accepted ${AGENT}'s proposal for the owner policy`) })]);
      // An AI's refusals stand.
      await expect(reviewPolicy(deps(), agent, 'owner', null, 'accept')).rejects.toMatchObject({ code: 'PERSON_REQUIRED' });
    });

    it("gives content hidden from AI to its AI call, as an exception; a person's own session is still refused", async () => {
      await setLabel(deps(), alice, t(own('secret')), { label: 'salainen' });
      const use = { capability: 'chat', model: 'test-model' };
      await expect(readerFor(deps(), appAuth).useForAi([t(own('secret'))], use)).resolves.toBeUndefined();
      expect(await appExceptions('ai-send')).toEqual([expect.objectContaining({
        auto: true, label: 'salainen', destination: 'ai:chat test-model',
        reason: `app ${APP} gave an item classified Secret, which no AI may read, to an AI (chat test-model)`,
      })]);
      await expect(readerFor(deps(), { sub: 'alice', owner: 'alice', roles: ['owner'] }).useForAi([t(own('secret'))], use))
        .rejects.toMatchObject({ code: 'CLASSIFIED' });
      await expect(readerForAgent(deps(), AGENT).useForAi([t(own('secret'))], use)).rejects.toMatchObject({ code: 'CLASSIFIED' });
    });

    it('records no exception for an AI call that is refused for another item (secaudit 2026-10-10 I10)', async () => {
      await setLabel(deps(), alice, t(own('secret')), { label: 'salainen' });
      const use = { capability: 'chat', model: 'test-model' };
      // Bob's item is outside alice's audience, so the whole call is refused; alice's hidden item,
      // which the app alone could have sent, was never sent and has no exception to record.
      await storage.setMemory({
        key: 'bob.private', ownerGaii: BOB, value: { note: 'bob' }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
      });
      await writePolicy(deps(), bob, 'owner', null, { labels: [{ id: 'vain-bob', rank: 45, name: { en: 'Bob only' }, audience: { people: ['bob'] } }] });
      await setLabel(deps(), bob, memoryTarget(BOB, 'bob.private'), { label: 'vain-bob' });
      const mixed = [t(own('secret')), memoryTarget(BOB, 'bob.private')];
      await expect(readerFor(deps(), appAuth).useForAi(mixed, use)).rejects.toMatchObject({ code: 'CLASSIFIED' });
      expect(await appExceptions('ai-send')).toEqual([]);
    });

    it('sends out what its label keeps in, as one exception per act with the count', async () => {
      const reader = readerFor(deps(), appAuth);
      const docs = [orgDoc, { ownerGaii: ALICE, key: `organism.${ORG}.w.ws1.notes.b` }];
      const out = await reader.leave(docs, t, { kind: 'share', organismId: ORG, ws: 'ws1' });
      expect(out).toMatchObject({ kept: docs, left: [] });
      const [e] = await appExceptions('leave');
      expect(e).toMatchObject({ count: 2, label: 'sisainen', destination: `share:${ORG}/ws1`, reason: `app ${APP} sent 2 items classified Internal out (share:${ORG}/ws1)` });
      await reader.leave([orgDoc], t, { kind: 'share', organismId: ORG, ws: 'ws1' });
      expect(await appExceptions('leave')).toEqual([expect.objectContaining({ count: 3, lastAt: expect.any(String) })]);
    });
  });

  describe('the list at a realistic size', () => {
    it('an exception in force still works when more than 1000 are in force, and a month of full reasons fits one record', async () => {
      const reason = 'r'.repeat(1000);
      for (const [month, n] of [['2026-07', 500], ['2026-08', 500], ['2026-09', 100]] as const) {
        for (let i = 0; i < n; i++) {
          // One minute apart, so the first of July is the oldest of all.
          const at = { ...deps(), now: () => new Date(Date.parse(`${month}-01T00:00:00.000Z`) + i * 60_000).toISOString() };
          await addException(at, { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: `k.${month}.${i}` }, label: 'salainen', action: 'leave', reason, auto: false });
        }
      }
      // The oldest of 1100 in force.
      const found = await activeExceptionsFor(deps(), ALICE, [{ kind: 'memory', key: 'k.2026-07.0' }]);
      expect([...found.keys()]).toEqual(['memory\u0000k.2026-07.0']);
      // A full month of 1000-character reasons stays below the 1024 kB value limit, and the next is refused.
      const july = await storage.getMemory(`system@${N}`, 'classification.exceptions.owner.' + ALICE + '.2026-07');
      expect(JSON.stringify(july?.value ?? '').length).toBeLessThan(1024 * 1024);
      const at = { ...deps(), now: () => '2026-07-20T00:00:00.000Z' };
      await expect(addException(at, { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: 'one.more' }, label: 'salainen', action: 'leave', reason, auto: false }))
        .rejects.toMatchObject({ code: 'EXCEPTION_LIMIT' });
    }, 60_000);
  });

  describe('the list is kept and removed with its subject', () => {
    it("an erased owner's records go, and the prune keeps a month with an exception in force", async () => {
      const old = { ...deps(), now: () => '2024-01-15T00:00:00.000Z' };
      await addException(old, { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: 'a' }, label: 'sisainen', action: 'leave', reason: 'standing', auto: false });
      await addException(old, { by: BOB, byKind: 'human', scope: BOB, target: { kind: 'memory', key: 'b' }, label: 'sisainen', action: 'leave', reason: 'expired', auto: false, until: '2024-02-01T00:00:00.000Z' });
      expect(await pruneExceptions(storage, N, 365, new Date('2026-09-30T00:00:00Z'))).toBe(1);
      expect((await listExceptions(deps(), { level: 'all' })).map(e => e.reason)).toEqual(['standing']);
      expect(await purgeExceptions(storage, N, { owner: ALICE })).toBe(1);
      expect(await listExceptions(deps(), { level: 'all' })).toEqual([]);
    });
  });
});
