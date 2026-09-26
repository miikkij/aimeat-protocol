/**
 * @file test/unit/operator-admin-migration.test.ts
 * @description What the once-per-node operator:admin migration writes, and when it writes nothing,
 *   against real in-memory SQLite. The boot itself, the tool surface and the claude.ai connector are
 *   in test/e2e-operator-admin-migration.ts; this file holds the cases a boot cannot stage cheaply:
 *   an agent with no scope list of its own, a node where nothing qualifies, and a run that stopped
 *   half way.
 * @usage cd aimeat && pnpm exec vitest run test/unit/operator-admin-migration.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { migrateOperatorAdminOnce, OPERATOR_ADMIN_MIGRATION_KEY } from '../../src/services/operator-admin-migration.js';
import { OPERATOR_ADMIN_SCOPE as WORD } from '../../src/utils/scope-coverage.js';

const NODE = 'test-node-001';
const config = { nodeId: NODE, accountEventWindow: 100 };
let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

async function owner(name: string, operator: boolean): Promise<void> {
  await storage.createOwner({
    name, publicKey: 'dGVzdA==', roles: operator ? ['owner', 'operator'] : ['owner'], createdAt: new Date().toISOString(),
  });
}

async function agent(ownerName: string, name: string, scopes: string[] | undefined): Promise<string> {
  const gaii = `${name}#${ownerName}@${NODE}`;
  const now = new Date().toISOString();
  await storage.createAgent({
    name, owner: ownerName, gaii, capabilities: [], publicKey: 'dGVzdA==', trustScore: 50, morselBalance: 0,
    createdAt: now, lastSeen: now, ...(scopes ? { defaultScopes: scopes } : {}),
  });
  return gaii;
}

const scopesOf = async (gaii: string) => (await storage.getAgent(gaii))?.defaultScopes;
const granted = async (ownerName: string) =>
  (await storage.listAccountEvents({ ownerGhii: `${ownerName}@${NODE}`, limit: 100 }))
    .filter(e => e.kind === 'operator_admin_granted');

describe('migrateOperatorAdminOnce', () => {
  it('gives the word to the operator\'s full-access agents and to nobody else', async () => {
    await owner('op', true);
    await owner('plain', false);
    const wide = await agent('op', 'wide', ['*']);
    const narrow = await agent('op', 'narrow', ['memory:read']);
    const ticked = await agent('op', 'ticked', ['memory:read', WORD]);
    const nolist = await agent('op', 'nolist', undefined);
    const plainWide = await agent('plain', 'plainwide', ['*']);

    const r = await migrateOperatorAdminOnce(storage, config);

    expect(r).toEqual({ ran: true, granted: [{ owner: 'op', agents: ['wide'] }] });
    expect(await scopesOf(wide)).toEqual(['*', WORD]);
    expect(await scopesOf(narrow)).toEqual(['memory:read']);
    expect(await scopesOf(ticked)).toEqual(['memory:read', WORD]);
    // No list of its own holds nothing on a request (auth/effective-scopes.ts), so it is not `*`.
    expect(await scopesOf(nolist)).toBeUndefined();
    expect(await scopesOf(plainWide)).toEqual(['*']);

    const events = await granted('op');
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ names: 'wide', count: '1' });
    expect(events[0].link).toBe('/v1/profile?tab=agents');
    expect(await granted('plain')).toHaveLength(0);
  });

  it('runs once: a second run leaves the owner\'s untick and a later full-access agent alone', async () => {
    await owner('op', true);
    const wide = await agent('op', 'wide', ['*']);
    expect((await migrateOperatorAdminOnce(storage, config)).ran).toBe(true);

    await storage.updateAgent(wide, { defaultScopes: ['*'] });
    const later = await agent('op', 'later', ['*']);
    const again = await migrateOperatorAdminOnce(storage, config);

    expect(again).toEqual({ ran: false, granted: [] });
    expect(await scopesOf(wide)).toEqual(['*']);
    expect(await scopesOf(later)).toEqual(['*']);
    expect(await granted('op')).toHaveLength(1);
  });

  it('records that it ran on a node where nothing qualified, so a full-access agent made later is not given the word', async () => {
    await owner('op', true);
    expect(await migrateOperatorAdminOnce(storage, config)).toEqual({ ran: true, granted: [] });
    expect(await storage.getMemory(`system@${NODE}`, OPERATOR_ADMIN_MIGRATION_KEY)).not.toBeNull();

    const later = await agent('op', 'later', ['*']);
    expect((await migrateOperatorAdminOnce(storage, config)).ran).toBe(false);
    expect(await scopesOf(later)).toEqual(['*']);
    expect(await granted('op')).toHaveLength(0);
  });

  it('finishes a run that stopped half way without writing the word twice or naming an agent twice', async () => {
    await owner('op', true);
    // The earlier run reached this agent and stopped before the record was written.
    const first = await agent('op', 'first', ['*', WORD]);
    const second = await agent('op', 'second', ['*']);

    const r = await migrateOperatorAdminOnce(storage, config);

    expect(r.granted).toEqual([{ owner: 'op', agents: ['second'] }]);
    expect(await scopesOf(first)).toEqual(['*', WORD]);
    expect(await scopesOf(second)).toEqual(['*', WORD]);
    expect((await granted('op'))[0].data).toEqual({ names: 'second', count: '1' });
  });

  it('names every agent of one operator on one line', async () => {
    await owner('op', true);
    await agent('op', 'one', ['*']);
    await agent('op', 'two', ['*', 'memory:read']);

    await migrateOperatorAdminOnce(storage, config);

    const events = await granted('op');
    expect(events).toHaveLength(1);
    expect(events[0].data.count).toBe('2');
    expect(events[0].data.names.split(', ').sort()).toEqual(['one', 'two']);
  });
});
