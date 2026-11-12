/**
 * @file test/unit/join-request-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an account takes its join requests with it (services/owner-erasure.ts, step
 *   join_requests). A request names its person by the account name, so an open request left behind
 *   would make the next holder of the released name a member the moment an owner approved it. Every
 *   request the erased account made goes, open or decided, on both backends; another person's
 *   request stays, and loses only the erased account's name as its reviewer.
 *
 *   FAIL FIRST, 2026-11-12: with the join_requests step removed from eraseOwner, the first
 *   expectation after the erasure is red (bob's two requests are still listed); restored.
 * @usage pnpm exec vitest run test/unit/join-request-erasure.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, JoinRequestRecord } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';

requirePostgresWhenAsked('join-request-erasure');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const NODE = 'erasure-test';
const now = new Date().toISOString();

describe.each(names)('%s: erasing an account takes its join requests', provider => {
  it('deletes the requests the person made, keeps other people\'s, and takes the name off as reviewer', async () => {
    const s = providers.get(provider)!;
    const tag = randomUUID().slice(0, 8);
    const bob = `bob-${tag}`, alice = `alice-${tag}`, carol = `carol-${tag}`;
    const org = `org-${tag}`;
    for (const name of [alice, bob, carol]) {
      await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
      await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
        verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    }
    const request = (id: string, ghii: string, extra: Partial<JoinRequestRecord> = {}): JoinRequestRecord =>
      ({ id: `${id}-${tag}`, organismId: org, ghii, status: 'pending', createdAt: now, ...extra });
    // bob asked twice: once by the account name with a source and a message, once under the GHII.
    await s.createJoinRequest(request('open', bob, { message: 'let me in', via: { kind: 'app', ref: `${alice}/tool.html`, label: 'Tool' } }));
    await s.createJoinRequest(request('old', `${bob}@${NODE}`, { status: 'rejected', reviewedBy: alice, reviewedAt: now }));
    // carol's request, which bob decided as an admin.
    await s.createJoinRequest(request('carol', carol, { status: 'approved', reviewedBy: bob, reviewedAt: now }));

    // NEGATIVE CONTROL: all three are there, and the source reads back.
    const before = await s.listJoinRequests(org);
    expect(before.map(r => r.id).sort()).toEqual([`carol-${tag}`, `old-${tag}`, `open-${tag}`]);
    expect(before.find(r => r.id === `open-${tag}`)?.via).toEqual({ kind: 'app', ref: `${alice}/tool.html`, label: 'Tool' });

    const { deletionLog } = await eraseOwner(s, NODE, bob);

    const after = await s.listJoinRequests(org);
    expect(after.map(r => r.id)).toEqual([`carol-${tag}`]);
    expect(after[0].status).toBe('approved');
    expect(after[0].reviewedBy).toBeUndefined();
    expect(deletionLog.some(line => line.includes('join_requests:2'))).toBe(true);
  });
});
