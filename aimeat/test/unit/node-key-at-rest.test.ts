/**
 * @file test/unit/node-key-at-rest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The database copy of the node's private key (the NodeKey row) is encrypted when the
 *   node has a secret to encrypt it with, and every way a node held its key before still boots with
 *   the same identity. Secrets audit 2026-10-09, node configuration S4a: the row was plain text and
 *   read before the passphrase-protected file, so AIMEAT_KEY_PASSPHRASE protected nothing against a
 *   database dump.
 *
 *   THIS IS THE NODE'S FEDERATION IDENTITY. Every case boots a real node-key initialisation
 *   (auth/node-keys.ts initializeNode) against a SQLite FILE, reads the row raw, boots again on the
 *   same file and checks the public key did not change. The combinations: no secret; the data key
 *   (AIMEAT_ENCRYPTION_KEY) only; the passphrase (AIMEAT_KEY_PASSPHRASE) only; both; a plain row
 *   from before with and without a secret; a sealed row whose secret is gone, with and without the
 *   key file; a key file only; a row whose public key was swapped.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { initializeNode } from '../../src/auth/node-keys.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import {
  configureNodeKeySecrets, sealNodePrivateKey, openNodePrivateKey, isSealedNodeKey, NodeKeyLockedError, SEALED_NODE_KEY_PREFIX,
} from '../../src/storage/node-key-at-rest.js';

const root = mkdtempSync(join(tmpdir(), 'aimeat-node-key-at-rest-'));
const DATA_KEY = randomBytes(32).toString('hex');
const PASSPHRASE = 'correct horse battery staple 2026';
const saved = { pass: process.env.AIMEAT_KEY_PASSPHRASE, path: process.env.AIMEAT_NODE_KEY_PATH, home: process.env.HOME, up: process.env.USERPROFILE };
const open: SqliteStorage[] = [];
let n = 0;
let dbPath = '';
let keyPath = '';

class Exited extends Error { constructor(readonly code: unknown) { super(`process.exit(${String(code)})`); } }

beforeEach(() => {
  const dir = join(root, `case-${n++}`);
  dbPath = join(dir, 'node.db');
  keyPath = join(dir, 'node-key.json');
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.AIMEAT_NODE_KEY_PATH = keyPath;
  delete process.env.AIMEAT_KEY_PASSPHRASE;
  configureNodeKeySecrets(null);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Exited(code); }) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of open.splice(0)) s.close();
  for (const [k, v] of [['AIMEAT_KEY_PASSPHRASE', saved.pass], ['AIMEAT_NODE_KEY_PATH', saved.path], ['HOME', saved.home], ['USERPROFILE', saved.up]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function storageAt(): SqliteStorage {
  const dir = join(dbPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const s = new SqliteStorage(dbPath);
  open.push(s);
  return s;
}

const cfg = (encryptionKey: string | null): AimeatConfig => ({ nodeId: 'aimeat-test-nodekey', encryptionKey } as unknown as AimeatConfig);

/** One boot: a fresh storage handle on the same file, the passphrase as given. */
async function boot(opts: { dataKey?: string | null; passphrase?: string | null } = {}): Promise<{ publicKey: string; privateKey: string }> {
  if (opts.passphrase) process.env.AIMEAT_KEY_PASSPHRASE = opts.passphrase; else delete process.env.AIMEAT_KEY_PASSPHRASE;
  for (const s of open.splice(0)) s.close();
  const storage = storageAt();
  await initializeNode(cfg(opts.dataKey ?? null), storage as unknown as Storage);
  const k = await storage.getNodeKey();
  if (!k) throw new Error('no node key after boot');
  return { publicKey: k.publicKey, privateKey: k.privateKey };
}

/** A row as a node before 2026-10-09 wrote it: the private key in plain text, no key file. */
async function plainRowFromBefore(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await generateKeyPair();
  configureNodeKeySecrets({});
  await storageAt().setNodeKey(kp.publicKey, kp.privateKey);
  configureNodeKeySecrets(null);
  expect(rawRow()?.privateKey).toBe(kp.privateKey);
  return kp;
}

function clearRow(): void {
  const s = open[open.length - 1] ?? storageAt();
  (s as unknown as { db: { prepare(q: string): { run(): unknown } } }).db.prepare('DELETE FROM node_key').run();
}

/** The row as it sits in the database. */
function rawRow(): { publicKey: string; privateKey: string } | undefined {
  const s = open[open.length - 1] ?? storageAt();
  return (s as unknown as { db: { prepare(q: string): { get(): unknown } } }).db
    .prepare('SELECT publicKey, privateKey FROM node_key WHERE id = 1').get() as { publicKey: string; privateKey: string } | undefined;
}

describe('the node key in the database', () => {
  it('no secret: stored as before, and the next boot has the same identity', async () => {
    const first = await boot();
    expect(rawRow()?.privateKey).toBe(first.privateKey);
    expect((await boot()).publicKey).toBe(first.publicKey);
  });

  it('the data key only: the row is encrypted, and the next boot has the same identity', async () => {
    const first = await boot({ dataKey: DATA_KEY });
    expect(rawRow()?.privateKey).not.toBe(first.privateKey);
    expect(rawRow()?.privateKey).not.toContain(first.privateKey);
    const again = await boot({ dataKey: DATA_KEY });
    expect(again).toEqual(first);
  });

  it('the passphrase only: the row and the file are encrypted, and the next boot has the same identity', async () => {
    const first = await boot({ passphrase: PASSPHRASE });
    expect(rawRow()?.privateKey).not.toBe(first.privateKey);
    expect(readFileSync(keyPath, 'utf-8')).not.toContain(first.privateKey);
    expect(await boot({ passphrase: PASSPHRASE })).toEqual(first);
  });

  it('a plain row from before is encrypted at boot when a secret is set, keeping the keypair', async () => {
    const kp = await plainRowFromBefore();
    const after = await boot({ dataKey: DATA_KEY });
    expect(after).toEqual(kp);
    expect(rawRow()?.privateKey).not.toBe(kp.privateKey);
    expect(await boot({ dataKey: DATA_KEY })).toEqual(kp);
  });

  it('a plain row from before stays as it is when no secret is set', async () => {
    const kp = await plainRowFromBefore();
    expect(await boot()).toEqual(kp);
    expect(rawRow()?.privateKey).toBe(kp.privateKey);
  });

  it('both secrets: the passphrase seals it, and either boot opens it', async () => {
    const first = await boot({ dataKey: DATA_KEY, passphrase: PASSPHRASE });
    expect(rawRow()?.privateKey.startsWith(`${SEALED_NODE_KEY_PREFIX}p:`)).toBe(true);
    expect(await boot({ dataKey: DATA_KEY, passphrase: PASSPHRASE })).toEqual(first);
  });

  it('a key file only (an empty database): the file is the identity, and the row is written sealed', async () => {
    const first = await boot({ passphrase: PASSPHRASE });
    clearRow();
    expect(await boot({ passphrase: PASSPHRASE })).toEqual(first);
    expect(rawRow()?.privateKey.startsWith(SEALED_NODE_KEY_PREFIX)).toBe(true);
  });

  it('a sealed row whose data key is gone: the plain key file with the same identity is used, no new identity', async () => {
    const first = await boot({ dataKey: DATA_KEY });
    // The file is plain: only the passphrase encrypts the file, as before.
    expect(readFileSync(keyPath, 'utf-8')).toContain(first.privateKey);
    expect(await boot()).toEqual(first);
  });

  it('a sealed row whose data key CHANGED: the key file answers, and the row is sealed again with the new key', async () => {
    const first = await boot({ dataKey: DATA_KEY });
    const other = randomBytes(32).toString('hex');
    expect(await boot({ dataKey: other })).toEqual(first);
    expect(await boot({ dataKey: other })).toEqual(first);
  });

  it('a sealed row whose secret is gone and no key file: the node refuses to start and the row is untouched', async () => {
    await boot({ dataKey: DATA_KEY });
    const sealed = rawRow()?.privateKey;
    unlinkSync(keyPath);
    await expect(boot()).rejects.toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(rawRow()?.privateKey).toBe(sealed);
  });

  it('a sealed row and an encrypted file, passphrase gone: the node refuses to start and the row is untouched', async () => {
    await boot({ passphrase: PASSPHRASE });
    const sealed = rawRow()?.privateKey;
    await expect(boot()).rejects.toThrow();
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(rawRow()?.privateKey).toBe(sealed);
  });
});

describe('the sealed form', () => {
  it('opens only beside the public key it was sealed with', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const secrets = { dataKeyHex: DATA_KEY };
    const sealed = sealNodePrivateKey(a.privateKey, a.publicKey, secrets);
    expect(openNodePrivateKey(sealed, a.publicKey, secrets)).toBe(a.privateKey);
    expect(() => openNodePrivateKey(sealed, b.publicKey, secrets)).toThrow(NodeKeyLockedError);
  });

  it('a plain key is returned as it is, and never mistaken for the sealed form', async () => {
    const a = await generateKeyPair();
    expect(isSealedNodeKey(a.privateKey)).toBe(false);
    expect(openNodePrivateKey(a.privateKey, a.publicKey, {})).toBe(a.privateKey);
    expect(sealNodePrivateKey(a.privateKey, a.publicKey, {})).toBe(a.privateKey);
  });
});
