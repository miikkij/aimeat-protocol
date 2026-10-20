/**
 * @file memory-restore-visibility-rules.test.ts
 * @description Taking a record out of the bin is a write, so the level it comes back at answers to
 *   the write path's three visibility rules (secaudit 2026-10,
 *   memory-bin.ts:restoreMemoryRecord:skips-publish-gate-and-cap). The bin is invisible to getMemory,
 *   so writing the same content at the same key counts as a raise from nothing to the level the
 *   record held, and the write path asks the publish gate, the label's audience cap and the closed
 *   node's level of such a raise. The restore asked none of them, so an agent holding memory:write
 *   put a public record its owner had binned back in front of anonymous readers.
 *
 *   Each rule keeps the answer it gives on a write: the gate refuses the callers it asks the owner
 *   about, the cap refuses everyone the label caps (the owner in person included), and the closed
 *   node lowers rather than refuses. Against SqliteStorage(':memory:') and the real service, so the
 *   gate, the cap and the closed node are the shipped ones.
 * @usage pnpm exec vitest run test/unit/memory-restore-visibility-rules.test.ts
 * @version-history
 *   2026-10-20 — Initial (secaudit 2026-10).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../../src/services/memory-bin.js';
import { DEFAULT_CAPS_KEY } from '../../src/services/classification/default-caps-state.js';
import type { AimeatConfig } from '../../src/config.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const AGENT = `helper#alice@${N}`;
const KEY = 'notes.open';
const stamp = '2026-10-20T09:00:00.000Z';

/** The node as this suite runs it: the gate on for agents, no classification, an open node. */
const base = { nodeId: N, memoryDeleteGraceDays: 30, publishGate: 'agents', classificationMode: 'off' } as unknown as AimeatConfig;
const withConfig = (extra: Record<string, unknown>) => ({ ...base, ...extra } as unknown as AimeatConfig);

/** The owner in person. */
const asOwner = (key = KEY) => ({ caller: ALICE, ownerName: 'alice', key, ownerScope: true, roles: ['owner'], scopes: [] as string[] });
/** An agent of the same owner, holding the words a restore needs and not publish:public. */
const asAgent = (key = KEY) => ({
  caller: AGENT, ownerName: 'alice', key, ownerScope: true,
  roles: ['agent'], scopes: ['memory:read', 'memory:write', 'memory:delete'],
});

describe('the level a binned record comes back at', () => {
  let storage: SqliteStorage;

  const put = (ownerGaii: string, visibility: string, key = KEY) => storage.setMemory({
    key, ownerGaii, value: { note: 'an open note' }, visibility: visibility as 'public',
    tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
  });
  const binned = async (ownerGaii: string) => (await storage.listDeletedMemory(ownerGaii)).map(r => r.key);

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    // The owner's reach over their agents' records is getAgentsByOwner, so the agent is a row here.
    await storage.createAgent({
      name: 'helper', owner: 'alice', gaii: AGENT, publicKey: 'x', trustScore: 50, morselBalance: 0,
      capabilities: [], defaultScopes: ['memory:read', 'memory:write', 'memory:delete'],
      createdAt: stamp, lastSeen: stamp,
    } as never);
  });
  afterEach(() => { storage.close(); });

  it('an agent without publish:public is refused, and the record stays in the bin', async () => {
    await put(AGENT, 'public');
    expect((await deleteMemoryRecord({ storage, config: base }, asOwner())).ok).toBe(true);

    const back = await restoreMemoryRecord({ storage, config: base }, asAgent());
    expect(back.ok).toBe(false);
    if (!back.ok) {
      expect(back.code).toBe('PUBLISH_NOT_ALLOWED');
      expect(back.status).toBe(403);
    }
    // Nothing is readable again: the tombstone was never cleared.
    expect(await storage.getMemory(AGENT, KEY)).toBeNull();
    expect(await binned(AGENT)).toContain(KEY);
  });

  it('the same agent puts a PRIVATE record of the same owner back, which the gate never covered', async () => {
    await put(AGENT, 'private');
    expect((await deleteMemoryRecord({ storage, config: base }, asOwner())).ok).toBe(true);

    const back = await restoreMemoryRecord({ storage, config: base }, asAgent());
    expect(back.ok).toBe(true);
    expect((await storage.getMemory(AGENT, KEY))?.visibility).toBe('private');
  });

  it('an agent holding publish:public puts the public record back, public', async () => {
    await put(AGENT, 'public');
    await deleteMemoryRecord({ storage, config: base }, asOwner());

    const req = { ...asAgent(), scopes: [...asAgent().scopes, 'publish:public'] };
    const back = await restoreMemoryRecord({ storage, config: base }, req);
    expect(back.ok).toBe(true);
    expect((await storage.getMemory(AGENT, KEY))?.visibility).toBe('public');
  });

  it('the owner in person puts their own public record back, public, with the gate on', async () => {
    await put(ALICE, 'public');
    await deleteMemoryRecord({ storage, config: base }, asOwner());

    const back = await restoreMemoryRecord({ storage, config: base }, asOwner());
    expect(back.ok).toBe(true);
    expect((await storage.getMemory(ALICE, KEY))?.visibility).toBe('public');
  });

  it('a node with the gate off is unchanged: the agent puts the public record back', async () => {
    const config = withConfig({ publishGate: 'off' });
    await put(AGENT, 'public');
    await deleteMemoryRecord({ storage, config }, asOwner());

    const back = await restoreMemoryRecord({ storage, config }, asAgent());
    expect(back.ok).toBe(true);
    expect((await storage.getMemory(AGENT, KEY))?.visibility).toBe('public');
  });

  it('a label cap refuses the owner in person too, and the record stays in the bin', async () => {
    // The default labels with the caps of decision 10.1: 'sisainen', the label of unlabelled
    // content, may be shown to signed-in accounts at most, so a public record is over its cap.
    await storage.setMemory({
      key: DEFAULT_CAPS_KEY, ownerGaii: `system@${N}`,
      value: { node: 'new', at: stamp, evidence: 'the suite', offered: [], incident: null },
      visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
    });
    const config = withConfig({ classificationMode: 'all' });
    await put(ALICE, 'public');
    expect((await deleteMemoryRecord({ storage, config }, asOwner())).ok).toBe(true);

    const back = await restoreMemoryRecord({ storage, config }, asOwner());
    expect(back.ok).toBe(false);
    if (!back.ok) {
      expect(back.code).toBe('LABEL_CAPS_AUDIENCE');
      expect(back.status).toBe(409);
    }
    expect(await storage.getMemory(ALICE, KEY)).toBeNull();
    expect(await binned(ALICE)).toContain(KEY);
  });

  it('a node that serves its content to signed-in accounts only puts it back for members', async () => {
    const config = withConfig({ contentAccess: 'signed-in' });
    await put(ALICE, 'public');
    await deleteMemoryRecord({ storage, config }, asOwner());

    const back = await restoreMemoryRecord({ storage, config }, asOwner());
    expect(back.ok).toBe(true);
    expect((await storage.getMemory(ALICE, KEY))?.visibility).toBe('members');
  });
});
