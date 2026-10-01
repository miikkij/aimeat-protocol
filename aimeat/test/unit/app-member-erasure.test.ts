/**
 * @file test/unit/app-member-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an account takes its app-roster records with it, through eraseOwner
 *   (services/owner-erasure.ts), the whole of DELETE /v1/owners/:name below HTTP. The roster rows
 *   are keyed by the bare account name and an erased name is released for reuse, so a row that
 *   survives is inherited by the next person to register the name.
 *   - What the erased person HELD on other people's apps goes: the member row (with a development
 *     right on it), the request, the visit, a row already in the bin, and a blanket development right.
 *   - The whole roster of the apps the erased person OWNED goes: other people's member rows,
 *     requests and visits, the carry plan, and the blanket rights the person gave.
 *   - Everything else stays: another member of the same app, a member whose name starts with the
 *     erased name (`bobby`), the other owner's carry plan and blanket rights.
 *   Runs on SQLite in memory, and on Postgres too when DATABASE_URL is set (names carry a run tag there).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-member-erasure.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial: erasure left app-membership records behind for a reused name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import {
  getCarryPlan, getMemberRow, listRequests, listVisits, noteVisit, putCarryPlan, putMember, putRequest, removeMember,
} from '../../src/services/app-members.js';
import { getBlanketLevel, putBlanketGrant, putDevGrant } from '../../src/services/app-dev-grant.js';

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

describe.each(names)('%s: erasing an account takes its app-roster records', provider => {
  it('deletes what the person held and the roster of what they owned; leaves the rest', async () => {
    const s = providers.get(provider)!;
    const tag = provider === 'sqlite' ? '' : `-${randomUUID().slice(0, 8)}`;
    const bob = `bob${tag}`, alice = `alice${tag}`, carol = `carol${tag}`, bobby = `bobby${tag}`;
    const club = `${alice}/club.html`, other = `${alice}/other.html`, own = `${bob}/own.html`;
    for (const name of [alice, bob, carol, bobby]) {
      await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
      await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
        verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    }

    // What bob holds on alice's apps.
    await putMember(s, { appId: club, account: bob, role: 'member', approvedBy: alice });
    await putDevGrant(s, { appId: club, account: bob, level: 0, grantedBy: alice });
    await putRequest(s, { appId: club, account: bob, note: 'let me in' });
    await noteVisit(s, club, bob);
    await putMember(s, { appId: other, account: bob, role: 'member', approvedBy: alice });
    await removeMember(s, other, bob); // into the bin, restorable by key until the sweeper runs
    await putBlanketGrant(s, { owner: alice, grantee: bob, level: 10, grantedBy: alice });
    // The roster of bob's own app.
    await putMember(s, { appId: own, account: carol, role: 'member', approvedBy: bob });
    await putRequest(s, { appId: own, account: carol, note: 'me too' });
    await noteVisit(s, own, carol);
    await putCarryPlan(s, { appId: own, roles: { member: ['offer-1'] }, setBy: bob });
    await putBlanketGrant(s, { owner: bob, grantee: carol, level: 20, grantedBy: bob });
    // What must stay.
    await putMember(s, { appId: club, account: carol, role: 'member', approvedBy: alice });
    await putMember(s, { appId: club, account: bobby, role: 'member', approvedBy: alice });
    await putRequest(s, { appId: club, account: bobby, note: 'bobby asks' });
    await noteVisit(s, club, bobby);
    await putCarryPlan(s, { appId: club, roles: { member: [] }, setBy: alice });
    await putBlanketGrant(s, { owner: alice, grantee: carol, level: 20, grantedBy: alice });

    const binned = async () => (await s.listAllDeletedMemory({ ownerPrefix: 'app-member', prefix: 'appmember.' })).items
      .filter(r => r.ownerGaii === 'app-member' && r.key.endsWith(`.${bob}`));

    // NEGATIVE CONTROL: everything is reachable before the erasure.
    expect((await getMemberRow(s, club, bob))?.dev).toBe(0);
    expect((await listRequests(s, club, 'all')).map(r => r.owner)).toContain(bob);
    expect((await listVisits(s, club)).map(v => v.owner)).toContain(bob);
    expect(await binned()).toHaveLength(1);
    const binKey = (await binned())[0].key;
    expect(await getBlanketLevel(s, alice, bob)).toBe(10);
    expect(await getMemberRow(s, own, carol)).not.toBeNull();
    expect(await listRequests(s, own, 'all')).toHaveLength(1);
    expect(await listVisits(s, own)).toHaveLength(1);
    expect(await getCarryPlan(s, own)).not.toBeNull();
    expect(await getBlanketLevel(s, bob, carol)).toBe(20);

    try {
      const { deletionLog } = await eraseOwner(s, NODE, bob);

      // (a) What bob held on alice's apps.
      expect(await getMemberRow(s, club, bob)).toBeNull();
      expect((await listRequests(s, club, 'all')).map(r => r.owner)).not.toContain(bob);
      expect((await listVisits(s, club)).map(v => v.owner)).not.toContain(bob);
      expect(await binned()).toEqual([]);
      expect(await s.restoreMemory('app-member', binKey)).toBe(false);
      expect(await getBlanketLevel(s, alice, bob)).toBeNull();
      // (b) The roster of bob's own app.
      expect(await getMemberRow(s, own, carol)).toBeNull();
      expect(await listRequests(s, own, 'all')).toEqual([]);
      expect(await listVisits(s, own)).toEqual([]);
      expect(await getCarryPlan(s, own)).toBeNull();
      expect(await getBlanketLevel(s, bob, carol)).toBeNull();
      // 2 member rows (one live, one in the bin) + 1 request + 1 visit + 1 blanket right of bob's;
      // 1 member row + 1 request + 1 visit + 1 plan + 1 blanket right of bob's app/apps.
      expect(deletionLog).toContain('app_membership:10');

      // POSITIVE CONTROL: the rest of alice's roster.
      expect((await getMemberRow(s, club, carol))?.owner).toBe(carol);
      expect((await getMemberRow(s, club, bobby))?.owner).toBe(bobby);
      expect((await listRequests(s, club, 'all')).map(r => r.owner)).toEqual([bobby]);
      expect((await listVisits(s, club)).map(v => v.owner)).toEqual([bobby]);
      expect(await getCarryPlan(s, club)).not.toBeNull();
      expect(await getBlanketLevel(s, alice, carol)).toBe(20);
    } finally {
      for (const name of [alice, carol, bobby, bob]) await eraseOwner(s, NODE, name);
    }
  }, 60_000);
});
