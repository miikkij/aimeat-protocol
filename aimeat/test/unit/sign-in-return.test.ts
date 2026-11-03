/**
 * @file test/unit/sign-in-return.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent connect pages sign nobody in, and the front page returns a person only to
 *   those two pages. A person with no account once typed an address into the form on the MCP consent
 *   page and waited for a mail that never came (Jouni, 2026-11-04). The return address comes from a
 *   URL anyone can write, so its refusals are tested as a browser reads the address.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signInAddress, signInReturnTarget } from '../../public/js/sign-in-return.js';

const ORIGIN = 'https://node.example.test';
const page = (name: string) => readFileSync(join(__dirname, '..', '..', 'public', name), 'utf-8');
const target = (raw: string) => signInReturnTarget(`?sign_in_return=${encodeURIComponent(raw)}`, ORIGIN);

describe('the return address on the front page', () => {
  it('takes the two connect pages, with their requests', () => {
    expect(target('/v1/oauth/consent?client_id=c&state=s%20t')).toBe('/v1/oauth/consent?client_id=c&state=s%20t');
    expect(target('/v1/agents/verify?code=ABCD-1234')).toBe('/v1/agents/verify?code=ABCD-1234');
  });

  it('survives the address the connect page builds', () => {
    const path = '/v1/oauth/consent?client_id=c&redirect_uri=http%3A%2F%2F127.0.0.1%3A63855%2Fcb&resource=https%3A%2F%2Fa%2Fmcp';
    const search = signInAddress(path, 'fi').split('?').slice(1).join('?');
    expect(signInReturnTarget(`?${search}`, ORIGIN)).toBe(path);
    expect(new URLSearchParams(search).get('lang')).toBe('fi');
  });

  it('says nothing when the address names no return', () => {
    expect(signInReturnTarget('', ORIGIN)).toBeNull();
    expect(signInReturnTarget('?wish=x', ORIGIN)).toBeNull();
  });

  it.each([
    ['another site', 'https://evil.example/v1/oauth/consent'],
    ['a protocol-relative address', '//evil.example/v1/oauth/consent'],
    ['a backslash a browser reads as a slash', '/\\evil.example/v1/oauth/consent'],
    ['a tab a browser drops', '/\t/evil.example/v1/oauth/consent'],
    ['a script address', 'javascript:alert(1)'],
    ['another page of this node', '/v1/profile'],
    ['a path that climbs out', '/v1/oauth/consent/../../profile'],
    ['a path under a connect page', '/v1/oauth/consent/more'],
  ])('refuses %s', (_name, raw) => {
    expect(target(raw)).toBeNull();
  });
});

describe('the connect pages', () => {
  it.each(['oauth-consent.html', 'agent-consent.html'])('%s holds no sign-in form and sends a person to the front page', (name) => {
    const html = page(name);
    expect(html).not.toContain('id="loginForm"');
    expect(html).not.toContain('id="linkForm"');
    expect(html).not.toContain('/v1/ghii/login');
    expect(html).not.toContain('/v1/ghii/magic-link');
    expect(html).toContain('location.replace(signInAddress(');
  });
});
