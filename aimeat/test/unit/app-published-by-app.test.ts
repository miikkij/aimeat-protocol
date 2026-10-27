/**
 * @file test/unit/app-published-by-app.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which publish names an app as its publisher (src/services/app-published-by-app.ts;
 *   secaudit2026oct26, own-app-consent:app-grant-publisher-reads-as-owner): only a role-'app' token,
 *   on REST and on MCP, and only another author's app counts as somebody else's.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-published-by-app.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { publishingAppOf, publishingAppOfVerifiedToken, byAnotherAuthorsApp } from '../../src/services/app-published-by-app.js';

const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('the app a publish names', () => {
  it('a role-app token names its app; an owner or an agent names none', () => {
    expect(publishingAppOf({ roles: ['app'], app: 'bob/tool.html' })).toBe('bob/tool.html');
    expect(publishingAppOf({ roles: ['owner'], app: 'bob/tool.html' })).toBeUndefined();
    expect(publishingAppOf({ roles: ['agent'] })).toBeUndefined();
    expect(publishingAppOf(undefined)).toBeUndefined();
  });

  it('the MCP bearer is read the same way', () => {
    expect(publishingAppOfVerifiedToken(jwt({ roles: ['app'], app: 'bob/tool.html' }))).toBe('bob/tool.html');
    expect(publishingAppOfVerifiedToken(jwt({ roles: ['agent'], sub: 'a#alice@n' }))).toBeUndefined();
    expect(publishingAppOfVerifiedToken('not-a-jwt')).toBeUndefined();
    expect(publishingAppOfVerifiedToken(undefined)).toBeUndefined();
  });

  it('another author\'s app is somebody else\'s; the owner\'s own app is not', () => {
    expect(byAnotherAuthorsApp('bob/tool.html', 'alice')).toBe(true);
    expect(byAnotherAuthorsApp('alice/tool.html', 'alice')).toBe(false);
    expect(byAnotherAuthorsApp('Alice/tool.html', 'alice')).toBe(false);
    expect(byAnotherAuthorsApp(undefined, 'alice')).toBe(false);
  });
});
