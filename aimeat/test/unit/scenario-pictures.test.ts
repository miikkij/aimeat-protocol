/**
 * @file test/unit/scenario-pictures.test.ts
 * @description The pictures a scenario run keeps: the key of each, which sizes get one, the sweep
 *   that removes what a run did not write, and the address an answer names for a picture that is
 *   still in the owner's files.
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-noden-selain-antaa-kuvat-skenaarioajosta-rakentaja-ei-asenna).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair } from 'jose';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { StorageFileRecord } from '../../src/storage/types/commerce.js';
import { initDownloadTokenKeys, verifyDownloadToken } from '../../src/services/download-token.js';
import {
  isPictureSize, keepScenarioPicture, removeScenarioPictures, scenarioPictureKey, sweepScenarioPictures, withPictureAddresses,
} from '../../src/services/app/scenario-pictures.js';

const OWNER = 'alice@node-test';
const config = { baseUrl: 'http://node.test/' } as AimeatConfig;

/** The four stored-file methods the module calls, over a map. */
function fakeStorage(): { storage: Storage; files: Map<string, StorageFileRecord> } {
  const files = new Map<string, StorageFileRecord>();
  const id = (owner: string, key: string) => `${owner} ${key}`;
  const storage = {
    async createStorageFile(f: StorageFileRecord) { files.set(id(f.ownerGaii, f.key), f); return f; },
    async listStorageFiles(owner: string) { return [...files.values()].filter(f => f.ownerGaii === owner).map(f => ({ ...f, data: Buffer.alloc(0) })); },
    async getStorageFileMeta(owner: string, key: string) { const f = files.get(id(owner, key)); return f ? { ...f, data: Buffer.alloc(0) } : null; },
    async deleteStorageFile(owner: string, key: string) { return files.delete(id(owner, key)); },
  } as unknown as Storage;
  return { storage, files };
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const picture = (scenario: string, size = '390x844', theme: 'light' | 'dark' = 'light') => ({ scenario, size, theme, jpeg });

beforeAll(async () => {
  const kp = await generateKeyPair('EdDSA', { extractable: true });
  initDownloadTokenKeys(kp.privateKey as CryptoKey, kp.publicKey as CryptoKey);
});

describe('scenario pictures', () => {
  it('a picture is taken at the phone and the desktop size, and at no other', () => {
    expect(isPictureSize({ width: 390, height: 844 })).toBe(true);
    expect(isPictureSize({ width: 1280, height: 900 })).toBe(true);
    expect(isPictureSize({ width: 1280, height: 460 })).toBe(false);
    expect(isPictureSize({ width: 1920, height: 1080 })).toBe(false);
  });

  it('the key is outside apps/, where every key is read as an app', () => {
    const key = scenarioPictureKey('errands.html', picture('add-one'));
    expect(key).toBe('playtest/errands.html/add-one-390x844-light.jpg');
    expect(key.startsWith('apps/')).toBe(false);
  });

  it('a kept picture is a private file of the owner', async () => {
    const { storage, files } = fakeStorage();
    const key = await keepScenarioPicture(storage, OWNER, 'errands.html', picture('add-one'));
    expect(key).toBe('playtest/errands.html/add-one-390x844-light.jpg');
    const file = files.get(`${OWNER} ${key}`);
    expect(file?.visibility).toBe('private');
    expect(file?.mimeType).toBe('image/jpeg');
    expect(file?.size).toBe(jpeg.length);
  });

  it('a picture that cannot be stored answers null and throws nothing', async () => {
    const storage = { async createStorageFile() { throw new Error('store is full'); } } as unknown as Storage;
    expect(await keepScenarioPicture(storage, OWNER, 'errands.html', picture('add-one'))).toBeNull();
  });

  it('the sweep removes what the run did not write, and nothing of another app or another kind', async () => {
    const { storage, files } = fakeStorage();
    const kept = await keepScenarioPicture(storage, OWNER, 'errands.html', picture('add-one')) as string;
    await keepScenarioPicture(storage, OWNER, 'errands.html', picture('renamed-away'));
    await keepScenarioPicture(storage, OWNER, 'other.html', picture('add-one'));
    await storage.createStorageFile({ key: 'notes/list.txt', ownerGaii: OWNER, visibility: 'private', mimeType: 'text/plain', size: 1, data: Buffer.from('x'), createdAt: new Date().toISOString() });
    expect(await sweepScenarioPictures(storage, OWNER, 'errands.html', new Set([kept]))).toBe(1);
    expect([...files.keys()].sort()).toEqual([
      `${OWNER} notes/list.txt`,
      `${OWNER} playtest/errands.html/add-one-390x844-light.jpg`,
      `${OWNER} playtest/other.html/add-one-390x844-light.jpg`,
    ]);
  });

  it('an app whose name starts with another app\'s name keeps its pictures', async () => {
    const { storage, files } = fakeStorage();
    await keepScenarioPicture(storage, OWNER, 'errands.html', picture('add-one'));
    await keepScenarioPicture(storage, OWNER, 'errands.html2', picture('add-one'));
    expect(await removeScenarioPictures(storage, OWNER, 'errands.html')).toBe(1);
    expect([...files.keys()]).toEqual([`${OWNER} playtest/errands.html2/add-one-390x844-light.jpg`]);
  });

  it('an answer names an address for a picture that is there, valid for that file', async () => {
    const { storage } = fakeStorage();
    const key = await keepScenarioPicture(storage, OWNER, 'errands.html', picture('add-one')) as string;
    const answer = { ran: true, scenarios: [{ id: 'add-one', runs: [{ size: '390x844', picture_key: key }, { size: '1920x1080' }] }] };
    const out = await withPictureAddresses(storage, config, OWNER, answer);
    const [withPicture, without] = out.scenarios[0].runs as Array<{ picture?: string }>;
    expect(withPicture.picture).toMatch(/^http:\/\/node\.test\/v1\/download\/[\w.-]+$/);
    expect(without.picture).toBeUndefined();
    expect(out.pictures).toMatch(/LOOK at it/);
    const verified = await verifyDownloadToken((withPicture.picture as string).split('/').pop() as string);
    expect(verified.key).toBe(key);
    expect(verified.sub).toBe(OWNER);
  });

  it('a picture that is gone gets no address, and the answer says nothing about pictures', async () => {
    const { storage } = fakeStorage();
    const answer = { ran: true, scenarios: [{ id: 'add-one', runs: [{ size: '390x844', picture_key: 'playtest/errands.html/add-one-390x844-light.jpg' }] }] };
    const out = await withPictureAddresses(storage, config, OWNER, answer);
    expect((out.scenarios[0].runs[0] as { picture?: string }).picture).toBeUndefined();
    expect(out.pictures).toBeUndefined();
  });
});
