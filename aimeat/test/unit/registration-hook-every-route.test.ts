/**
 * @file registration-hook-every-route.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 89: the pre_owner_registration hook ran only on POST /v1/owners.
 *   An account made through an identity provider, an invitation, SCIM or an install set went through
 *   provisionOwner, which never asked it. provisionOwner now asks the hook before any row exists and
 *   throws RegistrationHookRefusedError (a RegistrationClosedError, code HOOK_REJECTED) on a refusal,
 *   and tells post_owner_registration once the account exists.
 * @usage cd aimeat && pnpm exec vitest run test/unit/registration-hook-every-route.test.ts
 * @version-history
 *   v1.0.1 — 2026-10-23 — The allowed provisionOwner call is a request from loopback (fromLoopback): a call
 *     with no request is asked for the setup code of a node without an operator (secaudit2026oct22).
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 89).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ hook: string; ctx: Record<string, unknown> }> = [];
let refuse = false;

vi.mock('../../src/services/hooks.js', () => ({
  executeHooks: vi.fn(async (_config: unknown, _storage: unknown, hook: string, ctx: Record<string, unknown>) => {
    calls.push({ hook, ctx });
    if (hook === 'pre_owner_registration' && refuse) return { allowed: false, reason: 'Only staff may register here.' };
    return { allowed: true };
  }),
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { provisionOwner, RegistrationClosedError, RegistrationHookRefusedError } from '../../src/services/owner-provisioning.js';

const NODE = 'aimeat-unit-reghook-001';
let storage: Storage;
let config: AimeatConfig;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  config = { ...loadConfig().config, nodeId: NODE, registrationMode: 'open' } as AimeatConfig;
  calls.length = 0;
  refuse = false;
});

describe('provisionOwner asks the registration hook', () => {
  it('refuses before any row exists when the hook refuses', async () => {
    refuse = true;
    const err = await provisionOwner(storage, config, { via: 'invitation', username: 'carol', displayName: 'Carol' })
      .then(() => null, e => e);
    expect(err).toBeInstanceOf(RegistrationHookRefusedError);
    expect(err).toBeInstanceOf(RegistrationClosedError);
    expect((err as RegistrationHookRefusedError).code).toBe('HOOK_REJECTED');
    expect((err as Error).message).toBe('Only staff may register here.');
    expect(await storage.getOwner('carol')).toBeNull();
    expect(calls[0]).toMatchObject({ hook: 'pre_owner_registration', ctx: { name: 'carol', via: 'invitation' } });
  });

  it('creates the account and tells post_owner_registration when the hook allows', async () => {
    const { owner } = await provisionOwner(storage, config, { via: 'oauth', fromLoopback: true, username: 'dave', displayName: 'Dave' });
    expect(owner.name).toBe('dave');
    await new Promise(r => setTimeout(r, 0));
    expect(calls.map(c => c.hook)).toEqual(['pre_owner_registration', 'post_owner_registration']);
    expect(calls[1].ctx).toMatchObject({ name: 'dave', via: 'oauth' });
  });
});
