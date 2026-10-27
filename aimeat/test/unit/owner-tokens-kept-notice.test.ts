/**
 * @file test/unit/owner-tokens-kept-notice.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which access tokens the person is told still act as them after a password reset, a
 *   password change or sign out everywhere (services/owner-tokens-kept-notice.ts; secaudit2026oct26,
 *   owner-level-pat-session-survives-reset): the Full and operator-level ones that still work, never
 *   a scoped, revoked or expired one, and no notice when none is left.
 * @usage pnpm exec vitest run test/unit/owner-tokens-kept-notice.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { ownerTokensKeptNotice, OWNER_TOKENS_KEPT_TYPE } from '../../src/services/owner-tokens-kept-notice.js';
import type { PatRecord } from '../../src/storage/repositories/pat.repository.js';

const pat = (label: string, extra: Partial<PatRecord> = {}): PatRecord => ({
  id: label, tokenHash: label, label, owner: 'alice', scopes: [], grantOwner: false, grantOperator: false,
  readOwnerData: false, gaii: '', createdAt: '2026-10-01T00:00:00.000Z', expiresAt: null, lastUsedAt: null, revoked: false, ...extra,
});

describe('ownerTokensKeptNotice', () => {
  it('names the Full and operator tokens that still work, and nothing else', () => {
    const n = ownerTokensKeptNotice([
      pat('full', { grantOwner: true }),
      pat('op', { grantOperator: true }),
      pat('scoped', { scopes: ['memory:read'] }),
      pat('gone', { grantOwner: true, revoked: true }),
      pat('old', { grantOwner: true, expiresAt: '2000-01-01T00:00:00.000Z' }),
    ]);
    expect(n?.type).toBe(OWNER_TOKENS_KEPT_TYPE);
    expect(n?.body).toContain('"full"');
    expect(n?.body).toContain('"op"');
    for (const w of ['scoped', 'gone', 'old']) expect(n?.body).not.toContain(`"${w}"`);
    expect(n?.i18n?.vars).toMatchObject({ count: 2 });
    expect(n?.link).toBe('/v1/profile#access');
  });

  it('is no notice when no token acts as the person', () => {
    expect(ownerTokensKeptNotice([pat('scoped', { scopes: ['memory:read'] })])).toBeNull();
    expect(ownerTokensKeptNotice([])).toBeNull();
  });
});
