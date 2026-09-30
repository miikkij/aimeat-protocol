/**
 * @file test/unit/classification-scan-access.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A classification scan authorizes every organism item, not one per organism: whether
 *   a member may label an organism item depends on its workspace. Until 2026-09-30 the first key of
 *   an organism was checked and the rest were queued for the classifier, so a member who named a key
 *   they can read first had a key they cannot read judged by the node's model (TARGET-082 second
 *   review, S5).
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-scan-access.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { labelActorOf } from '../../src/services/classification/labels.js';
import { scanContent } from '../../src/services/classification/scan.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const ORG = 'o1';
const stamp = '2026-09-30T12:00:00.000Z';
const bob = labelActorOf({ sub: 'bob', owner: 'bob', roles: ['owner'] }, N);
const READABLE = `organism.${ORG}.w.ws1.notes.a`;
const UNREADABLE = `organism.${ORG}.w.nows.notes.b`;

describe('a scan authorizes each organism item', () => {
  let storage: SqliteStorage;
  // The full node config with consent on, as the routes pass it: the organism access checks read it.
  const config: AimeatConfig = { ...loadConfig().config, nodeId: N, classificationMode: 'all', consentEnabled: true };
  const deps = () => ({ storage, config });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    await storage.createOrganism({
      id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
      admins: [ALICE], members: [ALICE, `bob@${N}`], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
      moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
      memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    await storage.createMembership({ id: 'm-bob', organismId: ORG, ghii: 'bob', role: 'member', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
    const put = (key: string, value: unknown, visibility: 'private' | 'members') => storage.setMemory({
      key, ownerGaii: ALICE, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
    } as never);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: 'ws1', name: 'Board', createdAt: stamp, createdBy: 'alice' }] }, 'members');
    // ws1 is open to the organism's members; 'nows' has no manifest, which only a manager reads.
    await put(`organism.${ORG}.w.ws1.meta.manifest`, { manifestVersion: '1', name: 'Board', kind: 'project', objectTypes: [] }, 'members');
  });
  afterEach(() => storage.close());

  it('queues a key the member may label', async () => {
    const out = await scanContent(deps(), bob, { keys: [READABLE] });
    expect(out.queued).toEqual([READABLE]);
  });

  it('refuses the whole scan when a later key is one the member may not label, and queues nothing', async () => {
    await expect(scanContent(deps(), bob, { keys: [READABLE, UNREADABLE] })).rejects.toMatchObject({ status: 404 });
    // The queue's index record (classifier.ts INDEX_KEY) is written by the first enqueue.
    expect(await storage.getMemory(`system@${N}`, 'classification.queue.index')).toBeNull();
  });
});
