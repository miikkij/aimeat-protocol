/**
 * @file test/unit/classification-explorer-deleted.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The explorer's "waiting for you" list leaves out a suggestion on personal content
 *   that was deleted since: nobody can review it, and it stayed on the list for good (TARGET-082
 *   second review).
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-explorer-deleted.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { labelActorOf, memoryTarget, setLabel } from '../../src/services/classification/labels.js';
import { explorerQueryOf, listLabels } from '../../src/services/classification/explorer.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const stamp = '2026-09-30T12:00:00.000Z';
const alice = labelActorOf({ sub: 'alice', owner: 'alice', roles: ['owner'] }, N);
const agent = labelActorOf({ sub: `claude#${ALICE}`, owner: 'alice', roles: ['agent'] }, N);

describe('the explorer and deleted content', () => {
  let storage: SqliteStorage;
  const deps = () => ({ storage, config: { classificationMode: 'all' as const, nodeId: N } });
  const pending = async () => (await listLabels(deps(), alice, explorerQueryOf({ pending: true }))).items.map(i => i.key);

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: stamp });
    for (const key of ['notes.kept', 'notes.gone']) {
      await storage.setMemory({ key, ownerGaii: ALICE, value: 'text', visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp });
      await setLabel(deps(), alice, memoryTarget(ALICE, key), { label: 'luottamuksellinen' });
      // An AI's lowering of a person's label waits for the person.
      await setLabel(deps(), agent, memoryTarget(ALICE, key), { label: 'julkinen' });
    }
  });
  afterEach(() => storage.close());

  it('lists both suggestions while both items exist, and only the living one after a delete', async () => {
    expect(await pending()).toEqual(['notes.gone', 'notes.kept']);
    await storage.deleteMemory(ALICE, 'notes.gone');
    expect(await pending()).toEqual(['notes.kept']);
  });
});
