/**
 * @file test/unit/app-invite-mail-count.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/app/roster-write.ts setMember by email: an invitation an agent or an app
 *   sends by email counts against the account's emailed-invitation allowance
 *   (account-limits.ts INVITE_EMAIL_LIMIT, the organism invitation's), before anything is stored, as
 *   the rest of third-party mail does; past it, 429 RATE_LIMITED with retry_after_sec, and nothing is
 *   stored or sent. The owner in person is counted by the address lookup as before and keeps
 *   inviting; a node that sends no mail counts nothing. On SQLite in memory with a mail service that
 *   records its calls (codebase analysis 2026-11-03, decision 14a of 2026-11-05).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-invite-mail-count.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 14a of 2026-11-05).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { setMember } from '../../src/services/app/roster-write.js';
import { listInvites } from '../../src/services/app/member-invites.js';
import { INVITE_EMAIL_LIMIT } from '../../src/services/account-limits.js';
import { provideNodeService } from '../../src/services/node-context.js';
import type { EmailService } from '../../src/services/email.js';

type TestStorage = Storage & { close(): void | Promise<void> };
let s: TestStorage;
const NODE = 'invite-count-test';
const config = { nodeId: NODE, baseUrl: 'https://node.example' } as never;
const now = new Date().toISOString();

const agentOf = (owner: string) => ({ sub: `claude#${owner}@${NODE}`, owner, roles: ['agent'], scopes: ['exchange:grant'] });
const appOf = (owner: string) => ({ sub: `${owner}@${NODE}`, owner, roles: ['app'], scopes: ['exchange:grant'] });
const inPerson = (owner: string) => ({ sub: `${owner}@${NODE}`, owner, roles: ['owner'] });

function mailer(enabled = true) {
  const sendRaw = vi.fn(async () => true);
  provideNodeService('email', { enabled, sendRaw } as unknown as EmailService);
  return sendRaw;
}

beforeAll(async () => {
  s = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage;
  for (const name of ['alice', 'bob', 'dave']) {
    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
    await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name,
      displayName: name, verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    await s.createApp({
      ownerGaii: `${name}@${NODE}`, ownerName: name, filename: 'club.html', versionNumber: 1,
      manifest: { name: 'club.html', description: 'fixture', version: '1', category: 'tool', tags: [], authorDisplay: name, usesCortex: [] },
      mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: now,
    });
  }
}, 60_000);
afterAll(async () => { await s.close(); });
afterEach(() => { provideNodeService('email', null); });

const invite = (caller: object, owner: string, i: number) =>
  setMember(s, config, caller as never, { owner, filename: 'club.html' }, { email: `guest${i}.${owner}@example.test`, role: 'member', locale: 'en' });

describe('an app invitation by email, from an agent or an app', () => {
  it('counts against the account allowance, and past it nothing is stored or sent', async () => {
    const sendRaw = mailer();
    const max = INVITE_EMAIL_LIMIT.max;
    // The agent and the app's own token draw on one allowance: the account's.
    for (let i = 0; i < max; i++) {
      const out = await invite(i % 2 ? appOf('alice') : agentOf('alice'), 'alice', i);
      expect(out.ok, `invitation ${i}: ${JSON.stringify(out)}`).toBe(true);
    }
    expect(sendRaw).toHaveBeenCalledTimes(max);
    const refused = await invite(agentOf('alice'), 'alice', max);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.status).toBe(429);
    expect(refused.code).toBe('RATE_LIMITED');
    expect((refused.details as { retry_after_sec?: number }).retry_after_sec).toBeGreaterThan(0);
    expect(refused.message).toMatch(/email invitations in the last ten minutes/);
    expect(sendRaw).toHaveBeenCalledTimes(max);
    expect((await listInvites(s, 'alice/club.html')).some(v => v.emailShown === `guest${max}.alice@example.test`)).toBe(false);
  });

  it('the owner in person keeps inviting: the address lookup counts them, as before', async () => {
    const sendRaw = mailer();
    const out = await invite(inPerson('alice'), 'alice', 900);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(sendRaw).toHaveBeenCalledTimes(1);
  });

  it('a node that sends no mail counts nothing', async () => {
    mailer(false);
    for (let i = 0; i <= INVITE_EMAIL_LIMIT.max; i++) {
      const out = await invite(agentOf('dave'), 'dave', i);
      expect(out.ok, `invitation ${i}: ${JSON.stringify(out)}`).toBe(true);
    }
  });
});
