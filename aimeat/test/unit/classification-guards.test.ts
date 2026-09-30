/**
 * @file test/unit/classification-guards.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refusals of the classification services (TARGET-082) that had no test of their own,
 *   against SqliteStorage(':memory:'). Each case has a positive control beside it:
 *   - another owner neither rejects nor accepts a suggestion waiting on alice's content
 *     (labels.ts reviewLabel, assertMayLabel);
 *   - at level 'organism', a plain member and an outsider neither write nor review the policy, nor
 *     read its audit log or its exceptions; the creator and an admin do (policy-admin.ts mayWrite);
 *   - an organism that admits only listed agents: a member's agent that is not on the list neither
 *     sets a label on its content nor reads its policy; a listed agent of the same member does
 *     (labels.ts assertMayLabel and policy-admin.ts mayRead, agentBarred).
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-guards.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (TARGET-082 test gaps).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import {
  setLabel, reviewLabel, memoryTarget, ClassificationError, type LabelActor,
} from '../../src/services/classification/labels.js';
import {
  readPolicy, writePolicy, reviewPolicy, readAuditLog,
} from '../../src/services/classification/policy-admin.js';
import { readExceptions } from '../../src/services/classification/exception-admin.js';
import { ExceptionError } from '../../src/services/classification/exceptions.js';
import { resetClassificationAudit } from '../../src/services/classification/audit.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const ORG = 'o1';
const stamp = '2026-09-30T12:00:00.000Z';

const person = (name: string): LabelActor => ({
  principal: `${name}@${N}`, ownerGhii: `${name}@${N}`, ownerName: name, kind: 'human', roles: ['owner'],
});
const agentOf = (agent: string, owner: string): LabelActor => ({
  principal: `${agent}#${owner}@${N}`, ownerGhii: `${owner}@${N}`, ownerName: owner, kind: 'ai', roles: ['agent'], scopes: ['*'],
});
const alice = person('alice');
const bob = person('bob');
const carol = person('carol');
const dave = person('dave');
const aliceBot = agentOf('claude', 'alice');
/** bob's agent the organism lists, and one it does not. */
const bobListed = agentOf('listed', 'bob');
const bobUnlisted = agentOf('claude', 'bob');

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) {
    return e instanceof ClassificationError || e instanceof ExceptionError ? e.code : String(e);
  }
}

describe('classification refusals without a test before (TARGET-082)', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage, config: { classificationMode: 'all' as const, nodeId: N }, now: () => stamp });

  /** alice creates o1 (creator), dave is an admin, bob a plain member; carol is no member. */
  async function organism(extra: Partial<OrganismRecord> = {}): Promise<void> {
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp, ...extra,
    } as OrganismRecord);
    const roles: Array<[string, string]> = [['alice', 'creator'], ['bob', 'member'], ['dave', 'admin']];
    for (const [name, role] of roles) {
      await storage.createMembership({ id: `m-${name}`, organismId: ORG, ghii: name, role, status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    }
  }

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    resetClassificationAudit();
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
  });
  afterEach(() => { storage.close(); resetClassificationAudit(); });

  describe("a suggestion waiting on alice's content", () => {
    const T = memoryTarget(ALICE, 'notes.contract');

    it('another owner neither rejects nor accepts it; it still waits, and alice rejects it', async () => {
      const s = await setLabel(deps(), aliceBot, T, { label: 'luottamuksellinen', confidence: 0.99 });
      expect(s.pending).toBe('AI_SUGGESTS');

      expect(await code(reviewLabel(deps(), bob, T, { decision: 'reject' }))).toBe('NOT_FOUND');
      expect(await code(reviewLabel(deps(), bob, T, { decision: 'accept' }))).toBe('NOT_FOUND');
      const row = await storage.getContentLabel(T);
      expect(row?.suggestion).toMatchObject({ label: 'luottamuksellinen', why: 'AI_SUGGESTS' });
      expect(row?.history.some(h => h.by === BOB)).toBe(false);

      // POSITIVE CONTROL: the owner in person rejects it.
      expect(await reviewLabel(deps(), alice, T, { decision: 'reject' })).toMatchObject({ applied: false, label: 'sisainen' });
      expect((await storage.getContentLabel(T))?.suggestion).toBeNull();
    });
  });

  describe("an organism's policy, audit log and exceptions", () => {
    it('a plain member and an outsider neither write nor review the policy, nor read the log or the exceptions', async () => {
      await organism();
      // A waiting proposal, so a review that got past the check would have something to act on.
      await writePolicy(deps(), alice, 'organism', ORG, { enabled: true });
      const proposed = await writePolicy(deps(), aliceBot, 'organism', ORG, { enabled: false });
      expect(proposed.pending).toBe('PERSON_APPROVES');

      for (const who of [bob, carol]) {
        expect(await code(writePolicy(deps(), who, 'organism', ORG, { enabled: false }))).toBe('NOT_FOUND');
        expect(await code(reviewPolicy(deps(), who, 'organism', ORG, 'accept'))).toBe('NOT_FOUND');
        expect(await code(reviewPolicy(deps(), who, 'organism', ORG, 'reject'))).toBe('NOT_FOUND');
        expect(await code(readAuditLog(deps(), who, 'organism', ORG))).toBe('NOT_FOUND');
        expect(await code(readExceptions(deps(), who, 'organism', ORG))).toBe('NOT_FOUND');
      }
      const view = await readPolicy(deps(), alice, 'organism', ORG);
      expect(view.proposal).toMatchObject({ by: aliceBot.principal });
      expect((view.stored as { enabled?: boolean }).enabled).toBe(true);

      // POSITIVE CONTROL: the creator and an admin pass every one of the four.
      for (const who of [alice, dave]) {
        expect(await code(readAuditLog(deps(), who, 'organism', ORG))).toBe('OK');
        expect(await code(readExceptions(deps(), who, 'organism', ORG))).toBe('OK');
        expect(await code(writePolicy(deps(), who, 'organism', ORG, { enabled: true }))).toBe('OK');
      }
      await writePolicy(deps(), aliceBot, 'organism', ORG, { enabled: false });
      expect(await code(reviewPolicy(deps(), dave, 'organism', ORG, 'reject'))).toBe('OK');
    });
  });

  describe('an organism that admits only listed agents', () => {
    // The member's own namespace in the organism, which a member's agent writes without a consent.
    const KEY = `organism.${ORG}.member.bob.plan`;

    it("a member's agent that is not on the list neither sets a label nor reads the policy; a listed one does", async () => {
      await organism({ agentAccess: 'listed', agentGaiis: [bobListed.principal] } as Partial<OrganismRecord>);
      const T = memoryTarget(BOB, KEY);
      expect(T.scope).toBe(`organism:${ORG}`);

      expect(await code(setLabel(deps(), bobUnlisted, T, { label: 'erittain-luottamuksellinen', confidence: 1 }))).toBe('NOT_FOUND');
      expect(await storage.getContentLabel(T)).toBeUndefined();
      expect(await code(readPolicy(deps(), bobUnlisted, 'organism', ORG))).toBe('NOT_FOUND');

      // POSITIVE CONTROL: the same member's listed agent, and the member in person.
      expect(await code(readPolicy(deps(), bobListed, 'organism', ORG))).toBe('OK');
      expect(await code(readPolicy(deps(), bob, 'organism', ORG))).toBe('OK');
      expect(await code(setLabel(deps(), bobListed, T, { label: 'erittain-luottamuksellinen', confidence: 1 }))).toBe('OK');
    });
  });
});
