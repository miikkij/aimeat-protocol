/**
 * @file test/unit/owner-sign-in-guidance.test.ts
 * @description What the node tells an owner, or an AI working for one, about signing in: the password
 *   sign-in (POST /v1/ghii/login), never the owner-key sign-in that node 4.0.0 removes
 *   (OWNER_KEY_LOGIN_REMOVED_IN, src/config-security.ts).
 *
 *   WHY. Two texts still sent an owner to POST /v1/auth/token with the account key after the tests,
 *   the sandbox and the sign-in library had moved to the password: the next action in the answer of
 *   POST /v1/owners, and the node guide skill ("An owner holding an older Ed25519 key can still log
 *   in with it"). From 4.0.0 both are false, and an AI that follows either one gets 410 and no way in.
 *   The E2E half (the live POST /v1/owners answer) is in test/api-full.ts.
 * @usage cd aimeat && pnpm vitest run test/unit/owner-sign-in-guidance.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (the 4.0.0 sweep).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';

describe('the node guide sends an owner to the password sign-in', () => {
  const guide = BUILTIN_SKILLS.find(s => s.name === 'aimeat-node-guide')!.skillMd;

  it('names POST /v1/ghii/login', () => {
    expect(guide).toContain('POST /v1/ghii/login');
  });

  it('does not say the owner-key sign-in still works', () => {
    expect(guide).not.toMatch(/can still log in with it/i);
    expect(guide).toMatch(/removed in node 4\.0\.0/);
  });
});

describe('POST /v1/owners points its next action at the password sign-in', () => {
  // The route builds the answer inline; its source is what an AI reading the answer gets.
  const src = readFileSync(fileURLToPath(new URL('../../src/routes/owners.ts', import.meta.url)), 'utf-8');
  const answer = src.slice(src.indexOf("res.status(201).json(success(config.nodeId"), src.indexOf("emitChange('owners')"));

  it('the first next action is POST /v1/ghii/login with a user name and a password', () => {
    expect(answer).toContain("url: '/v1/ghii/login'");
    expect(answer).toMatch(/username: name,\s*password:/);
  });

  it('no next action is the owner-key sign-in', () => {
    expect(answer).not.toContain("url: '/v1/auth/token'");
    expect(answer).not.toContain('Ed25519_sign');
  });
});
