/**
 * @file test/unit/file-store-named.test.ts
 * @description The pieces under several file stores, without a network: the place a person names for a
 *   store id (`own:<name>`, `node:<name>`, `database`), the name rules and the reserved node names, the
 *   bucket a target names whatever form its address was given in, nested folders, and the sweep of one
 *   store keeping the objects a sibling store of the same bucket names while it removes a true orphan.
 * @version-history
 *   v1.0.0 -- 2026-10-30 -- Initial (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { describe, it, expect, vi } from 'vitest';
import type { BlobStore } from '../../src/storage/blob/blob-types.js';
import type { Storage } from '../../src/storage/interface.js';

vi.mock('../../src/services/push.js', () => ({}));

const { choiceIdOf } = await import('../../src/services/file-store/file-store-resolver.js');
const { placeKey, prefixesOverlap, storeNameProblem } = await import('../../src/services/file-store/store-target.js');
const { RESERVED_NODE_STORE_NAMES } = await import('../../src/services/file-store/node-file-stores.js');
const { ownerEntryStoreId } = await import('../../src/services/file-store/owner-file-store.js');
const { sweepStore } = await import('../../src/services/file-store/file-store-sweep.js');

describe('the place a person names', () => {
  it('names the database, a node store, and a person\'s stores of both record versions', () => {
    expect(choiceIdOf(null)).toBe('database');
    expect(choiceIdOf('node:s3')).toBe('node:s3');
    expect(choiceIdOf('node:archive')).toBe('node:archive');
    expect(choiceIdOf('owner:alice@n1')).toBe('own:main');
    expect(choiceIdOf(ownerEntryStoreId('alice@n1', 'photos'))).toBe('own:photos');
  });

  it('takes lower-case names and refuses the node\'s reserved ones', () => {
    expect(storeNameProblem('archive-2')).toBeNull();
    for (const bad of ['', 'Archive', '-x', 'a b', 'x'.repeat(41)]) expect(storeNameProblem(bad), bad).not.toBeNull();
    for (const name of RESERVED_NODE_STORE_NAMES) expect(storeNameProblem(name, RESERVED_NODE_STORE_NAMES)).not.toBeNull();
  });
});

describe('one bucket, whichever way its address was given', () => {
  it('names the same S3 bucket with or without a trailing slash, and AWS by its region', () => {
    const a = placeKey({ kind: 's3', endpoint: 'https://S3.example.com/', region: 'x', bucket: 'b', addressing: 'auto' });
    const b = placeKey({ kind: 's3', endpoint: 'https://s3.example.com', region: 'y', bucket: 'b', addressing: 'path' });
    expect(a).toBe(b);
    expect(placeKey({ kind: 's3', endpoint: '', region: 'eu-north-1', bucket: 'b', addressing: 'auto' }))
      .not.toBe(placeKey({ kind: 's3', endpoint: '', region: 'us-east-1', bucket: 'b', addressing: 'auto' }));
  });

  it('names an Azure container by its account', () => {
    expect(placeKey({ kind: 'azure', account: 'Acc', container: 'c', endpoint: '' }))
      .toBe(placeKey({ kind: 'azure', account: 'acc', container: 'c', endpoint: '' }));
  });

  it('sees a folder inside another', () => {
    expect(prefixesOverlap('aimeat/n/files/', 'aimeat/n/files/twin/')).toBe(true);
    expect(prefixesOverlap('aimeat/n/files/', 'aimeat/n/stores/a/')).toBe(false);
  });
});

describe('the sweep of one store among siblings', () => {
  const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
  function storeOf(keys: string[]): BlobStore & { deleted: string[] } {
    const deleted: string[] = [];
    return {
      kind: 's3', describe: () => 'test', deleted,
      put: async () => undefined, get: async () => null, getRange: async () => null,
      delete: async (k: string) => { deleted.push(k); },
      list: async (prefix: string) => ({ objects: keys.filter(k => k.startsWith(prefix)).map(key => ({ key, lastModified: old, size: 1 })) }),
    };
  }
  // The rows: one object named by the environment's store, one by a named store inside its folder.
  const rows = new Set(['node:s3|aimeat/n/files/a', 'node:twin|aimeat/n/files/twin/b']);
  const storage = { storageFileBlobRefsIn: async (refs: string[]) => refs.filter(r => rows.has(r)) } as unknown as Storage;
  const ctx = { storage, config: {} as never };
  const keys = ['aimeat/n/files/a', 'aimeat/n/files/twin/b', 'aimeat/n/files/orphan'];

  it('keeps what a sibling names and removes the orphan', async () => {
    const store = storeOf(keys);
    const r = await sweepStore(ctx, 'node:s3', store, 'aimeat/n/files/', { siblings: ['node:s3', 'node:twin'] });
    expect(store.deleted).toEqual(['aimeat/n/files/orphan']);
    expect(r.removed).toBe(1);
  });

  it('without its siblings it would take the other store\'s object, which is why they are passed', async () => {
    const store = storeOf(keys);
    await sweepStore(ctx, 'node:s3', store, 'aimeat/n/files/');
    expect(store.deleted).toContain('aimeat/n/files/twin/b');
  });
});
