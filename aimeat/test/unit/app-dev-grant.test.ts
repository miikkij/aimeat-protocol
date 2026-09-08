/**
 * @file app-dev-grant.test.ts
 * @description The development right an app owner can give somebody else, tested against a real
 *   in-memory store rather than a stub: the ladder and what each rung carries, both grant records,
 *   which of the two wins, and the seam that turns all of it into "whose bucket does this land in".
 *
 *   Two of these are regression guards rather than feature tests, and they are the reason this file
 *   exists at all. `putMember` writes the whole roster row, so an owner changing somebody's ROLE
 *   would silently drop a development right granted at a different door — the field-dropped-on-update
 *   bug this repo has met on the publish path more than once. And `resolveAppTarget` must leave the
 *   caller's own name exactly as the door handed it over, because owner names are matched EXACTLY in
 *   both storage providers and lowercasing one would address a bucket that is not theirs.
 * @usage cd aimeat && pnpm vitest run test/unit/app-dev-grant.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-08 — initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { GHIIRecord, Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { putMember, getMemberRow } from '../../src/services/app-members.js';
import {
  APP_DEV_LEVELS, actsFor, mayAct, levelName, parseDevLevel,
  putDevGrant, getDevGrant, removeDevGrant, listDevGrants,
  putBlanketGrant, listBlanketGrants, removeBlanketGrant,
  effectiveDevLevel, resolveAppTarget, ownAppScope,
} from '../../src/services/app-dev-grant.js';

const NODE = 'node-x';
const config = { nodeId: NODE } as AimeatConfig;

function ghiiRow(ownerName: string): GHIIRecord {
  const now = new Date().toISOString();
  return {
    username: ownerName, nodeId: NODE, ghii: `${ownerName}@${NODE}`, displayName: ownerName,
    verificationLevel: 0, ownerName, createdAt: now, updatedAt: now, totpEnabled: false,
  };
}

async function store(...owners: string[]): Promise<Storage> {
  const storage = new SqliteStorage(':memory:');
  for (const o of owners) await storage.createGHII(ghiiRow(o));
  return storage;
}

const APP = 'alice/paja.html';

describe('the ladder', () => {
  it('full carries everything a delegate can do', () => {
    expect(actsFor(APP_DEV_LEVELS.full)).toEqual(['draft', 'publish', 'presentation', 'operate']);
  });

  it('publisher ships it but touches nothing commercial or legal', () => {
    expect(mayAct(APP_DEV_LEVELS.publisher, 'publish')).toBe(true);
    expect(mayAct(APP_DEV_LEVELS.publisher, 'presentation')).toBe(true);
    expect(mayAct(APP_DEV_LEVELS.publisher, 'operate')).toBe(false);
  });

  it('drafter writes the draft and cannot publish it', () => {
    expect(mayAct(APP_DEV_LEVELS.drafter, 'draft')).toBe(true);
    expect(mayAct(APP_DEV_LEVELS.drafter, 'publish')).toBe(false);
  });

  it('no rung at all carries anything', () => {
    expect(mayAct(null, 'draft')).toBe(false);
    expect(mayAct(undefined, 'publish')).toBe(false);
    // A number nobody granted is not a rung, and an unknown rung carries nothing rather than
    // everything: the failure mode of a lookup miss has to be refusal.
    expect(mayAct(5, 'draft')).toBe(false);
    expect(actsFor(5)).toEqual([]);
  });

  it('reads a level by name or by number, and refuses anything else', () => {
    expect(parseDevLevel('full')).toBe(0);
    expect(parseDevLevel('publisher')).toBe(10);
    expect(parseDevLevel(20)).toBe(20);
    expect(parseDevLevel('20')).toBe(20);
    expect(parseDevLevel(5)).toBeNull();
    expect(parseDevLevel('owner')).toBeNull();
    expect(parseDevLevel(undefined)).toBeNull();
    expect(levelName(0)).toBe('full');
  });
});

describe('the right on one app', () => {
  it('is given, read back, and taken away', async () => {
    const storage = await store('alice', 'bob');
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.publisher, grantedBy: 'alice@node-x' });
    expect(await getDevGrant(storage, APP, 'bob')).toBe(APP_DEV_LEVELS.publisher);

    expect(await removeDevGrant(storage, APP, 'bob')).toBe(true);
    expect(await getDevGrant(storage, APP, 'bob')).toBeNull();
    // Twice is not an error, and the second time says there was nothing to take.
    expect(await removeDevGrant(storage, APP, 'bob')).toBe(false);
  });

  it('covers every agent of the person it was given to', async () => {
    const storage = await store('alice', 'bob');
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    expect(await getDevGrant(storage, APP, 'claude#bob@node-x')).toBe(APP_DEV_LEVELS.full);
    expect(await getDevGrant(storage, APP, 'BOB@node-x')).toBe(APP_DEV_LEVELS.full);
  });

  it('leaves the membership behind when the right is withdrawn', async () => {
    const storage = await store('alice', 'bob');
    await putMember(storage, { appId: APP, account: 'bob', role: 'subscriber', approvedBy: 'alice@node-x' });
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });

    await removeDevGrant(storage, APP, 'bob');
    const row = await getMemberRow(storage, APP, 'bob');
    // Somebody can pay for an app they no longer help build. Taking the right must not take the
    // access with it.
    expect(row?.role).toBe('subscriber');
    expect(row?.dev).toBeUndefined();
  });

  it('survives a role change made at the roster door', async () => {
    const storage = await store('alice', 'bob');
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    // The roster knows nothing about development rights. If it dropped the field here, an owner
    // promoting a co-builder to "editor" would revoke their ability to build, in silence.
    await putMember(storage, { appId: APP, account: 'bob', role: 'editor', approvedBy: 'alice@node-x' });
    expect(await getDevGrant(storage, APP, 'bob')).toBe(APP_DEV_LEVELS.full);
  });

  it('lapses with the membership that carries it', async () => {
    const storage = await store('alice', 'bob');
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    await putMember(storage, {
      appId: APP, account: 'bob', role: 'trial', approvedBy: 'alice@node-x',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await getDevGrant(storage, APP, 'bob')).toBeNull();
    expect(await listDevGrants(storage, APP)).toEqual([]);
  });

  it('lists who may build the app, most powerful first', async () => {
    const storage = await store('alice', 'bob', 'carol');
    await putDevGrant(storage, { appId: APP, account: 'carol', level: APP_DEV_LEVELS.drafter, grantedBy: 'alice@node-x' });
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    await putMember(storage, { appId: APP, account: 'dave', role: 'subscriber', approvedBy: 'alice@node-x' });

    const grants = await listDevGrants(storage, APP);
    // An ordinary member is not a builder and does not appear.
    expect(grants.map(g => g.account)).toEqual(['bob', 'carol']);
    expect(grants[0].level).toBe(APP_DEV_LEVELS.full);
  });
});

describe('the right across all of an owner\'s apps', () => {
  it('is one record, listed and withdrawn in one place', async () => {
    const storage = await store('alice', 'bob');
    await putBlanketGrant(storage, { owner: 'alice', grantee: 'bob', level: APP_DEV_LEVELS.publisher, grantedBy: 'alice@node-x' });
    const list = await listBlanketGrants(storage, 'alice');
    expect(list.map(g => g.grantee)).toEqual(['bob']);

    expect(await removeBlanketGrant(storage, 'alice', 'bob')).toBe(true);
    expect(await listBlanketGrants(storage, 'alice')).toEqual([]);
  });

  it('stops counting the moment its term runs out', async () => {
    const storage = await store('alice', 'bob');
    await putBlanketGrant(storage, {
      owner: 'alice', grantee: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await listBlanketGrants(storage, 'alice')).toEqual([]);
    expect(await effectiveDevLevel(storage, { owner: 'alice', principal: 'bob' })).toBeNull();
  });

  it('answers for an app that has no roster row of its own', async () => {
    const storage = await store('alice', 'bob');
    await putBlanketGrant(storage, { owner: 'alice', grantee: 'bob', level: APP_DEV_LEVELS.drafter, grantedBy: 'alice@node-x' });
    expect(await effectiveDevLevel(storage, { owner: 'alice', filename: 'paja.html', principal: 'bob' }))
      .toEqual({ level: APP_DEV_LEVELS.drafter, via: 'all' });
  });
});

describe('which right applies', () => {
  it('lets the app\'s own row open one app wider than the rest', async () => {
    const storage = await store('alice', 'bob');
    await putBlanketGrant(storage, { owner: 'alice', grantee: 'bob', level: APP_DEV_LEVELS.drafter, grantedBy: 'alice@node-x' });
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    expect(await effectiveDevLevel(storage, { owner: 'alice', filename: 'paja.html', principal: 'bob' }))
      .toEqual({ level: APP_DEV_LEVELS.full, via: 'app' });
  });

  it('and lets it narrow one without withdrawing everything', async () => {
    const storage = await store('alice', 'bob');
    await putBlanketGrant(storage, { owner: 'alice', grantee: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.drafter, grantedBy: 'alice@node-x' });
    // The specific one wins in BOTH directions. A blanket grant is the fallback, never a floor.
    expect(await effectiveDevLevel(storage, { owner: 'alice', filename: 'paja.html', principal: 'bob' }))
      .toEqual({ level: APP_DEV_LEVELS.drafter, via: 'app' });
  });
});

describe('the seam', () => {
  it('gives a caller their own bucket when no other owner is named', async () => {
    const storage = await store('alice');
    const t = await resolveAppTarget(storage, config, { callerOwner: 'alice', act: 'publish' });
    expect(t).toEqual({ ok: true, ownerName: 'alice', ownerGhii: `alice@${NODE}`, delegated: null });
  });

  it('leaves the caller\'s own capitals alone', async () => {
    // Both storage providers match ownerName EXACTLY. An owner registered as `Alice` who got
    // lowercased here would be handed a bucket that is not hers, and the apps in it would vanish.
    const storage = await store('Alice');
    const t = await resolveAppTarget(storage, config, { callerOwner: 'Alice', act: 'draft' });
    expect(t.ok && t.ownerName).toBe('Alice');
    expect(t.ok && t.ownerGhii).toBe(`Alice@${NODE}`);
  });

  it('treats a differently-spelled version of your own name as your own app', async () => {
    const storage = await store('alice');
    const t = await resolveAppTarget(storage, config, { callerOwner: 'alice', requestedOwner: 'ALICE', act: 'operate' });
    expect(t.ok && t.delegated).toBeNull();
  });

  it('refuses a name nobody answers to', async () => {
    const storage = await store('alice');
    const t = await resolveAppTarget(storage, config, { callerOwner: 'alice', requestedOwner: 'nobody', act: 'draft' });
    expect(t.ok).toBe(false);
    expect(!t.ok && t.status).toBe(404);
  });

  it('refuses somebody else\'s app with no grant on it', async () => {
    const storage = await store('alice', 'bob');
    const t = await resolveAppTarget(storage, config, {
      callerOwner: 'bob', requestedOwner: 'alice', filename: 'paja.html', act: 'draft',
    });
    expect(t.ok).toBe(false);
    expect(!t.ok && t.status).toBe(403);
  });

  it('refuses an act the granted rung does not carry, and says what it does', async () => {
    const storage = await store('alice', 'bob');
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.drafter, grantedBy: 'alice@node-x' });
    const t = await resolveAppTarget(storage, config, {
      callerOwner: 'bob', requestedOwner: 'alice', filename: 'paja.html', act: 'publish',
    });
    expect(t.ok).toBe(false);
    expect(!t.ok && t.status).toBe(403);
    expect(!t.ok && t.message).toContain('drafter');
  });

  it('hands over the owner\'s bucket when the rung carries the act', async () => {
    const storage = await store('alice', 'bob');
    await putDevGrant(storage, { appId: APP, account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'alice@node-x' });
    const t = await resolveAppTarget(storage, config, {
      callerOwner: 'bob', requestedOwner: 'alice', filename: 'paja.html', act: 'operate',
    });
    expect(t).toEqual({
      ok: true, ownerName: 'alice', ownerGhii: `alice@${NODE}`,
      delegated: { level: APP_DEV_LEVELS.full, via: 'app' },
    });
  });

  it('reads the owner\'s own spelling from the identity record, not from the request', async () => {
    const storage = await store('Alice', 'bob');
    await putDevGrant(storage, { appId: 'Alice/paja.html', account: 'bob', level: APP_DEV_LEVELS.full, grantedBy: 'Alice@node-x' });
    const t = await resolveAppTarget(storage, config, {
      callerOwner: 'bob', requestedOwner: 'Alice', filename: 'paja.html', act: 'publish',
    });
    expect(t.ok && t.ownerName).toBe('Alice');
  });

  it('refuses a caller with no owner at all', async () => {
    const storage = await store('alice');
    const t = await resolveAppTarget(storage, config, { callerOwner: '', act: 'draft' });
    expect(t.ok).toBe(false);
    expect(!t.ok && t.status).toBe(400);
  });
});

describe('the caller\'s own scope', () => {
  it('resolves through the identity record when there is one', async () => {
    const storage = await store('alice');
    expect(await ownAppScope(storage, config, 'alice')).toEqual({ ownerName: 'alice', ownerGhii: `alice@${NODE}` });
  });

  it('falls back to owner@node when there is not', async () => {
    const storage = await store();
    expect(await ownAppScope(storage, config, 'ghost')).toEqual({ ownerName: 'ghost', ownerGhii: `ghost@${NODE}` });
  });
});
