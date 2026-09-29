/**
 * @file test/unit/classification-access.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who and what the classification policy reaches, and who may touch it, after the
 *   TARGET-082 review, against SqliteStorage(':memory:'). Each block names its finding:
 *   1. an agent's and an ecosystem app's content reads the owner's switch and layer, its audit rows
 *      are the owner's, and the owner labels what an agent holds;
 *   2. no memory route writes, deletes or restores `classification.policy.*` for anyone, and a stored
 *      layer that does not pass validation never throws in a reader;
 *   6. an audience names sharing groups by id, never by a name anyone may choose;
 *   7. a label row keeps its last 50 changes, and the same waiting suggestion is not written again;
 *   8. organism content follows the workspace read and write rules, the current label's audience
 *      and an ecosystem app's data-area grant;
 *   9. the owner of personal content is always inside its audience, and the node's default label
 *      has none.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-access.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 review, findings 1, 2, 6, 7, 8 and 9. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { OrganismRecord, OrganismMembershipRecord, AgentRecord } from '../../src/storage/interface.js';
import {
  setLabel, readContentLabel, memoryTarget, targetOf, ClassificationError, type LabelActor,
} from '../../src/services/classification/labels.js';
import {
  classificationActiveFor, policyFor, ownerOfScope, OWNER_POLICY_KEY,
} from '../../src/services/classification/policy.js';
import { readAuditLog, writePolicy } from '../../src/services/classification/policy-admin.js';
import { validateLayer, validateNodePolicy, PolicyError } from '../../src/services/classification/levels.js';
import { audienceCheck } from '../../src/services/classification/audience.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { resetClassificationAudit } from '../../src/services/classification/audit.js';
import { appMayWriteKey, isServerWrittenKey } from '../../src/utils/reserved-keys.js';
import { batchKeyRefusal } from '../../src/routes/memory/batch-guards.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../../src/services/memory-bin.js';
import { logger } from '../../src/utils/logger.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const AGENT = `claude#${ALICE}`;
const ECO = `eco:zendesk#${ALICE}`;
const ORG = 'o1';
const WS_KEY = `organism.${ORG}.w.ws1.doc.a`;
const META_KEY = `organism.${ORG}.meta.board`;
const GROUP_ID = '5b0c6b8e-2f3d-4a51-9e2a-6f1c0d7e8a90';
const all = { classificationMode: 'all' as const, nodeId: N };
const ownerMode = { classificationMode: 'owner' as const, nodeId: N };
const stamp = '2026-09-29T12:00:00.000Z';

const person = (name: string): LabelActor => ({ principal: `${name}@${N}`, ownerGhii: `${name}@${N}`, ownerName: name, kind: 'human', roles: ['owner'] });
const alice = person('alice');

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ClassificationError ? e.code : String(e); }
}

describe('TARGET-082 review: reach and access', () => {
  let storage: SqliteStorage;
  const deps = (config: { classificationMode: 'all' | 'owner' | 'off'; nodeId: string } = all) => ({ storage, config, now: () => stamp });

  const put = (ownerGaii: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
  });

  /** alice creates organism o1 and workspace ws1 (manifest hers); bob is a member, dave an admin. */
  async function organism(): Promise<void> {
    for (const name of ['alice', 'bob', 'dave']) {
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    const roles: Array<[string, string]> = [['alice', 'creator'], ['bob', 'member'], ['dave', 'admin']];
    for (const [name, role] of roles) {
      await storage.createMembership({ id: `m-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    }
    await put(ALICE, `organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] });
    await put(ALICE, `organism.${ORG}.w.ws1.meta.manifest`, { manifestVersion: '1', name: 'Board', kind: 'project', objectTypes: [] });
  }

  beforeEach(() => { storage = new SqliteStorage(':memory:'); resetClassificationAudit(); });
  afterEach(() => { storage.close(); vi.restoreAllMocks(); resetClassificationAudit(); });

  describe('finding 1: an agent and an app hold the owner\'s content', () => {
    it('ownerOfScope collapses an agent and an ecosystem app to the owner, and an organism to null', () => {
      expect(ownerOfScope(AGENT)).toBe(ALICE);
      expect(ownerOfScope(ECO)).toBe(ALICE);
      expect(ownerOfScope(ALICE)).toBe(ALICE);
      expect(ownerOfScope(`organism:${ORG}`)).toBeNull();
    });

    it("an agent's content reads the owner's switch (mode owner) and the owner's layer (mode all)", async () => {
      await writePolicy(deps(ownerMode), alice, 'owner', null, { enabled: true, labels: [{ id: 'johto', rank: 40, name: { en: 'Management' } }] });
      expect(await classificationActiveFor(storage, ownerMode, AGENT)).toBe(true);
      expect(await classificationActiveFor(storage, ownerMode, ECO)).toBe(true);
      expect((await policyFor(storage, all, AGENT)).labels.map(l => l.id)).toContain('johto');
    });

    it("a label change on an agent's content is in the owner's audit log, and so is a stored row naming the agent", async () => {
      await setLabel(deps(), alice, memoryTarget(AGENT, 'notes.x'), { label: 'luottamuksellinen' });
      await storage.createAgent({ name: 'claude', owner: 'alice', gaii: AGENT, capabilities: [], publicKey: 'k', trustScore: 0, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as AgentRecord);
      // A row stored before rows named the owner: it names the agent, and only the fan-out finds it.
      await storage.addClassificationAudit([{
        id: 'old-1', minute: '2026-09-29T11:00:00.000Z', scope: AGENT, ownerGaii: AGENT, kind: 'memory', key: 'notes.old', label: 'sisainen',
        reader: AGENT, readerKind: 'ai', action: 'shown', purpose: null, count: 1, firstAt: '2026-09-29T11:00:00.000Z', lastAt: '2026-09-29T11:00:00.000Z',
      }]);
      const { rows } = await readAuditLog(deps(), alice, 'owner', null);
      expect(rows.map(r => r.key).sort()).toEqual(['notes.old', 'notes.x']);
      expect(rows.find(r => r.key === 'notes.x')?.ownerGaii).toBe(ALICE);
    });

    it("the owner names an agent's or app's namespace to label what it holds; nobody names another owner's or a sibling's", () => {
      expect(targetOf(alice, { key: 'notes.x', owner: AGENT })).toEqual({ kind: 'memory', scope: AGENT, key: 'notes.x' });
      expect(targetOf(alice, { kind: 'file', key: 'f.pdf', owner: ECO })).toEqual({ kind: 'file', scope: ECO, key: 'f.pdf' });
      expect(targetOf(alice, { key: 'notes.x' }).scope).toBe(ALICE);
      expect(() => targetOf(alice, { key: 'notes.x', owner: `claude#bob@${N}` })).toThrow(ClassificationError);
      expect(() => targetOf(alice, { key: 'notes.x', owner: 'claude#alice@other-node' })).toThrow(ClassificationError);
      const agent: LabelActor = { principal: AGENT, ownerGhii: ALICE, ownerName: 'alice', kind: 'ai', roles: ['agent'] };
      expect(targetOf(agent, { key: 'notes.x', owner: AGENT }).scope).toBe(AGENT);
      expect(() => targetOf(agent, { key: 'notes.x', owner: `gpt#${ALICE}` })).toThrow(ClassificationError);
    });
  });

  describe('finding 2: the policy record is the classification service\'s alone', () => {
    const POLICY = OWNER_POLICY_KEY;

    it('every write gate refuses it to every principal, the owner session and a reserved grant included', () => {
      expect(isServerWrittenKey(POLICY)).toBe(true);
      expect(isServerWrittenKey('classification.policy.organism.o1')).toBe(true);
      expect(isServerWrittenKey('classification.results.x')).toBe(false);
      expect(appMayWriteKey(['owner'], POLICY)).toBe(false);
      expect(appMayWriteKey(['agent'], POLICY, true, true)).toBe(false);
      expect(batchKeyRefusal(['owner'], ALICE, POLICY)).toMatch(/classification service/);
      expect(batchKeyRefusal(['agent'], AGENT, POLICY)).toMatch(/classification service/);
    });

    it('the bin neither deletes nor restores it, for the owner or an operator', async () => {
      const config = { nodeId: N, memoryDeleteGraceDays: 30 } as AimeatConfig;
      await put(ALICE, POLICY, { policy: { enabled: true }, history: [], proposal: null });
      const del = await deleteMemoryRecord({ storage, config }, { caller: ALICE, ownerName: 'alice', key: POLICY, ownerScope: true, roles: ['owner'] });
      expect(del).toMatchObject({ ok: false, code: 'RESERVED_KEY', status: 403 });
      const op = await deleteMemoryRecord({ storage, config }, { caller: `op@${N}`, ownerName: 'op', key: POLICY, ownerOverride: ALICE, roles: ['owner', 'operator'] });
      expect(op).toMatchObject({ ok: false, code: 'RESERVED_KEY' });
      expect(await storage.getMemory(ALICE, POLICY)).toBeTruthy();
      await storage.deleteMemory(ALICE, POLICY, ALICE);
      const back = await restoreMemoryRecord({ storage, config }, { caller: ALICE, ownerName: 'alice', key: POLICY, ownerScope: true, roles: ['owner'] });
      expect(back).toMatchObject({ ok: false, code: 'RESERVED_KEY' });
      expect(await storage.getMemory(ALICE, POLICY)).toBeFalsy();
    });

    it('a stored layer that does not pass validation is ignored with a warning, keeping its switch, and never throws', async () => {
      const warn = vi.spyOn(logger, 'warn');
      await put(ALICE, POLICY, { policy: { enabled: true, labels: 'not-a-list', rules: [{ id: 'BAD ID' }] }, history: [], proposal: null });
      await expect(policyFor(storage, all, ALICE)).resolves.toEqual(defaultPolicy());
      expect(await classificationActiveFor(storage, ownerMode, ALICE)).toBe(true);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('finding 6: a group is named by its id', () => {
    it('refuses a group name in an audience and takes an id', () => {
      const refuse = () => validateLayer(defaultPolicy(), { labels: [{ id: 'hallitus', rank: 45, audience: { groups: ['Board'] } }] });
      expect(refuse).toThrow(PolicyError);
      expect(() => refuse()).toThrow(/sharing group ids, not names/);
      expect(validateLayer(defaultPolicy(), { labels: [{ id: 'hallitus', rank: 45, audience: { groups: [GROUP_ID] } }] }).labels?.[0].audience).toEqual({ groups: [GROUP_ID] });
    });

    it('matches membership by group id only, and a stored group name admits nobody', async () => {
      await storage.createSharingGroup({
        id: GROUP_ID, name: 'Board', ownerGaii: `mallory@${N}`, defaultPermissions: { read: true, write: false }, createdAt: stamp, updatedAt: stamp,
        members: [{ identifier: `bob@${N}`, identifierType: 'ghii', permissions: { read: true, write: false }, addedAt: stamp, addedBy: `mallory@${N}` }],
      } as never);
      const bob = audienceCheck(storage, { owner: `bob@${N}`, ownerName: 'bob' });
      expect(await bob({ groups: ['Board'] }, `organism:${ORG}`)).toBe(false);
      expect(await bob({ groups: [GROUP_ID] }, `organism:${ORG}`)).toBe(true);
      await put(ALICE, OWNER_POLICY_KEY, { policy: { labels: [{ id: 'hallitus', rank: 45, name: { en: 'Board' }, audience: { groups: ['Board'] } }] }, history: [], proposal: null });
      const label = (await policyFor(storage, all, ALICE)).labels.find(l => l.id === 'hallitus');
      expect(label?.audience?.groups).toEqual(['00000000-0000-0000-0000-000000000000']);
    });
  });

  describe('finding 7: a label row stays bounded', () => {
    it('keeps the last 50 changes, in the row it hands to storage', async () => {
      // Both storage providers also trim to 50 when they write; this asserts the service's own cap,
      // so the bound holds whatever store is behind it.
      const T = memoryTarget(ALICE, 'notes.busy');
      const writes = vi.spyOn(storage, 'putContentLabel');
      for (let i = 0; i < 60; i++) await setLabel(deps(), alice, T, { label: i % 2 ? 'julkinen' : 'sisainen' });
      expect(Math.max(...writes.mock.calls.map(([row]) => row.history.length))).toBe(50);
      expect((await storage.getContentLabel(T))?.history.length).toBe(50);
    });

    it('does not write the same waiting suggestion again', async () => {
      const T = memoryTarget(ALICE, 'notes.locked');
      const rule: LabelActor = { principal: `system@${N}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'rule' };
      await setLabel(deps(), alice, T, { label: 'sisainen' });
      expect((await setLabel(deps(), rule, T, { label: 'luottamuksellinen' })).pending).toBe('HUMAN_LABEL');
      const length = (await storage.getContentLabel(T))!.history.length;
      const writes = vi.spyOn(storage, 'putContentLabel');
      expect((await setLabel(deps(), rule, T, { label: 'luottamuksellinen' })).pending).toBe('HUMAN_LABEL');
      expect(writes).not.toHaveBeenCalled();
      expect((await storage.getContentLabel(T))!.history.length).toBe(length);
    });
  });

  describe('finding 8: organism content follows the workspace rules', () => {
    it('a member who may not read the workspace neither reads nor sets its labels', async () => {
      await organism();
      const T = memoryTarget(ALICE, WS_KEY);
      expect(await code(readContentLabel(deps(), person('bob'), T))).toBe('NOT_FOUND');
      expect(await code(setLabel(deps(), person('bob'), T, { label: 'erittain-luottamuksellinen' }))).toBe('NOT_FOUND');
      expect(await code(readContentLabel(deps(), alice, T))).toBe('OK');
    });

    it("the organism's meta namespace is labelled by its creator and admins only", async () => {
      await organism();
      const T = memoryTarget(ALICE, META_KEY);
      expect(await code(readContentLabel(deps(), person('bob'), T))).toBe('OK');
      expect(await code(setLabel(deps(), person('bob'), T, { label: 'luottamuksellinen' }))).toBe('NOT_FOUND');
      expect(await code(setLabel(deps(), person('dave'), T, { label: 'luottamuksellinen' }))).toBe('OK');
    });

    it("nobody outside the current label's audience reads or moves it, and nobody sets one that leaves them out", async () => {
      await organism();
      await writePolicy(deps(), alice, 'organism', ORG, { labels: [{ id: 'hallitus', rank: 45, name: { en: 'Board' }, audience: { people: ['alice'] } }] });
      const T = memoryTarget(ALICE, META_KEY);
      expect(await code(setLabel(deps(), person('dave'), T, { label: 'hallitus' }))).toBe('AUDIENCE_LOCKOUT');
      expect(await code(setLabel(deps(), alice, T, { label: 'hallitus' }))).toBe('OK');
      expect(await code(setLabel(deps(), person('dave'), T, { label: 'erittain-luottamuksellinen', justification: 'no longer board only' }))).toBe('NOT_FOUND');
      expect(await code(readContentLabel(deps(), person('dave'), T))).toBe('NOT_FOUND');
      expect((await storage.getContentLabel(T))?.label).toBe('hallitus');
    });

    it('an ecosystem app needs its data-area grant for the key, whatever its owner may do', async () => {
      await organism();
      const eco: LabelActor = { principal: ECO, ownerGhii: ALICE, ownerName: 'alice', kind: 'ai', roles: ['ecosystem'] };
      expect(await code(setLabel(deps(), eco, memoryTarget(ALICE, WS_KEY), { label: 'erittain-luottamuksellinen', confidence: 1 }))).toBe('NOT_FOUND');
      // The MCP tool builds every actor with roles ['agent']; the principal still says what it is.
      expect(await code(setLabel(deps(), { ...eco, roles: ['agent'] }, memoryTarget(ALICE, WS_KEY), { label: 'erittain-luottamuksellinen', confidence: 1 }))).toBe('NOT_FOUND');
    });
  });

  describe('finding 9: nobody is locked out of their own content', () => {
    it("the owner and their agents are inside every audience on the owner's personal content", async () => {
      const inside = audienceCheck(storage, { owner: ALICE, ownerName: 'alice' });
      expect(await inside({ people: ['carol'] }, AGENT)).toBe(true);
      expect(await inside({ people: ['carol'] }, ALICE)).toBe(true);
      expect(await inside({ people: ['carol'] }, `organism:${ORG}`)).toBe(false);
      expect(await audienceCheck(storage, { owner: `bob@${N}`, ownerName: 'bob' })({ people: ['carol'] }, ALICE)).toBe(false);
    });

    it("refuses a reader list on the node's default label", () => {
      const p = defaultPolicy();
      const labels = p.labels.map(l => (l.id === p.defaultLabel ? { ...l, audience: { people: ['alice'] } } : l));
      expect(() => validateNodePolicy({ ...p, labels })).toThrow(/default label applies to all unlabelled content/);
    });
  });
});
