/**
 * @file test/unit/handover-link.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The handover link the fleet's control service asks for inside a place's container
 *   (services/handover-link.ts, `aimeat handover-link`): it signs the one person in, once, and lands
 *   on their Home; it refuses to guess between two people, and it never issues a link for an account
 *   whose login link is off or that is deactivated.
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni v27 P3).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { provisionOwner } from '../../src/services/owner-provisioning.js';
import { redeemLoginLink } from '../../src/services/login-link.js';
import { issueHandoverLink } from '../../src/services/handover-link.js';

const NODE_ID = 'aimeat-local-001-dev';

describe('the handover link', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  // Accounts are made on the local configuration (a public base URL asks for the setup code); the
  // link is issued on the place's public one, as on a store-sold place.
  let local: AimeatConfig;

  async function person(name: string, linkOn = true) {
    const email = `${name}@example.test`;
    const { ghii } = await provisionOwner(storage, local, { via: 'direct', fromLoopback: true, username: name, displayName: name, verifiedEmail: email });
    await storage.updateGHII(ghii.ghii, { notificationEmail: email, magicLinkEnabled: linkOn });
    return ghii.ghii;
  }

  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    local = { ...loadConfig().config, nodeId: NODE_ID };
    config = { ...local, baseUrl: 'https://buyer.aimeat.test' };
  });

  it('signs the one person in, once, and lands on their Home in their language', async () => {
    await person('buyer');
    const out = await issueHandoverLink(storage, config, { lang: 'fi' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.account).toBe('buyer');
    const url = new URL(out.url);
    expect(url.origin).toBe('https://buyer.aimeat.test');
    expect(url.pathname).toBe('/v1/ghii/magic-link/open');
    expect(url.searchParams.get('redirect')).toBe('/v1/home?lang=fi');
    expect(Date.parse(out.expires_at) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    const token = url.searchParams.get('token')!;
    const first = await redeemLoginLink(storage, config, token);
    expect(first.ok).toBe(true);
    expect((await redeemLoginLink(storage, config, token)).ok).toBe(false);
  });

  it('refuses to choose between two people, and names them', async () => {
    await person('anna');
    await person('bert');
    const out = await issueHandoverLink(storage, config);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('AMBIGUOUS');
    expect(out.candidates).toEqual(['anna', 'bert']);
    const named = await issueHandoverLink(storage, config, { account: 'bert' });
    expect(named.ok && named.account).toBe('bert');
  });

  it('issues nothing for an account whose login link is off, or that is deactivated', async () => {
    await person('quiet', false);
    expect(await issueHandoverLink(storage, config, { account: 'quiet' })).toMatchObject({ ok: false, code: 'LOGIN_LINK_OFF' });
    expect(await issueHandoverLink(storage, config)).toMatchObject({ ok: false, code: 'NO_OWNER' });
    await person('gone');
    await storage.updateOwner('gone', { disabledAt: new Date().toISOString() });
    expect(await issueHandoverLink(storage, config, { account: 'gone' })).toMatchObject({ ok: false, code: 'ACCOUNT_DISABLED' });
    expect(await issueHandoverLink(storage, config, { account: 'nobody' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
