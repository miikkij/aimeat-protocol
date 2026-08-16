/**
 * @file test/unit/auth-audit.test.ts
 * @description The refusal log's two promises, asserted rather than assumed: the credential never
 *   reaches the file, and the file cannot grow without bound. Both are the reason this exists at
 *   all — a log that leaks a token is worse than no log, and a log an attacker can grow is a way
 *   to fill an operator's disk from outside.
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureAuthAuditForTest, recordAuthFailure, credentialDigest,
  type AuthFailureContext,
} from '../../src/services/auth-audit.js';

let dir = '';
let file = '';

const ctx = (over: Partial<AuthFailureContext> = {}): AuthFailureContext => ({
  method: 'POST',
  path: '/v1/ghii/login',
  ip: '203.0.113.9',
  host: 'aimeat.io',
  userAgent: 'curl/8.5.0',
  hasCookie: false,
  ...over,
});

const lines = () => readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aimeat-auth-audit-'));
  file = join(dir, 'auth-failures.log');
  configureAuthAuditForTest(file, 1024 * 1024);
});
afterEach(() => {
  configureAuthAuditForTest('', 0);
  rmSync(dir, { recursive: true, force: true });
});

describe('the refusal log', () => {
  it('records the door, the caller and the outcome as one parsable line', () => {
    recordAuthFailure(ctx(), { status: 401, code: 'AUTH_REQUIRED', reason: 'Authentication required' });
    const [row] = lines();
    expect(row.status).toBe(401);
    expect(row.code).toBe('AUTH_REQUIRED');
    expect(row.reason).toBe('Authentication required');
    expect(row.method).toBe('POST');
    expect(row.path).toBe('/v1/ghii/login');
    expect(row.ip).toBe('203.0.113.9');
    expect(row.ua).toBe('curl/8.5.0');
    expect(typeof row.ts).toBe('string');
  });

  it('NEVER writes the credential, only a digest of it', () => {
    const secret = 'eyJhbGciOiJFZERTQSJ9.the-actual-token-value.signature';
    recordAuthFailure(ctx({ authorization: `Bearer ${secret}` }),
      { status: 401, code: 'AUTH_REQUIRED', reason: 'Invalid or expired token' });
    const raw = readFileSync(file, 'utf-8');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('the-actual-token-value');
    const [row] = lines();
    expect(row.credential).toBe('bearer-jwt');
    expect(row.credential_digest).toBe(credentialDigest(secret));
    // Short enough not to be a credential, long enough to identify one across lines.
    expect(row.credential_digest).toHaveLength(12);
  });

  it('gives the same digest to the same credential, so a campaign is one story', () => {
    const token = 'pat-abcdefghijklmnop';
    recordAuthFailure(ctx({ authorization: `Bearer ${token}` }), { status: 401, code: 'AUTH_REQUIRED', reason: 'x' });
    recordAuthFailure(ctx({ authorization: `Bearer ${token}` }), { status: 401, code: 'AUTH_REQUIRED', reason: 'x' });
    recordAuthFailure(ctx({ authorization: 'Bearer pat-DIFFERENTvalue1' }), { status: 401, code: 'AUTH_REQUIRED', reason: 'x' });
    const rows = lines();
    expect(rows[0].credential_digest).toBe(rows[1].credential_digest);
    expect(rows[2].credential_digest).not.toBe(rows[0].credential_digest);
    expect(rows[0].credential).toBe('pat');
  });

  it('names the principal on a 403, because a named caller reaching past its authority is the finding', () => {
    recordAuthFailure(
      ctx({ principal: { sub: 'bot#alice@aimeat-local-001-dev', owner: 'alice', roles: ['agent'] } }),
      { status: 403, code: 'ACCESS_DENIED', reason: 'Role "owner" required' },
    );
    const [row] = lines();
    expect(row.status).toBe(403);
    expect(row.principal.sub).toBe('bot#alice@aimeat-local-001-dev');
    expect(row.principal.roles).toEqual(['agent']);
  });

  it('leaves the query string out: a refused request carries caller-written text', () => {
    recordAuthFailure(ctx({ path: '/v1/memory/key' }), { status: 401, code: 'AUTH_REQUIRED', reason: 'x' });
    expect(lines()[0].path).toBe('/v1/memory/key');
  });

  it('rotates at the ceiling and keeps exactly one older generation', () => {
    configureAuthAuditForTest(file, 400);
    for (let i = 0; i < 12; i++) {
      recordAuthFailure(ctx(), { status: 401, code: 'AUTH_REQUIRED', reason: `attempt ${i}` });
    }
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.1`)).toBe(true);
    // Two generations and no more: the third would be the disk-fill this ceiling exists to stop.
    expect(existsSync(`${file}.2`)).toBe(false);
  });

  it('writes nothing when no path is configured', () => {
    configureAuthAuditForTest('', 0);
    recordAuthFailure(ctx(), { status: 401, code: 'AUTH_REQUIRED', reason: 'x' });
    expect(existsSync(file)).toBe(false);
  });

  it('never throws when the file cannot be written, because a refusal must still happen', () => {
    // A path whose parent is a FILE cannot be created; the recorder has to swallow that.
    const blocked = join(dir, 'not-a-dir');
    writeFileSync(blocked, 'x');
    configureAuthAuditForTest(join(blocked, 'nested', 'auth.log'), 1024);
    expect(() => recordAuthFailure(ctx(), { status: 401, code: 'AUTH_REQUIRED', reason: 'x' })).not.toThrow();
  });
});
