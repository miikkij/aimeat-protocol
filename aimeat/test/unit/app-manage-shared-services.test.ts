/**
 * @file test/unit/app-manage-shared-services.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The services the member, plan, audit-keeping, dev-grant and design-spec routes and
 *   the aimeat_app_manage MCP tool both call (secaudit 2026-10, M6), on SQLite in memory, with the
 *   caller as data: one refusal and one success per family, with the route's status and code.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-manage-shared-services.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M6).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AppOpCaller, AppOpOutcome } from '../../src/services/app-op-outcome.js';
import { listRoster } from '../../src/services/app-roster-ops.js';
import { setCarryPlan } from '../../src/services/app-roster-write.js';
import { archiveAuditFor, setAuditKeep } from '../../src/services/app-audit-keep.js';
import { setAppBuilder } from '../../src/services/app-dev-grant-ops.js';
import { readDesignSpecFor, writeDesignSpecFor, clearDesignSpecFor } from '../../src/services/app-design-spec-ops.js';
import { putDevGrant, APP_DEV_LEVELS } from '../../src/services/app-dev-grant.js';

const NODE = 'm6-test';
const config = { nodeId: NODE, baseUrl: 'http://localhost:40050', appAuditKeepDefault: 0, appOriginEnabled: false } as AimeatConfig;
const club = { owner: 'alice', filename: 'club.html' };

/** The MCP session's caller shape: the agent identity, role agent, the session's scopes. */
const agentOf = (owner: string, scopes: string[] = ['*']): AppOpCaller => ({ sub: `claude#${owner}@${NODE}`, owner, roles: ['agent'], scopes });

async function world(): Promise<Storage> {
  const s = new SqliteStorage(':memory:');
  const now = new Date().toISOString();
  for (const name of ['alice', 'bob', 'carol']) {
    await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
      verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
  }
  await s.createApp({
    ownerGaii: `alice@${NODE}`, ownerName: 'alice', filename: 'club.html', versionNumber: 1,
    manifest: { name: 'club', description: 'fixture', version: '1', category: 'tool', tags: [], authorDisplay: 'alice', usesCortex: [] },
    mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: now,
  });
  return s;
}

function refusal(out: AppOpOutcome): { status: number; code: string } {
  expect(out.ok).toBe(false);
  return out.ok ? { status: 0, code: '' } : { status: out.status, code: out.code };
}

describe('members: listRoster', () => {
  it('refuses somebody who neither owns nor manages the app, and answers its owner\'s agent', async () => {
    const s = await world();
    expect(refusal(await listRoster(s, config, agentOf('bob'), club, {}))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(refusal(await listRoster(s, config, agentOf('alice'), { ...club, filename: 'nope.html' }, {}))).toEqual({ status: 404, code: 'NOT_FOUND' });
    const out = await listRoster(s, config, agentOf('alice'), club, { limit: '10' });
    expect(out.ok && out.data).toMatchObject({ members: [], canManage: true, isOwner: true, limit: 10 });
  });
});

describe('plan: setCarryPlan', () => {
  it('refuses a plan with no roles and an app token adding an offering, and stores a valid plan', async () => {
    const s = await world();
    expect(refusal(await setCarryPlan(s, config, agentOf('alice'), club, {}))).toEqual({ status: 400, code: 'INVALID_INPUT' });
    const appToken: AppOpCaller = { sub: `app:club#alice@${NODE}`, owner: 'alice', roles: ['app'], scopes: [], app: 'alice/club.html' };
    expect(refusal(await setCarryPlan(s, config, appToken, club, { roles: { member: ['off-1'] } }))).toEqual({ status: 403, code: 'FORBIDDEN' });
    const out = await setCarryPlan(s, config, agentOf('alice'), club, { roles: { member: [] }, manageRoles: ['admin'] });
    expect(out.ok && (out.data.plan as { manageRoles: string[] }).manageRoles).toEqual(['admin']);
  });
});

describe('audit: setAuditKeep and archiveAuditFor', () => {
  it('refuses a deleting limit to an agent without account:security, and lets it keep everything', async () => {
    const s = await world();
    expect(refusal(await setAuditKeep(s, config, agentOf('alice'), 10))).toEqual({ status: 403, code: 'OWNER_ONLY' });
    expect(refusal(await setAuditKeep(s, config, agentOf('alice'), 1.5))).toEqual({ status: 400, code: 'INVALID_INPUT' });
    const out = await setAuditKeep(s, config, agentOf('alice'), 'all');
    expect(out.ok && out.data).toMatchObject({ keep: 0, nodeDefault: 0 });
    // The account holder's own agent holding account:security may set a number.
    expect((await setAuditKeep(s, config, agentOf('alice', ['account:security']), 10)).ok).toBe(true);
  });

  it('answers 404 to anybody but the owner, and archives for the owner', async () => {
    const s = await world();
    expect(refusal(await archiveAuditFor(s, config, agentOf('bob'), club, '2026-01-01'))).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(refusal(await archiveAuditFor(s, config, agentOf('alice'), club, 'not a date'))).toEqual({ status: 400, code: 'INVALID_INPUT' });
    const out = await archiveAuditFor(s, config, agentOf('alice'), club, '2026-01-01');
    expect(out.ok && out.data).toMatchObject({ moved: 0, before: '2026-01-01T00:00:00.000Z' });
  });
});

describe('dev-grants: setAppBuilder', () => {
  it('refuses a name nobody holds and a caller who is not the owner, and grants a real account', async () => {
    const s = await world();
    expect(refusal(await setAppBuilder(s, config, agentOf('alice'), club, 'zed', { level: 'drafter' }))).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(refusal(await setAppBuilder(s, config, agentOf('bob'), club, 'carol', { level: 'drafter' }))).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(refusal(await setAppBuilder(s, config, agentOf('alice'), club, 'bob', { level: 'nope' }))).toEqual({ status: 400, code: 'INVALID_INPUT' });
    const out = await setAppBuilder(s, config, agentOf('alice'), club, 'bob', { level: 'drafter' });
    expect(out.ok && out.data).toMatchObject({ granted: true, account: 'bob', levelName: 'drafter' });
  });
});

describe('design spec: writeDesignSpecFor and clearDesignSpecFor', () => {
  it('refuses somebody outside the build, writes for the owner, and refuses a builder\'s removal', async () => {
    const s = await world();
    expect(refusal(await writeDesignSpecFor(s, config, agentOf('carol'), club, { markdown: '# Club' }))).toEqual({ status: 403, code: 'FORBIDDEN' });
    const out = await writeDesignSpecFor(s, config, agentOf('alice'), { ...club, owner: 'me' }, { markdown: '# Club\n\nWhat it is for.' });
    expect(out.ok && out.status).toBe(201);
    await putDevGrant(s, { appId: 'alice/club.html', account: 'bob', level: APP_DEV_LEVELS.drafter, grantedBy: `alice@${NODE}` });
    // The drafter reads the document (inside the build) and may not remove it (the owner's alone).
    expect((await readDesignSpecFor(s, config, agentOf('bob'), club)).ok).toBe(true);
    const removal = await clearDesignSpecFor(s, config, agentOf('bob'), club);
    expect(refusal(removal)).toEqual({ status: 403, code: 'FORBIDDEN' });
    expect(!removal.ok && removal.message).toMatch(/Only the app owner removes the design spec/);
    const cleared = await clearDesignSpecFor(s, config, agentOf('alice'), club);
    expect(cleared.ok && cleared.data).toEqual({ removed: true });
  });
});
