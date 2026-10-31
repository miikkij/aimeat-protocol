/**
 * @file test/unit/oauth-round-host-cookie.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which cookie finishes an outside-account or remote MCP server round
 *   (secaudit2026oct31w2, W2-19, roundBindingHeld in services/oauth-round-secrets.ts). A round bound
 *   over https records `bindCookie: 'host'` and finishes only with the `__Host-` cookie, which a
 *   same-site app, portfolio or company page cannot write; a round bound over plain http finishes
 *   only over plain http; a round written before `bindCookie` existed reads the plain cookie, so a
 *   round in flight across the deploy finishes. The E2E halves are in e2e-connections (Phase
 *   2b-https) and e2e-mcp-proxy.
 * @usage cd aimeat && pnpm exec vitest run test/unit/oauth-round-host-cookie.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, W2-19).
 */
import { describe, it, expect } from 'vitest';
import { bindingHash, roundBindingHeld } from '../../src/services/oauth-round-secrets.js';

const VALUE = 'the-starters-browser';
const HASH = bindingHash(VALUE);

describe('roundBindingHeld', () => {
  it('a round bound over https finishes with the __Host- cookie and not with the plain name', () => {
    expect(roundBindingHeld({ binding: '', hostBinding: VALUE, secure: true }, HASH, 'host')).toBe(true);
    expect(roundBindingHeld({ binding: VALUE, hostBinding: '', secure: true }, HASH, 'host')).toBe(false);
    expect(roundBindingHeld({ binding: VALUE, hostBinding: 'other', secure: true }, HASH, 'host')).toBe(false);
  });

  it('a round bound over plain http finishes over plain http only', () => {
    expect(roundBindingHeld({ binding: VALUE, secure: false }, HASH, 'plain')).toBe(true);
    expect(roundBindingHeld({ binding: VALUE, secure: true }, HASH, 'plain')).toBe(false);
  });

  it('a round written before bindCookie existed reads the plain cookie, as it did', () => {
    expect(roundBindingHeld({ binding: VALUE, secure: true }, HASH, undefined)).toBe(true);
    expect(roundBindingHeld({ binding: VALUE }, HASH, undefined)).toBe(true);
    expect(roundBindingHeld({ binding: 'other' }, HASH, undefined)).toBe(false);
  });

  it('a round nobody bound is never finished', () => {
    expect(roundBindingHeld({ binding: VALUE, hostBinding: VALUE, secure: true }, undefined, 'host')).toBe(false);
    expect(roundBindingHeld({ binding: VALUE }, undefined, undefined)).toBe(false);
  });
});
