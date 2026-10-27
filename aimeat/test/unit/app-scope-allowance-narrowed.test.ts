/**
 * @file test/unit/app-scope-allowance-narrowed.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A boot-time keep step (services/app-scope-allowance.ts keepWorkingAppsOnce) leaves a
 *   grant its holder narrowed by hand (PATCH /v1/app-grants/:grantId stamps scopesFixedAt) as the
 *   holder left it, as the vocabulary migration and the own-app consent already do; the holder's next
 *   sign-in to the app asks for the word once (own-app consent, owner_narrowed). Every other live grant
 *   gets the word, and the allowance and the app's change-log entry are written as before, the change
 *   log naming the grants left alone (secaudit2026oct26, app-scope-allowance:keep-step-ignores-grant-scopesFixedAt).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-scope-allowance-narrowed.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { keepWorkingAppsOnce, readAppScopeAllowance } from '../../src/services/app-scope-allowance.js';
import { readAppAudit } from '../../src/services/app-audit.js';
import { ownAppConsentNeed } from '../../src/services/own-app-consent.js';

const NODE_ID = 'aimeat-allowance-narrowed';
const OWNER = 'narrowowner';
const GHII = `${OWNER}@${NODE_ID}`;
const DEFAULTS = ['memory:read', 'memory:write', 'storage:read', 'storage:write'];
const past = new Date(Date.now() - 3_600_000).toISOString();

let storage: Storage;
let config: AimeatConfig;

async function grant(id: string, holder: string, scopes: string[], scopesFixedAt?: string): Promise<void> {
  await storage.createAppGrant({
    grantId: id, app: `${OWNER}/guest.html`, appName: 'guest.html', appOrigin: 'https://x.node.test', owner: holder, gaii: `${holder}@${NODE_ID}`,
    scopes, refreshTokenHash: null, createdAt: past, lastUsedAt: null, revoked: false,
  } as never);
  if (scopesFixedAt) await storage.updateAppGrant(id, { scopesFixedAt });
}

beforeAll(async () => {
  setThisNodeId(null);
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
  const k = await generateKeyPair();
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: k.publicKey, roles: ['owner'], createdAt: past } as never);
  const html = '<html><head><script src="/v1/libs/aimeat-auth.js"></script></head><body><script>session.fetch(\'/v1/ext/guest/sign\', { method: \'POST\' })</script></body></html>';
  const data = Buffer.from(html);
  await storage.createApp({
    ownerGaii: GHII, ownerName: OWNER, filename: 'guest.html', versionNumber: 1,
    manifest: { name: 'guest', description: 'd', version: '1.0.0', author: OWNER, category: 'tool', tags: [] } as never,
    mimeType: 'text/html', size: data.length, data, createdAt: past,
  });
  await grant('g-plain', 'visitora', [...DEFAULTS]);
  // The app's owner narrowed their own grant by hand: memory:write taken away.
  await grant('g-narrowed', OWNER,['memory:read', 'storage:read', 'storage:write'], new Date(Date.now() - 60_000).toISOString());
}, 60_000);

describe('keepWorkingAppsOnce and a grant its holder narrowed by hand', () => {
  it('writes the kept word onto every live grant but the narrowed one, and says so in the change log', async () => {
    const kept = await keepWorkingAppsOnce(storage, config, Date.now(), { reason: 'test' });
    expect(kept.map(k => [k.appId, k.words])).toEqual([[`${OWNER}/guest.html`, ['ext:invoke']]]);
    expect((await readAppScopeAllowance(storage, `${OWNER}/guest.html`))?.words).toEqual(['ext:invoke']);
    expect((await storage.getAppGrant('g-plain'))!.scopes).toContain('ext:invoke');
    expect((await storage.getAppGrant('g-narrowed'))!.scopes).toEqual(['memory:read', 'storage:read', 'storage:write']);
    const audit = (await readAppAudit(storage, GHII, 'guest.html')).find(e => e.action === 'scope_allowance.kept');
    expect(audit?.detail).toMatchObject({ words: 'ext:invoke', grants: 1, narrowed_grants_left: 1 });
  });

  it('the owner who narrowed their own app is asked for the word once at the next sign-in', async () => {
    const narrowed = await storage.getAppGrant('g-narrowed');
    const asked = await ownAppConsentNeed(storage, OWNER, `${OWNER}/guest.html`, narrowed, [...narrowed!.scopes, 'ext:invoke']);
    expect(asked).toMatchObject({ reason: 'owner_narrowed', added: ['ext:invoke'] });
  });
});
