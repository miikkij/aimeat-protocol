/**
 * @file test/unit/file-store-blob.test.ts
 * @description The pieces under the file stores, without a network: the S3 signature against the two
 *   examples AWS publishes for it (a ranged GET and a listing, from "Signature Calculations for the
 *   Authorization Header: Transferring Payload in a Single Chunk"), the S3 address forms, the Azure
 *   connection string and SAS URL forms people copy from the portal, the object reference, and the
 *   storage wrapper's rules on a fake store: a caller's reference is never taken, a failed row write
 *   removes the object it made, a replaced or deleted file's object is removed, and a move from the
 *   database lands only on a row that still holds the bytes it was read with.
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { describe, it, expect } from 'vitest';
import { s3SignatureFor, s3Target } from '../../src/storage/blob/s3-client.js';
import { parseAzureConnection } from '../../src/storage/blob/azure-client.js';
import { formatBlobRef, parseBlobRef, nodeStoreId, ownerStoreId, type BlobStore } from '../../src/storage/blob/blob-types.js';
import { uriEncode } from '../../src/storage/blob/blob-http.js';
import { wrapStorageWithFileStores, relocateStorageFile, type FileStoreTarget } from '../../src/storage/blob/file-store-wrap.js';
import { azureSpecFrom } from '../../src/services/file-store/file-store-specs.js';
import { nodeFilePrefix, normalizePrefix } from '../../src/config-file-store.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z') };

describe('S3 signature (AWS Signature Version 4)', () => {
  it('matches AWS\'s published GET Object example with a Range header', () => {
    const r = s3SignatureFor({ ...AWS, method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', query: '', payloadHash: EMPTY, extraHeaders: { range: 'bytes=0-9' } });
    expect(r.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.headers).not.toHaveProperty('host');
  });

  it('matches AWS\'s published ListObjects example', () => {
    const t = s3Target({ kind: 's3', endpoint: 'https://examplebucket.s3.amazonaws.com', pathStyle: false, region: 'us-east-1', bucket: '', accessKeyId: '', secretAccessKey: '' }, '', { 'max-keys': '2', prefix: 'J' });
    expect(t.query).toBe('max-keys=2&prefix=J');
    const r = s3SignatureFor({ ...AWS, method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/', query: t.query, payloadHash: EMPTY });
    expect(r.authorization.endsWith('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')).toBe(true);
  });

  it('addresses a bucket by path with an endpoint and by host name on AWS, and encodes a key the way it signs it', () => {
    const own = s3Target({ kind: 's3', endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', bucket: 'files', accessKeyId: '', secretAccessKey: '' }, 'a b/ä(1)*.txt');
    expect(own.url).toBe('http://127.0.0.1:9000/files/a%20b/%C3%A4%281%29%2A.txt');
    const aws = s3Target({ kind: 's3', region: 'eu-north-1', bucket: 'files', accessKeyId: '', secretAccessKey: '' }, 'k');
    expect(aws.url).toBe('https://files.s3.eu-north-1.amazonaws.com/k');
    expect(uriEncode('a/b c', true)).toBe('a/b%20c');
    expect(uriEncode('a/b', false)).toBe('a%2Fb');
  });
});

describe('Azure connection forms', () => {
  it('reads a connection string, an Azurite connection string and a container SAS URL', () => {
    expect(parseAzureConnection('DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=a2V5;EndpointSuffix=core.windows.net'))
      .toEqual({ accountName: 'acct', accountKey: 'a2V5', endpoint: 'https://acct.blob.core.windows.net' });
    expect(parseAzureConnection('AccountName=devstoreaccount1;AccountKey=a2V5;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'))
      .toEqual({ accountName: 'devstoreaccount1', accountKey: 'a2V5', endpoint: 'http://127.0.0.1:10000/devstoreaccount1' });
    expect(parseAzureConnection('https://acct.blob.core.windows.net/my-files?sv=2022-11-02&sp=racwdl&sig=abc'))
      .toEqual({ accountName: 'acct', container: 'my-files', sasToken: 'sv=2022-11-02&sp=racwdl&sig=abc', endpoint: 'https://acct.blob.core.windows.net' });
    expect(parseAzureConnection('not a credential')).toBeNull();
    expect(parseAzureConnection('https://acct.blob.core.windows.net/c?sv=1')).toBeNull();
  });

  it('builds a spec from a bare key, a connection string or a SAS URL, and names what is missing', () => {
    expect(azureSpecFrom({ account: 'acct', container: 'c', endpoint: '', credential: 'a2V5' }).spec?.accountKey).toBe('a2V5');
    expect(azureSpecFrom({ account: '', container: '', endpoint: '', credential: 'https://acct.blob.core.windows.net/c?sv=1&sig=x' }).spec)
      .toMatchObject({ accountName: 'acct', container: 'c', sasToken: 'sv=1&sig=x' });
    expect(azureSpecFrom({ account: '', container: '', endpoint: '', credential: null }).missing).toEqual(['account', 'container', 'credential']);
  });
});

describe('object references and folders', () => {
  it('round-trips a reference and refuses what is not one', () => {
    const ref = formatBlobRef(ownerStoreId('alice@node'), 'aimeat/alice@node/1');
    expect(parseBlobRef(ref)).toEqual({ storeId: 'owner:alice@node', objectKey: 'aimeat/alice@node/1' });
    expect(nodeStoreId('s3')).toBe('node:s3');
    expect(parseBlobRef(undefined)).toBeNull();
    expect(parseBlobRef('|x')).toBeNull();
    expect(parseBlobRef('node:s3|')).toBeNull();
  });

  it('never leaves the node\'s folder empty, so the sweep never lists a whole bucket', () => {
    expect(normalizePrefix(' /a/b// ')).toBe('a/b/');
    expect(normalizePrefix('')).toBe('');
    expect(nodeFilePrefix({ fileStorePrefix: '', nodeId: 'n1' })).toBe('aimeat/n1/files/');
    expect(nodeFilePrefix({ fileStorePrefix: 'x', nodeId: 'n1' })).toBe('x/');
  });
});

// ── the wrapper, on a fake database and a fake store ──

function fakeStore(): BlobStore & { map: Map<string, Buffer>; failPut?: boolean } {
  const map = new Map<string, Buffer>();
  const s = {
    map, kind: 's3' as const, describe: () => 'fake',
    async put(k: string, d: Buffer) { if (s.failPut) throw new Error('put refused'); map.set(k, Buffer.from(d)); },
    async get(k: string) { return map.get(k) ?? null; },
    async getRange(k: string, start: number, len: number) { const b = map.get(k); return b ? b.subarray(start, start + len) : null; },
    async delete(k: string) { map.delete(k); },
    async list() { return { objects: [...map.keys()].map(key => ({ key, lastModified: '', size: 0 })) }; },
  };
  return s as BlobStore & { map: Map<string, Buffer>; failPut?: boolean };
}

function fakeDb(opts: { failCreate?: () => boolean } = {}) {
  const rows = new Map<string, StorageFileRecord>();
  const id = (o: string, k: string) => `${o}\n${k}`;
  const storage = {
    async createStorageFile(f: StorageFileRecord) { if (opts.failCreate?.()) throw new Error('row write failed'); rows.set(id(f.ownerGaii, f.key), { ...f }); return f; },
    async getStorageFile(o: string, k: string) { const r = rows.get(id(o, k)); return r ? { ...r } : null; },
    async getStorageFileMeta(o: string, k: string) { const r = rows.get(id(o, k)); return r ? { ...r, data: Buffer.alloc(0) } : null; },
    async readStorageFileRange(o: string, k: string, s: number, l: number) { return rows.get(id(o, k))?.data.subarray(s, s + l) ?? null; },
    async deleteStorageFile(o: string, k: string) { return rows.delete(id(o, k)); },
    async setStorageFileBlobRef(o: string, k: string, ref: string, size: number) {
      const r = rows.get(id(o, k));
      if (!r || r.blobRef || r.size !== size) return false;
      rows.set(id(o, k), { ...r, blobRef: ref, data: Buffer.alloc(0) });
      return true;
    },
  };
  return { storage: storage as unknown as Storage, rows };
}

const file = (key: string, text: string): StorageFileRecord => ({
  key, ownerGaii: 'alice@node', visibility: 'private', mimeType: 'text/plain', size: Buffer.byteLength(text), data: Buffer.from(text), createdAt: '2026-10-29T00:00:00Z',
});

describe('the storage wrapper', () => {
  it('writes the bytes to the store, keeps the row empty, reads them back whole and by range', async () => {
    const store = fakeStore();
    const { storage, rows } = fakeDb();
    const target: FileStoreTarget = { storeId: 'node:s3', store, prefix: 'p/' };
    wrapStorageWithFileStores(storage, { forWrite: async () => target, forRead: async () => store });
    await storage.createStorageFile(file('a.txt', 'hello world'));
    const row = [...rows.values()][0];
    expect(row.data.length).toBe(0);
    expect(row.blobRef?.startsWith('node:s3|p/')).toBe(true);
    expect(row.utf8Verified).toBe(true);
    expect((await storage.getStorageFile('alice@node', 'a.txt'))?.data.toString()).toBe('hello world');
    expect((await storage.readStorageFileRange('alice@node', 'a.txt', 6, 5))?.toString()).toBe('world');
  });

  it('never takes a reference from the caller: a copy of a file gets an object of its own', async () => {
    const store = fakeStore();
    const { storage } = fakeDb();
    wrapStorageWithFileStores(storage, { forWrite: async () => ({ storeId: 'node:s3', store, prefix: '' }), forRead: async () => store });
    const original = await storage.createStorageFile(file('a.txt', 'shared bytes'));
    await storage.createStorageFile({ ...original, key: 'copy.txt' });
    expect(store.map.size).toBe(2);
    await storage.deleteStorageFile('alice@node', 'a.txt');
    expect((await storage.getStorageFile('alice@node', 'copy.txt'))?.data.toString()).toBe('shared bytes');
  });

  it('removes the new object when the row write fails, and the old one when a file is replaced or deleted', async () => {
    const store = fakeStore();
    let failing = false;
    const { storage } = fakeDb({ failCreate: () => failing });
    wrapStorageWithFileStores(storage, { forWrite: async () => ({ storeId: 'node:s3', store, prefix: '' }), forRead: async () => store });
    await storage.createStorageFile(file('a.txt', 'v1'));
    failing = true;
    await expect(storage.createStorageFile(file('a.txt', 'v2'))).rejects.toThrow('row write failed');
    expect(store.map.size).toBe(1);
    failing = false;
    await storage.createStorageFile(file('a.txt', 'v3'));
    expect([...store.map.values()].map(b => b.toString())).toEqual(['v3']);
    await storage.deleteStorageFile('alice@node', 'a.txt');
    expect(store.map.size).toBe(0);
  });

  it('moves a database file to a store only while the row still holds the bytes it was read with', async () => {
    const store = fakeStore();
    const { storage, rows } = fakeDb();
    wrapStorageWithFileStores(storage, { forWrite: async () => null, forRead: async () => store });
    await storage.createStorageFile(file('a.txt', 'in the database'));
    const target: FileStoreTarget = { storeId: 'node:s3', store, prefix: '' };
    expect(await relocateStorageFile(storage, 'alice@node', 'a.txt', target)).toBe('moved');
    expect([...rows.values()][0].blobRef?.startsWith('node:s3|')).toBe(true);
    expect(await relocateStorageFile(storage, 'alice@node', 'a.txt', target)).toBe('already-there');
    expect(await relocateStorageFile(storage, 'alice@node', 'a.txt', null)).toBe('moved');
    expect([...rows.values()][0].data.toString()).toBe('in the database');
    expect(store.map.size).toBe(0);
  });

  it('reports a file whose store this node no longer has, instead of answering empty bytes', async () => {
    const store = fakeStore();
    const { storage } = fakeDb();
    let connected = true;
    wrapStorageWithFileStores(storage, { forWrite: async () => ({ storeId: 'owner:alice@node', store, prefix: '' }), forRead: async () => (connected ? store : null) });
    await storage.createStorageFile(file('a.txt', 'x'));
    connected = false;
    await expect(storage.getStorageFile('alice@node', 'a.txt')).rejects.toThrow(/no longer has/);
  });
});
