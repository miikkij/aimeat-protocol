/**
 * @file app-collaboration-audit.test.ts
 * @description Regression checks for the shared-app audit, using real SQLite records.
 * @version-history
 *   v1.0.1 - 2026-09-09 - The 5001-row case gets a 30 s ceiling; it timed out under gate load.
 *   v1.0.0 - 2026-09-08 - Fail first for identity collisions and lost roadmap writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { getDevGrant, putDevGrant, putBlanketGrant, listRightsHeldBy, listAppsBuiltFor } from '../../src/services/app-dev-grant.js';
import type { AimeatConfig } from '../../src/config.js';
import { sameApp, putMember, getMemberRow, removeMember, writePrivateRecord, memberKey, listMembers } from '../../src/services/app-members.js';
import { addRoadmapEntry, readAppRoadmap, removeRoadmapEntry, setWantedVisibility, appRoadmapKey, APP_ROADMAP_SPEC, APP_ROADMAP_MAX } from '../../src/services/app-roadmap.js';

const stores: SqliteStorage[] = [];
function store() { const s = new SqliteStorage(':memory:'); stores.push(s); return s; }
afterEach(async () => { for (const s of stores.splice(0)) s.close(); });

describe('shared-app audit regressions', () => {
  it('finds rights beyond 5000 roster rows', async () => {
    const s = store();
    await s.transaction(async () => {
      for (let i = 0; i < 5001; i++) {
        await putDevGrant(s, { appId: `alice/app-${i}.html`, account: 'bob', level: 10, grantedBy: 'alice' });
      }
    });
    const held = await listRightsHeldBy(s, 'bob');
    expect(held.apps).toHaveLength(5001);
    expect(new Set(held.apps.map(a => a.appId)).size).toBe(5001);
  // 5001 grants written one at a time is a correctness fixture, not a speed one: alone it takes
  // about a second, and under vitest's parallel load in `pnpm gate` it crossed the default 5 s
  // twice on 2026-09-09. The ceiling is about the assertion, not the clock.
  }, 30_000);
  it('lists every blanket app beyond 200 and preserves narrower per-app rights', async () => {
    const s = store();
    await s.transaction(async () => {
      for (let i = 0; i < 205; i++) {
        await s.createApp({
          ownerGaii: 'alice@node-test', ownerName: 'alice', filename: `app-${i}.html`, versionNumber: 1,
          manifest: { name: `App ${i}`, description: 'Scale fixture', version: '1', category: 'tool', tags: [], authorDisplay: 'alice', usesCortex: [] },
          mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: new Date().toISOString(),
        });
      }
    });
    await putBlanketGrant(s, { owner: 'alice', grantee: 'bob', level: 0, grantedBy: 'alice' });
    await putDevGrant(s, { appId: 'alice/app-0.html', account: 'bob', level: 20, grantedBy: 'alice' });
    const apps = await listAppsBuiltFor(s, { nodeId: 'node-test' } as AimeatConfig, { principal: 'bob' });
    expect(apps).toHaveLength(205);
    expect(apps.find(a => a.filename === 'app-0.html')?.devLevel).toBe(20);
    expect(apps.find(a => a.filename === 'app-204.html')?.devLevel).toBe(0);
  });
  it('preserves concurrent removal, visibility changes and additions', async () => {
    const s = store(), appId = 'alice/app.html';
    const first = await addRoadmapEntry(s, { appId, state: 'wanted', what: 'Withdraw this', by: 'alice' });
    await Promise.all([
      removeRoadmapEntry(s, appId, first.entries[0]!.id),
      setWantedVisibility(s, appId, 'everyone'),
      addRoadmapEntry(s, { appId, state: 'done', what: 'Keep this change', by: 'bob' }),
    ]);
    const road = await readAppRoadmap(s, appId);
    expect(road?.wantedVisibility).toBe('everyone');
    expect(road?.entries.map(e => e.what)).toEqual(['Keep this change']);
  });
  it('migrates a verified legacy grant and never resurrects it after revocation', async () => {
    const s = store();
    const appId = 'alice/a.b.html';
    await writePrivateRecord(s, 'app-member', 'appmember.alice-a-b-html.bob', {
      appId, owner: 'bob', role: 'reader', dev: 10, since: new Date().toISOString(),
    });
    expect(await getDevGrant(s, 'alice/a-b.html', 'bob')).toBeNull();
    expect(await getDevGrant(s, appId, 'bob')).toBe(10);
    expect(await s.getMemory('app-member', memberKey(appId, 'bob'))).not.toBeNull();
    expect(await s.getMemory('app-member', 'appmember.alice-a-b-html.bob')).toBeNull();
    await removeMember(s, appId, 'bob');
    expect(await getDevGrant(s, appId, 'bob')).toBeNull();
  });
  it('pins roster lists to the platform namespace', async () => {
    const s = store();
    await writePrivateRecord(s, 'mallory@node-x', memberKey('alice/app.html', 'mallory'), {
      appId: 'alice/app.html', owner: 'mallory', dev: 0,
    });
    expect(await listMembers(s, 'alice/app.html')).toEqual([]);
  });
  it('migrates only the roadmap whose stored identity matches', async () => {
    const s = store();
    await writePrivateRecord(s, 'app-roadmap', 'approadmap.alice-a-b-html', {
      spec: APP_ROADMAP_SPEC, appId: 'alice/a.b.html', entries: [], wantedVisibility: 'developers',
    });
    expect(await readAppRoadmap(s, 'alice/a-b.html')).toBeNull();
    expect((await readAppRoadmap(s, 'alice/a.b.html'))?.appId).toBe('alice/a.b.html');
  });
  it('bounds wishes separately without evicting completed changes', async () => {
    const s = store(), appId = 'alice/app.html';
    const entries = Array.from({ length: APP_ROADMAP_MAX }, (_, i) => ({
      id: String(i), state: 'wanted', what: 'Keep this wish', by: 'alice', at: new Date().toISOString(),
    }));
    await writePrivateRecord(s, 'app-roadmap', appRoadmapKey(appId), {
      spec: APP_ROADMAP_SPEC, appId, entries, wantedVisibility: 'developers',
    });
    await expect(addRoadmapEntry(s, { appId, state: 'wanted', what: 'One too many', by: 'alice' })).rejects.toThrow('full');
    await addRoadmapEntry(s, { appId, state: 'done', what: 'A completed change', by: 'alice' });
    expect((await readAppRoadmap(s, appId))?.entries).toHaveLength(APP_ROADMAP_MAX + 1);
  });
  it('P1-01: preserves filename identity and owner boundaries', () => {
    expect(sameApp('alice-team/app.html', 'alice/team-app.html')).toBe(false);
    expect(sameApp('alice/a.b.html', 'alice/a-b.html')).toBe(false);
    expect(sameApp('alice/App.html', 'alice/app.html')).toBe(false);
    expect(sameApp('Alice/app.html', 'alice/app.html')).toBe(true);
  });
  it('P1-01: a grant on a colliding app never authorizes the other app', async () => {
    const s = store();
    await putDevGrant(s, {appId:'alice-team/app.html',account:'mallory',level:0,grantedBy:'alice-team@node-x'});
    expect(await getDevGrant(s,'alice/team-app.html','mallory')).toBeNull();
  });
  it('P1-01: colliding rosters remain independently writable and revocable', async () => {
    const s = store();
    for (const appId of ['alice/a.b.html','alice/a-b.html']) {
      await putMember(s,{appId,account:'bob',role:appId,approvedBy:'alice@node-x'});
    }
    expect((await getMemberRow(s,'alice/a.b.html','bob'))?.role).toBe('alice/a.b.html');
    await removeMember(s,'alice/a-b.html','bob');
    expect(await getMemberRow(s,'alice/a.b.html','bob')).not.toBeNull();
  });
  it('P1-02: a colliding roadmap is neither readable nor overwritten', async () => {
    const s = store();
    await addRoadmapEntry(s,{appId:'alice/team-app.html',state:'wanted',what:'Private plan',by:'alice'});
    expect(await readAppRoadmap(s,'alice-team/app.html')).toBeNull();
    await addRoadmapEntry(s,{appId:'alice-team/app.html',state:'wanted',what:'Other plan',by:'alice-team'});
    expect((await readAppRoadmap(s,'alice/team-app.html'))?.entries[0]?.what).toBe('Private plan');
  });
  it('P2-05: concurrent successful additions all survive', async () => {
    const s = store();
    await Promise.all(Array.from({length:12},(_,i)=>addRoadmapEntry(s,{
      appId:'alice/app.html',state:'wanted',what:`Request ${i}`,by:'alice',
    })));
    expect((await readAppRoadmap(s,'alice/app.html'))?.entries).toHaveLength(12);
  });
});
