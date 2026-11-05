/**
 * @file test/unit/key-reencrypt.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The second data key and the re-encrypt job (services/encryption.ts getEncryptionKey,
 *   services/key-reencrypt/), on SQLite and on PostgreSQL, each over a database of its own.
 *
 *   WHAT THIS PINS (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 *   - A node with one data key: the status reads nothing stored, the job refuses with ONE_DATA_KEY
 *     and writes nothing, and new values have the forms they had before.
 *   - Values sealed under key A (memory records, a person's file store, the secrets vault, a two-step
 *     sign-in secret, a sealed Config row, an extension's settings, a value under the old TOTP key)
 *     all read after key B is added and made current.
 *   - The job moves every one of them to key B. It is stopped after a few batches in the middle of a
 *     source, another process cannot run it while the first holds it, and a restarted process takes
 *     it up from the batch it recorded and finishes it.
 *   - A value that opens with neither key is counted and named by its place, and stays exactly as it
 *     was; the old key is not removable while it is there. Once it is gone, a run reports 0 and the
 *     old key is removable, and with key A removed every value still opens.
 *   - A shared secret's host binding is carried to the name under key B.
 *   - SealedColumnRepository: a swap over a value that changed meanwhile writes nothing, on both
 *     providers, for a text column and a JSON column.
 * @usage
 *   cd aimeat && pnpm exec vitest run test/unit/key-reencrypt.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/key-reencrypt.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { ownNodeDb } from '../helpers/own-node-db.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord, ExtensionRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

requirePostgresWhenAsked('key-reencrypt');

type TestStorage = Storage & { close(): void | Promise<void> };
const hex = (): string => randomBytes(32).toString('hex');
const A = hex();
const B = hex();
const T = hex();
const C = hex();
const PROVIDER_KEYS = 230;   // more than two batches of 100, so a run can stop in the middle of a source

const providers = ['sqlite', 'postgres-kysely'].filter(n => n === 'sqlite' || !!process.env.DATABASE_URL);
const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => { for (const c of cleanups) await c(); });

/** Two storage instances on one fresh database: two processes of one node. */
async function database(provider: string): Promise<{ open(): Promise<TestStorage> }> {
  if (provider === 'sqlite') {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-key-reencrypt-'));
    const file = join(dir, 'node.db');
    const opened: TestStorage[] = [];
    cleanups.push(async () => { for (const s of opened) await s.close(); rmSync(dir, { recursive: true, force: true }); });
    return { async open() { const s = await createStorage({ provider: 'sqlite', sqlitePath: file }) as TestStorage; opened.push(s); return s; } };
  }
  const db = await ownNodeDb('key-reencrypt');
  const opened: TestStorage[] = [];
  cleanups.push(async () => { for (const s of opened) await s.close(); });
  return { async open() { const s = await createStorage({ provider: 'postgres-kysely', dbUrl: db.dbUrl }) as TestStorage; opened.push(s); return s; } };
}

/** One process's view of the code: a fresh module graph, so nothing one process holds in memory is seen by another. */
async function processModules() {
  vi.resetModules();
  return {
    enc: await import('../../src/services/encryption.js'),
    job: await import('../../src/services/key-reencrypt/job.js'),
    lease: await import('../../src/services/process-lease.js'),
    secrets: await import('../../src/services/owner-secrets.js'),
    atRest: await import('../../src/services/config-at-rest.js'),
  };
}

describe.each(providers)('the data key ring and the re-encrypt job on %s', (provider) => {
  const RUN = randomUUID().slice(0, 8);
  const NODE_ID = `keyring-${RUN}`;
  const SYSTEM = `system@${NODE_ID}`;
  const base = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' } as AimeatConfig;
  const oneKey = { ...base, encryptionKey: A, totpSecretEncryptionKey: T, encryptionKey1: null, encryptionKeyCurrent: 0 } as AimeatConfig;
  const twoKeys = (port: number) => ({ ...base, port, encryptionKey: A, totpSecretEncryptionKey: T, encryptionKey1: B, encryptionKeyCurrent: 1 }) as AimeatConfig;
  const EXT = `ext-${RUN}`;

  let db: Awaited<ReturnType<typeof database>>;
  /** Every stored value the test seals, with its place and its plain text. */
  const plain = new Map<string, string>();

  const rec = (owner: string, key: string, value: unknown): MemoryRecord => {
    const now = new Date().toISOString();
    return { key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
  };

  it('a node with one key: the status reads nothing, the job refuses and writes nothing, the forms are as before', async () => {
    db = await database(provider);
    const storage = await db.open();
    const p = await processModules();
    const status = await p.job.reencryptStatus(storage, oneKey);
    expect(status.ring).toEqual({ keys: [0], current: 0 });
    expect(status.job).toBeNull();
    const start = await p.job.startReencrypt(storage, oneKey, `alice@${NODE_ID}`, { run: false });
    expect(start).toMatchObject({ ok: false, status: 409, code: 'ONE_DATA_KEY' });
    expect(await storage.getMemory(SYSTEM, p.job.REENCRYPT_KEY)).toBeNull();
    const key = p.enc.getEncryptionKey(oneKey)!;
    expect(p.enc.encrypt('x', key)).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(p.enc.encryptBound('x', key, 'c')).toMatch(/^v2:[0-9a-f]{24}:/);
  }, 120_000);

  it('values sealed under key A, in every kind of place, all read after key B is added and made current', async () => {
    const storage = await db.open();
    const p = await processModules();
    const a = p.enc.getEncryptionKey(oneKey)!;
    const now = new Date().toISOString();
    for (let i = 0; i < PROVIDER_KEYS; i++) {
      const owner = `p${String(i).padStart(3, '0')}@${NODE_ID}`;
      plain.set(`mem:${owner}:ai.apikey.provider.openai`, `sk-${i}`);
      await storage.setMemory(rec(owner, 'ai.apikey.provider.openai', { encrypted: p.enc.encrypt(`sk-${i}`, a), set_at: now }));
    }
    // A value written under the TOTP key before AIMEAT_ENCRYPTION_KEY was set (the 2026-11-02 fallback).
    plain.set(`mem:alice@${NODE_ID}:openrouter.apikey`, 'sk-totp-era');
    await storage.setMemory(rec(`alice@${NODE_ID}`, 'openrouter.apikey', { encrypted: p.enc.encrypt('sk-totp-era', Buffer.from(T, 'hex')) }));
    // A person's file store: bound to the store's place.
    const { credentialContext } = await import('../../src/services/file-store/owner-file-store.js');
    plain.set('store', '{"secret":"s3"}');
    await storage.setMemory(rec(SYSTEM, 'file-store.owner.alice', {
      spec: 'aimeat.owner-file-stores/v2', owner: 'alice', default: 'main',
      stores: [{ name: 'main', credential: p.enc.encryptBound('{"secret":"s3"}', a, credentialContext('alice', NODE_ID)) }],
    }));
    // The secrets vault, a two-step sign-in secret, a sealed Config row.
    await storage.setSecret({ ownerGaii: `alice@${NODE_ID}`, name: 'API_TOKEN', ciphertext: p.enc.encrypt('tok', a), setAt: now, updatedAt: now, usedBy: {}, hosts: [], hostBinding: null, approvals: [] } as never);
    await storage.createGHII({ username: 'alice', nodeId: NODE_ID, ghii: `alice@${NODE_ID}`, displayName: 'Alice', verificationLevel: 0, ownerName: 'alice', createdAt: now, updatedAt: now } as never);
    await storage.updateGHII(`alice@${NODE_ID}`, { totpSecret: p.enc.encrypt('JBSWY3DPEHPK3PXP', a) } as never);
    await storage.setConfigValue('ai.instance_key', 'sealed:' + p.enc.encryptBound('"node-ai-key"', a, p.atRest.contextOf('ai.instance_key')));
    // An extension's settings, its shared secret map, and the shared value's host binding.
    await storage.createExtension({
      name: EXT, version: '1.0.0', description: 'd', author: 'alice', status: 'active', requiredApis: [], limits: {}, federation: {}, actions: [],
      config: {
        API_KEY: { encrypted: p.enc.encryptBound('ext-key', a, `ext-config:${EXT}:API_KEY`) },
        secrets: { encrypted: p.enc.encryptBound(JSON.stringify({ TOKEN: 'shared-token' }), a, `ext-config:${EXT}:secrets`) },
        __secretKeys: ['API_KEY', 'secrets'],
      },
      active: true, installedBy: 'alice', installedByPrincipal: `alice@${NODE_ID}`, installedAt: now,
    } as unknown as ExtensionRecord);
    await storage.createSecretIfAbsent({
      ownerGaii: p.secrets.sharedBindingOwner(EXT), name: p.secrets.sharedBindingName('TOKEN', 'shared-token', a, NODE_ID),
      ciphertext: '', setAt: now, updatedAt: now, usedBy: {}, hosts: ['api.example'], hostBinding: { how: 'first-use', by: 'alice', extension: EXT, at: now },
    } as never);
    // One value under a key this node never had: it cannot be opened, and must never be lost.
    await storage.setMemory(rec(`bob@${NODE_ID}`, 'ai.apikey.provider.broken', { encrypted: p.enc.encrypt('lost', Buffer.from(C, 'hex')) }));

    // Key B added and current, in a new process.
    const q = await processModules();
    const key = q.enc.getEncryptionKey(twoKeys(1))!;
    expect(key.equals(Buffer.from(B, 'hex'))).toBe(true);
    const mem = await storage.getMemory('p007@' + NODE_ID, 'ai.apikey.provider.openai');
    expect(q.enc.decrypt((mem!.value as { encrypted: string }).encrypted, key)).toBe('sk-7');
    const legacy = await storage.getMemory(`alice@${NODE_ID}`, 'openrouter.apikey');
    expect(q.enc.decrypt((legacy!.value as { encrypted: string }).encrypted, key)).toBe('sk-totp-era');
    expect(q.enc.decrypt((await storage.getSecret(`alice@${NODE_ID}`, 'API_TOKEN'))!.ciphertext, key)).toBe('tok');
    expect(q.atRest.openStoredSetting('ai.instance_key', (await storage.getAllConfigValues())['ai.instance_key'], twoKeys(1))).toBe('"node-ai-key"');
    // A new value is sealed under key 1.
    expect(q.enc.encrypt('new', key)).toMatch(/^v3u:1:/);
  }, 120_000);

  it('the job stops in the middle, a second process cannot run it meanwhile, and a restarted process finishes it', async () => {
    // Process A starts the job and runs five batches: three empty sources and two pages of the AI keys.
    const sa = await db.open();
    const pa = await processModules();
    await pa.lease.startProcessLease(sa, twoKeys(41001));
    const started = await pa.job.startReencrypt(sa, twoKeys(41001), `alice@${NODE_ID}`, { run: false });
    expect(started).toMatchObject({ ok: true, started: true });
    expect(await pa.job.runReencrypt(sa, twoKeys(41001), { maxBatches: 5 })).toBe('paused');
    const mid = (await pa.job.reencryptStatus(sa, twoKeys(41001))).job!;
    expect(mid.state).toBe('running');
    expect(mid.position.after).not.toBeNull();
    expect(mid.counts.moved).toBeGreaterThan(0);
    expect(mid.counts.moved).toBeLessThan(PROVIDER_KEYS);

    // Process B, another port, cannot take the job while A lives and holds it.
    const sb = await db.open();
    const pb = await processModules();
    await pb.lease.startProcessLease(sb, twoKeys(41002));
    expect(await pb.job.runReencrypt(sb, twoKeys(41002))).toBe('not-holder');
    await pb.lease.releaseProcessLease();

    // A stops; a new start of A (same host and port, a new boot) takes the job up and finishes it.
    await pa.lease.releaseProcessLease();
    const sr = await db.open();
    const pr = await processModules();
    await pr.lease.startProcessLease(sr, twoKeys(41001));
    expect(await pr.job.runReencrypt(sr, twoKeys(41001), { resumed: true })).toBe('done');
    await pr.lease.releaseProcessLease();
    const status = await pr.job.reencryptStatus(sr, twoKeys(41001));
    expect(status.job!.state).toBe('done');
    expect(status.job!.resumed).toBe(1);
    expect(status.job!.counts.unreadable).toBe(1);
    expect(status.job!.unreadable_at).toContainEqual({ source: 'AI provider keys', id: ['ai.apikey.provider.broken', `bob@${NODE_ID}`] });
    expect(status.old_key_values).toBe(1);
    expect(status.old_key_removable).toBe(false);

    // Every value is under key 1 now and opens to what was sealed.
    const key = pr.enc.getEncryptionKey(twoKeys(41001))!;
    for (let i = 0; i < PROVIDER_KEYS; i++) {
      const r = await sr.getMemory(`p${String(i).padStart(3, '0')}@${NODE_ID}`, 'ai.apikey.provider.openai');
      const sealed = (r!.value as { encrypted: string }).encrypted;
      expect(sealed).toMatch(/^v3u:1:/);
      expect(pr.enc.decrypt(sealed, key)).toBe(`sk-${i}`);
    }
    const legacy = (await sr.getMemory(`alice@${NODE_ID}`, 'openrouter.apikey'))!.value as { encrypted: string };
    expect(legacy.encrypted).toMatch(/^v3u:1:/);
    expect(pr.enc.decrypt(legacy.encrypted, key)).toBe('sk-totp-era');
    const store = (await sr.getMemory(SYSTEM, 'file-store.owner.alice'))!.value as { stores: Array<{ credential: string }> };
    expect(store.stores[0].credential).toMatch(/^v3:1:/);
    const secret = (await sr.getSecret(`alice@${NODE_ID}`, 'API_TOKEN'))!;
    expect(secret.ciphertext).toMatch(/^v3u:1:/);
    expect(secret.hosts).toEqual([]);
    const ghii = (await sr.getGHII(`alice@${NODE_ID}`))!;
    expect(pr.enc.decrypt(ghii.totpSecret!, key)).toBe('JBSWY3DPEHPK3PXP');
    expect((await sr.getAllConfigValues())['ai.instance_key']).toMatch(/^sealed:v3:1:/);
    const ext = (await sr.getExtension(EXT))!;
    const apiKey = (ext.config as Record<string, { encrypted: string }>).API_KEY.encrypted;
    expect(apiKey).toMatch(/^v3:1:/);
    expect(pr.enc.decryptBound(apiKey, key, `ext-config:${EXT}:API_KEY`)).toBe('ext-key');
    expect((ext.config as Record<string, unknown>).__secretKeys).toEqual(['API_KEY', 'secrets']);
    // The shared value's binding is found under key B's name, with its host.
    const bound = await sr.getSecret(pr.secrets.sharedBindingOwner(EXT), pr.secrets.sharedBindingName('TOKEN', 'shared-token', key, NODE_ID));
    expect(bound?.hosts).toEqual(['api.example']);

    // The unreadable value is exactly as it was.
    const broken = (await sr.getMemory(`bob@${NODE_ID}`, 'ai.apikey.provider.broken'))!;
    expect(broken.version).toBe(1);
    expect(pr.enc.decrypt((broken.value as { encrypted: string }).encrypted, Buffer.from(C, 'hex'))).toBe('lost');
  }, 120_000);

  it('once the unreadable value is dealt with, a run reports 0, and with key A removed every value still opens', async () => {
    const s = await db.open();
    const p = await processModules();
    await s.deleteMemory(`bob@${NODE_ID}`, 'ai.apikey.provider.broken', `bob@${NODE_ID}`);
    await p.lease.startProcessLease(s, twoKeys(41003));
    expect(await p.job.startReencrypt(s, twoKeys(41003), `alice@${NODE_ID}`, { run: false })).toMatchObject({ ok: true, started: true });
    expect(await p.job.runReencrypt(s, twoKeys(41003))).toBe('done');
    await p.lease.releaseProcessLease();
    const status = await p.job.reencryptStatus(s, twoKeys(41003));
    expect(status.job!.counts.moved).toBe(0);
    expect(status.old_key_values).toBe(0);
    expect(status.old_key_removable).toBe(true);

    // Key A removed from the environment: key B is the only key, and everything opens.
    const r = await processModules();
    const onlyB = { ...base, encryptionKey: null, totpSecretEncryptionKey: null, encryptionKey1: B, encryptionKeyCurrent: 1 } as AimeatConfig;
    const key = r.enc.getEncryptionKey(onlyB)!;
    expect((await r.job.reencryptStatus(s, onlyB)).ring).toEqual({ keys: [1], current: 1 });
    const one = (await s.getMemory(`p100@${NODE_ID}`, 'ai.apikey.provider.openai'))!.value as { encrypted: string };
    expect(r.enc.decrypt(one.encrypted, key)).toBe('sk-100');
    expect(r.atRest.openStoredSetting('ai.instance_key', (await s.getAllConfigValues())['ai.instance_key'], onlyB)).toBe('"node-ai-key"');
    expect(r.enc.decrypt((await s.getSecret(`alice@${NODE_ID}`, 'API_TOKEN'))!.ciphertext, key)).toBe('tok');
  }, 120_000);

  it('SealedColumnRepository: a swap over a value that changed meanwhile writes nothing', async () => {
    const s = await db.open();
    const now = new Date().toISOString();
    await s.setSecret({ ownerGaii: `carol@${NODE_ID}`, name: 'X', ciphertext: 'first', setAt: now, updatedAt: now, usedBy: {}, hosts: ['h.example'], hostBinding: null, approvals: [] } as never);
    const rows = await s.listSealedColumn('secret.ciphertext', { limit: 500 });
    const row = rows.find(x => x.id[0] === `carol@${NODE_ID}` && x.id[1] === 'X')!;
    expect(row.value).toBe('first');
    await s.setSecret({ ownerGaii: `carol@${NODE_ID}`, name: 'X', ciphertext: 'second', setAt: now, updatedAt: now, usedBy: {}, hosts: ['g.example'], hostBinding: null, approvals: [] } as never);
    expect(await s.swapSealedColumn('secret.ciphertext', row.id, 'first', 'third')).toBe(false);
    const before = (await s.getSecret(`carol@${NODE_ID}`, 'X'))!;
    expect(before.ciphertext).toBe('second');
    expect(await s.swapSealedColumn('secret.ciphertext', row.id, 'second', 'third')).toBe(true);
    const after = (await s.getSecret(`carol@${NODE_ID}`, 'X'))!;
    expect(after.ciphertext).toBe('third');
    // Nothing else in the row changes.
    expect({ ...after, ciphertext: 'second' }).toEqual(before);

    const [ext] = (await s.listSealedColumn('extension.config', { limit: 500 })).filter(x => x.id[0] === EXT);
    const changed = { ...(ext.value as Record<string, unknown>), note: 'written meanwhile' };
    expect(await s.swapSealedColumn('extension.config', ext.id, { stale: true }, changed)).toBe(false);
    expect(await s.swapSealedColumn('extension.config', ext.id, ext.value, changed)).toBe(true);
    expect(((await s.getExtension(EXT))!.config as Record<string, unknown>).note).toBe('written meanwhile');

    // Pages in id order, resumed after the last id.
    const first = await s.listSealedColumn('memory', { prefix: 'ai.apikey.', limit: 10 });
    const second = await s.listSealedColumn('memory', { prefix: 'ai.apikey.', limit: 10, after: first[first.length - 1].id });
    expect(first).toHaveLength(10);
    expect(second[0].id).not.toEqual(first[9].id);
    expect(second[0].id[0] >= first[9].id[0]).toBe(true);
  }, 60_000);
});
