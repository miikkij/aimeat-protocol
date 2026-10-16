/**
 * @file test/unit/admin-restore.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The import behind POST /v1/admin/restore (services/admin-restore.ts) against a storage
 *   double: a row that already exists is a skipped duplicate, any other failure is counted and named
 *   and makes `restored` false. QA audit P6-07: every create error was logged as "skip duplicates"
 *   and the answer always said `restored: true`.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit P6-07).
 */
import { describe, it, expect } from 'vitest';
import { restoreBackup } from '../../src/services/admin-restore.js';
import type { Storage } from '../../src/storage/interface.js';

/** A storage double: `existing` names rows already on the node; `broken` names rows whose write fails. */
function storageDouble(opts: { existing?: string[]; broken?: string[] } = {}) {
  const existing = new Set(opts.existing ?? []);
  const broken = new Set(opts.broken ?? []);
  const written: string[] = [];
  const create = (key: string) => async (rec: unknown) => {
    if (broken.has(key)) throw new Error('SQLITE_IOERR: disk I/O error');
    if (existing.has(key)) throw new Error('NAME_TAKEN');
    written.push(key); existing.add(key);
    return rec;
  };
  const storage = {
    createOwner: (o: { name: string }) => create(`owner:${o.name}`)(o),
    getOwner: async (name: string) => (existing.has(`owner:${name}`) ? { name } : null),
    createAgent: (a: { gaii: string }) => create(`agent:${a.gaii}`)(a),
    getAgent: async (gaii: string) => (existing.has(`agent:${gaii}`) ? { gaii } : null),
    createAction: (a: { id: string; providerGaii: string }) => create(`action:${a.providerGaii}/${a.id}`)(a),
    getAction: async (id: string, provider: string) => (existing.has(`action:${provider}/${id}`) ? { id } : null),
    createBoard: (b: { id: string }) => create(`board:${b.id}`)(b),
    getBoard: async (id: string) => (existing.has(`board:${id}`) ? { id } : null),
    setMemory: async (m: { key: string }) => {
      if (broken.has(`memory:${m.key}`)) throw new Error('value too large');
      written.push(`memory:${m.key}`); return m;
    },
    addTransaction: async (tx: { id: string }) => {
      if (existing.has(`tx:${tx.id}`)) throw Object.assign(new Error('UNIQUE constraint failed: wallet_transactions.id'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
      written.push(`tx:${tx.id}`); return tx;
    },
  };
  return { storage: storage as unknown as Storage, written };
}

const body = {
  owners: [{ name: 'alice' }, { name: 'bob' }],
  agents: [{ gaii: 'claude#alice@n' }],
  actions: [{ id: 'act1', providerGaii: 'claude#alice@n' }],
  boards: [{ id: 'b1' }],
  agent_data: { 'claude#alice@n': { memories: [{ key: 'm1' }], transactions: [{ id: 't1' }] } },
};

describe('restoreBackup', () => {
  it('imports everything into an empty node and says restored', async () => {
    const { storage, written } = storageDouble();
    const out = await restoreBackup(storage, body);
    expect(out.restored).toBe(true);
    expect(out.imported).toEqual({ owners: 2, agents: 1, actions: 1, boards: 1, memories: 1, transactions: 1 });
    expect(out.failures).toEqual([]);
    expect(written).toContain('owner:bob');
  });

  it('counts a row that already exists as a skipped duplicate, and still says restored', async () => {
    const { storage } = storageDouble({ existing: ['owner:alice', 'board:b1', 'tx:t1'] });
    const out = await restoreBackup(storage, body);
    expect(out.restored).toBe(true);
    expect(out.skipped_duplicates.owners).toBe(1);
    expect(out.skipped_duplicates.boards).toBe(1);
    expect(out.skipped_duplicates.transactions).toBe(1);
    expect(out.imported.owners).toBe(1);
    expect(out.failed).toEqual({ owners: 0, agents: 0, actions: 0, boards: 0, memories: 0, transactions: 0 });
  });

  it('reports a failure that is not a duplicate: counted, named, and restored is false', async () => {
    const { storage } = storageDouble({ existing: ['owner:alice'], broken: ['owner:bob', 'agent:claude#alice@n', 'memory:m1'] });
    const out = await restoreBackup(storage, body);
    expect(out.restored).toBe(false);
    expect(out.skipped_duplicates.owners).toBe(1);
    expect(out.failed.owners).toBe(1);
    expect(out.failed.agents).toBe(1);
    expect(out.failed.memories).toBe(1);
    expect(out.failures.map(f => `${f.kind}:${f.key}`)).toEqual(['owners:bob', 'agents:claude#alice@n', 'memories:claude#alice@n/m1']);
    expect(out.failures[0].error).toContain('disk I/O error');
    // The rows after a failure are still tried.
    expect(out.imported.actions).toBe(1);
    expect(out.imported.boards).toBe(1);
  });
});
