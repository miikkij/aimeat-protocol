/**
 * @file test/unit/failed-read-no-overwrite.test.ts
 * @description A failed read is never the basis of a delete or an overwrite (QA audit F2-06):
 *   removeContact refuses when the conversation read fails, and the consent row stays;
 *   getActiveBook tells "no book stored" apart from "the read failed", so pullBook and
 *   assembleBook do not replace a newer stored book or restart its version at 1.
 * @usage cd aimeat && pnpm exec vitest run test/unit/failed-read-no-overwrite.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F2-06).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchState: { body: unknown } = { body: null };
vi.mock('../../src/utils/url-validator.js', async (orig) => ({
  ...(await orig<typeof import('../../src/utils/url-validator.js')>()),
  validateOutboundUrl: async () => ({ valid: true }),
  safeFetch: async () => new Response(JSON.stringify(fetchState.body), { status: 200, headers: { 'content-type': 'application/json' } }),
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { removeContact } from '../../src/services/contacts.js';
import {
  getActiveBook, storeActiveBook, assembleBook, pullBook, bookSignString,
  FEDERATION_BOOK_GAII, FEDERATION_BOOK_KEY, type FederationBook,
} from '../../src/services/federation-book.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';

const NODE = 'node-1';

function fresh(): Storage {
  return new SqliteStorage(':memory:') as unknown as Storage;
}

/** Make the next `n` reads of the federation book record fail, as a storage outage would. */
function failBookReads(storage: Storage, n: number): void {
  const real = storage.getMemory.bind(storage);
  let left = n;
  (storage as unknown as { getMemory: Storage['getMemory'] }).getMemory = (async (owner: string, key: string) => {
    if (owner === FEDERATION_BOOK_GAII && key === FEDERATION_BOOK_KEY && left > 0) { left--; throw new Error('connection reset'); }
    return real(owner, key);
  }) as Storage['getMemory'];
}

describe('removeContact: a failed conversation read deletes nothing', () => {
  it('propagates the read error and keeps the consent row', async () => {
    const storage = fresh();
    const owner = `alice@${NODE}`;
    const contact = `bob@${NODE}`;
    await storage.setContactState(owner, contact, 'accepted', undefined, 'saved');
    (storage as unknown as { listConversation: () => Promise<never> }).listConversation = async () => { throw new Error('connection reset'); };

    await expect(removeContact(storage, owner, contact)).rejects.toThrow('connection reset');
    expect(await storage.getContact(owner, contact)).not.toBeNull();
  });
});

describe('the federation book: a failed read is not "no book"', () => {
  const stored: FederationBook = { book_version: 7, issued_by: 'primary', issued_at: '2026-10-01T00:00:00.000Z', nodes: [{ node_id: 'x', url: 'https://x.example', listed: true }] };

  beforeEach(() => { fetchState.body = null; });

  it('getActiveBook answers null only when nothing is stored, and throws when the read fails', async () => {
    const storage = fresh();
    expect(await getActiveBook(storage)).toBeNull();
    await storeActiveBook(storage, stored);
    failBookReads(storage, 1);
    await expect(getActiveBook(storage)).rejects.toThrow('connection reset');
  });

  it('assembleBook does not restart the version at 1 after a failed read', async () => {
    const storage = fresh();
    await storeActiveBook(storage, stored);
    failBookReads(storage, 1);
    const config = { nodeId: NODE, baseUrl: 'https://node-1.example', federationBookListed: false } as AimeatConfig;
    await expect(assembleBook(config, storage, new Map())).rejects.toThrow();
    expect((await getActiveBook(storage))?.book_version).toBe(7);
  });

  it('pullBook does not replace a newer stored book after a failed read', async () => {
    const storage = fresh();
    await storeActiveBook(storage, stored);
    const keys = await generateKeyPair();
    const older: FederationBook = { book_version: 3, issued_by: 'primary', issued_at: '2026-09-01T00:00:00.000Z', nodes: [] };
    older.signature = await sign(keys.privateKey, bookSignString(older));
    fetchState.body = { data: { book: older } };
    const peers = new Map<string, PeerInfo>([['primary', { nodeId: 'primary', url: 'https://primary.example', publicKey: keys.publicKey, status: 'active' } as PeerInfo]]);
    failBookReads(storage, 1);

    const config = { nodeId: NODE, genesisUrl: 'https://primary.example' } as AimeatConfig;
    await expect(pullBook(config, storage, peers)).rejects.toThrow();
    expect((await getActiveBook(storage))?.book_version).toBe(7);
  });
});
