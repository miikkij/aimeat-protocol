/**
 * @file test/unit/turn-credentials.test.ts
 * @description The TURN entry GET /v1/realtime/ice-servers hands a caller (services/turn-credentials.ts):
 *   the TURN REST API credential checked against an HMAC computed here with node:crypto, its expiry,
 *   the opaque id that keeps the account name out of TURN logs, who gets no TURN entry, the
 *   deprecated static pair, and the boot warning.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  deriveTurnCredential, turnOpaqueId, turnEntryFor, turnDeprecationWarning, type TurnSettings,
} from '../../src/services/turn-credentials.js';
import { turnTtlFrom } from '../../src/config-turn.js';

const SECRET = 'unit-turn-secret';
const OWNER = { kind: 'owner', visitor: false, principal: 'alice@aimeat-local-001-dev' };
const NOW_MS = 1_760_000_000_123;

function settings(over: Partial<TurnSettings> = {}): TurnSettings {
  return {
    turnServer: 'turn:127.0.0.1:3478', turnUsername: null, turnCredential: null,
    turnSecret: SECRET, turnTtlSeconds: 3600, ...over,
  };
}

describe('deriveTurnCredential', () => {
  it('matches the TURN REST API vector: credential = base64(HMAC-SHA1(secret, username))', () => {
    const { username, credential, expiresAt } = deriveTurnCredential(SECRET, OWNER.principal, 3600, NOW_MS);
    expect(expiresAt).toBe(1_760_000_000 + 3600);
    expect(username.startsWith(`${expiresAt}:`)).toBe(true);
    const expected = createHmac('sha1', SECRET).update(username).digest('base64');
    expect(credential).toBe(expected);
  });

  it('a fixed username gives the fixed credential computed independently', () => {
    // Independent vector: the username is rebuilt here from the expiry and the opaque id.
    const id = createHmac('sha256', SECRET).update('aimeat-turn-user:' + OWNER.principal).digest('hex').slice(0, 16);
    const username = `${1_760_000_000 + 600}:${id}`;
    const { username: got, credential } = deriveTurnCredential(SECRET, OWNER.principal, 600, NOW_MS);
    expect(got).toBe(username);
    expect(credential).toBe(createHmac('sha1', SECRET).update(username).digest('base64'));
  });

  it('clamps the TTL to 60..86400 seconds', () => {
    expect(deriveTurnCredential(SECRET, 'x', 5, NOW_MS).expiresAt).toBe(1_760_000_000 + 60);
    expect(deriveTurnCredential(SECRET, 'x', 999_999, NOW_MS).expiresAt).toBe(1_760_000_000 + 86400);
  });
});

describe('turnOpaqueId', () => {
  it('is 16 hex characters and never contains the identity', () => {
    const id = turnOpaqueId(SECRET, OWNER.principal);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain('alice');
  });
  it('is stable for one caller and differs between callers and between secrets', () => {
    expect(turnOpaqueId(SECRET, 'alice@n')).toBe(turnOpaqueId(SECRET, 'alice@n'));
    expect(turnOpaqueId(SECRET, 'alice@n')).not.toBe(turnOpaqueId(SECRET, 'bob@n'));
    expect(turnOpaqueId(SECRET, 'alice@n')).not.toBe(turnOpaqueId('other', 'alice@n'));
  });
});

describe('turnEntryFor', () => {
  it('gives a signed-in caller an expiring credential and never the secret', () => {
    const entry = turnEntryFor(settings(), OWNER, NOW_MS)!;
    expect(entry.urls).toBe('turn:127.0.0.1:3478');
    const expiry = Number(entry.username!.split(':')[0]);
    expect(expiry).toBe(Math.floor(NOW_MS / 1000) + 3600);
    expect(entry.credential).toBe(createHmac('sha1', SECRET).update(entry.username!).digest('base64'));
    expect(JSON.stringify(entry)).not.toContain(SECRET);
    expect(JSON.stringify(entry)).not.toContain('alice');
  });
  it('gives an agent its own credential, apart from its owner', () => {
    const agent = { kind: 'agent', visitor: false, principal: 'claude#alice@aimeat-local-001-dev' };
    expect(turnEntryFor(settings(), agent, NOW_MS)!.username).not.toBe(turnEntryFor(settings(), OWNER, NOW_MS)!.username);
  });
  it('gives no TURN entry to an anonymous caller, a missing caller or a visitor', () => {
    expect(turnEntryFor(settings(), { ...OWNER, kind: 'anonymous' }, NOW_MS)).toBeNull();
    expect(turnEntryFor(settings(), null, NOW_MS)).toBeNull();
    expect(turnEntryFor(settings(), { kind: 'visitor', visitor: true, principal: 'alice@other-node' }, NOW_MS)).toBeNull();
  });
  it('gives nothing when no TURN server is set', () => {
    expect(turnEntryFor(settings({ turnServer: null }), OWNER, NOW_MS)).toBeNull();
  });
  it('serves the deprecated static pair when no secret is set', () => {
    const entry = turnEntryFor(settings({ turnSecret: null, turnUsername: 'u', turnCredential: 'c' }), OWNER, NOW_MS);
    expect(entry).toEqual({ urls: 'turn:127.0.0.1:3478', username: 'u', credential: 'c' });
  });
  it('prefers the secret over a static pair that is also set', () => {
    const entry = turnEntryFor(settings({ turnUsername: 'u', turnCredential: 'c' }), OWNER, NOW_MS)!;
    expect(entry.username).not.toBe('u');
    expect(entry.credential).not.toBe('c');
  });
});

describe('turnDeprecationWarning', () => {
  it('names AIMEAT_TURN_SECRET when only the static pair is set', () => {
    const w = turnDeprecationWarning(settings({ turnSecret: null, turnUsername: 'u', turnCredential: 'c' }));
    expect(w).toContain('deprecated');
    expect(w).toContain('AIMEAT_TURN_SECRET');
  });
  it('says the pair is ignored when the secret is set too', () => {
    expect(turnDeprecationWarning(settings({ turnUsername: 'u' }))).toContain('ignored');
  });
  it('is null without a static pair', () => {
    expect(turnDeprecationWarning(settings())).toBeNull();
    expect(turnDeprecationWarning(settings({ turnSecret: null }))).toBeNull();
  });
});

describe('turnTtlFrom', () => {
  it('defaults to 3600 and clamps to 60..86400', () => {
    expect(turnTtlFrom(undefined)).toBe(3600);
    expect(turnTtlFrom('abc')).toBe(3600);
    expect(turnTtlFrom('10')).toBe(60);
    expect(turnTtlFrom('100000')).toBe(86400);
    expect(turnTtlFrom('900')).toBe(900);
  });
});
