/**
 * @file test/unit/erasure-test-kit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the erasure unit files share: a real storage of each provider, two accounts with
 *   agents, and a way to hold one storage call open while an account erasure (eraseOwner) runs. A
 *   buffer or a queue that took a row of the account before the erasure must not store it after.
 *   Used by test/unit/erasure-write-buffers.test.ts and test/unit/erasure-queues.test.ts.
 * @usage
 *   const { names, storageOf } = twoProviders(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])]);
 *   const p = await people(s);
 *   const held = holdFirst(s, 'setMemory', 'before', a => String((a[0] as { key: string }).key).startsWith('x.'));
 *   await eraseDuring(s, p, held, flushSomething());
 * @version-history
 *   v1.0.0 — 2026-11-14 — Moved out of erasure-write-buffers.test.ts, with a call filter for holdFirst.
 */
import { afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';

export type TestStorage = Storage & { close(): void | Promise<void> };

/**
 * A storage of each provider the file names, opened before its tests and closed after. The file
 * names them itself (`['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])]`), because
 * the PostgreSQL unit run picks the files that read DATABASE_URL (scripts/lib/postgres-unit-files.ts).
 */
export function twoProviders(names: string[]): { names: string[]; storageOf: (name: string) => TestStorage } {
  const providers = new Map<string, TestStorage>();
  beforeAll(async () => {
    for (const name of names) providers.set(name, await createStorage({
      provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
      sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage);
  }, 60_000);
  afterAll(async () => { for (const s of providers.values()) await s.close(); });
  return { names, storageOf: name => providers.get(name)! };
}

export const NODE = 'erasure-buffers';
export const now = (): string => new Date().toISOString();

export interface People { alice: string; bob: string; aliceGhii: string; bobGhii: string; star: string; scout: string }

/** Two accounts; alice has an agent holding `*` and one holding memory:read only. */
export async function people(s: Storage): Promise<People> {
  const tag = randomUUID().slice(0, 8);
  const alice = `alice${tag}`, bob = `bob${tag}`;
  const at = now();
  for (const name of [alice, bob]) {
    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at });
    await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
      verificationLevel: 0, totpEnabled: false, createdAt: at, updatedAt: at });
  }
  const aliceGhii = `${alice}@${NODE}`;
  const star = `star#${aliceGhii}`, scout = `scout#${aliceGhii}`;
  for (const [gaii, scopes] of [[star, ['*']], [scout, ['memory:read']]] as const) {
    await s.createAgent({
      name: gaii.split('#')[0], owner: alice, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0, capabilities: [],
      defaultScopes: [...scopes], createdAt: at, lastSeen: at,
    } as never);
  }
  return { alice, bob, aliceGhii, bobGhii: `${bob}@${NODE}`, star, scout };
}

export interface Held { began: Promise<void>; release: () => void; restore: () => void }

/**
 * Hold the first call of `method` on `target` that `match` accepts (any call when it is omitted):
 * `began` resolves when it has started, and it answers only after `release()`. A write is held before
 * it reaches storage (`before`); a read that decides a later write is held after it has read
 * (`after`), so the write follows the erasure with what was read before it. Every other call goes
 * straight through.
 */
export function holdFirst<T extends object>(
  target: T, method: keyof T & string, when: 'before' | 'after' = 'before', match: (args: unknown[]) => boolean = () => true,
): Held {
  const real = (target[method] as unknown as (...a: unknown[]) => unknown).bind(target);
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>(r => { started = r; });
  const released = new Promise<void>(r => { release = r; });
  let first = true;
  (target as Record<string, unknown>)[method] = async (...args: unknown[]) => {
    if (!first || !match(args)) return real(...args);
    first = false;
    if (when === 'before') { started(); await released; return real(...args); }
    const answer = await real(...args);
    started();
    await released;
    return answer;
  };
  return { began, release, restore: () => { delete (target as Record<string, unknown>)[method]; } };
}

/** Let `work` run until it has finished or has nothing left to do but wait. */
export async function settledOrWaiting(work: Promise<unknown>): Promise<void> {
  let done = false;
  void work.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 30 && !done; i++) await new Promise(r => setTimeout(r, 20));
}

/** Erase alice while `held` holds a call open, then release it and wait for both. */
export async function eraseDuring(s: Storage, p: People, held: { began: Promise<void>; release: () => void }, write: Promise<unknown>): Promise<void> {
  await held.began;
  const erased = eraseOwner(s, NODE, p.alice);
  await settledOrWaiting(erased);
  held.release();
  await Promise.all([write, erased]);
}

export async function until(cond: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (await cond()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${what}`);
}
