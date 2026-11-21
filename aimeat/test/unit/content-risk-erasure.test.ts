/**
 * @file test/unit/content-risk-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An account erasure and the content risk marks (services/content/risk-erasure.ts): an
 *   entry in another person's risk record that names the erased person as its writer, as who released
 *   its hold or as who accepted its marks gets the erasure's pseudonym, and an entry that names someone
 *   else is left as it is. On a real SQLite storage.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { eraseContentRiskOf } from '../../src/services/content/risk-erasure.js';
import { personRiskKey } from '../../src/services/content/risk-keys.js';

const SQLITE_PATH = `./test/.riskerase-${process.pid}.db`;
const NODE = 'aimeat-risk-erase';
const ALICE = `alice@${NODE}`;
const BOB = `bob@${NODE}`;
let storage: Storage;

const entry = (extra: Record<string, unknown>) => ({
  v: 1, contentHash: 'sha256:00', detect: 'rules', point: 'shared-write', at: '2026-11-21T00:00:00.000Z', marks: [], kinds: [], ...extra,
});

beforeAll(async () => {
  storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
}, 60_000);

afterAll(async () => {
  await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
  }
});

describe('content risk erasure', () => {
  it('renames the writer, the hold\'s decider and the acceptor, and leaves another person\'s name', async () => {
    const now = new Date().toISOString();
    await storage.setMemory({
      key: personRiskKey, ownerGaii: BOB, visibility: 'private', tags: ['contentrisk'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      value: { v: 1, items: {
        'dm:1': entry({ writtenBy: ALICE }),
        'dm:2': entry({ hold: { status: 'released', since: now, decidedBy: ALICE } }),
        'dm:3': entry({ accepted: { fps: ['ab'], by: `claude#${ALICE}`, at: now } }),
        'dm:4': entry({ writtenBy: `carol@${NODE}`, accepted: { fps: ['cd'], by: BOB, at: now } }),
      } },
    } as never);
    const renamed = await eraseContentRiskOf(storage, NODE, 'alice', [ALICE, 'alice', `claude#${ALICE}`], 'erased-1');
    expect(renamed).toBe(3);
    const items = ((await storage.getMemory(BOB, personRiskKey))?.value as { items: Record<string, Record<string, any>> }).items;
    expect(items['dm:1'].writtenBy).toBe('erased-1');
    expect(items['dm:2'].hold.decidedBy).toBe('erased-1');
    expect(items['dm:3'].accepted.by).toBe('erased-1');
    expect(items['dm:3'].accepted.fps).toEqual(['ab']);
    expect(items['dm:4'].writtenBy).toBe(`carol@${NODE}`);
    expect(items['dm:4'].accepted.by).toBe(BOB);
  });
});
