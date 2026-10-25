/**
 * @file app-grant-auto.test.ts
 * @description When the app-grant consent page approves with no screen (public/views/app-grant-auto.js).
 *   An unbound request (its redirect is not the requesting app's own address) shows the screen even
 *   when the person's live grant covers every scope, because the code goes to whoever the redirect
 *   names (secaudit2026oct22, app-grants/unbound-bare-app-host-redirect-auto-approved). A bound
 *   request with a covering grant, and the owner's own bound app, still approve with no screen.
 * @usage pnpm exec vitest run test/unit/app-grant-auto.test.ts
 * @version-history
 *   2026-10-25 — The owner's own app asks for words its grant lacks after a delegate's publish or a hand narrowing.
 *   2026-10-24 — Initial (secaudit2026oct22).
 */
import { describe, expect, it } from 'vitest';
import { isOwnApp, autoApproves } from '../../public/views/app-grant-auto.js';

const scopes = (...names: string[]) => names.map((scope) => ({ scope }));
const grant = { scopes: ['memory:read', 'memory:write'] };

describe('the consent page approves with no screen', () => {
  it('an unbound request with a covering grant shows the screen', () => {
    const request = { app: 'alice/x.html', app_owner: 'alice', origin_bound: false, manage: false, scopes: scopes('memory:read') };
    expect(autoApproves(request, 'bob', grant)).toBe(false);
  });

  it('a bound request with a covering grant approves with no screen', () => {
    const request = { app: 'alice/x.html', app_owner: 'alice', origin_bound: true, manage: false, scopes: scopes('memory:read') };
    expect(autoApproves(request, 'bob', grant)).toBe(true);
  });

  it('a bound request that asks for more than the grant holds shows the screen', () => {
    const request = { app: 'alice/x.html', app_owner: 'alice', origin_bound: true, manage: false, scopes: scopes('memory:read', 'ai:use') };
    expect(autoApproves(request, 'bob', grant)).toBe(false);
  });

  it('the owner\'s own bound app approves with no grant; unbound or package-installed it does not', () => {
    const own = { app: 'alice/x.html', app_owner: 'alice', origin_bound: true, manage: false, scopes: scopes('ai:use') };
    expect(isOwnApp(own, 'alice')).toBe(true);
    expect(autoApproves(own, 'alice', null)).toBe(true);
    expect(isOwnApp({ ...own, origin_bound: false }, 'alice')).toBe(false);
    expect(autoApproves({ ...own, origin_bound: false }, 'alice', null)).toBe(false);
    expect(autoApproves({ ...own, package_app: true }, 'alice', null)).toBe(false);
  });

  it('the owner\'s own app shows the screen for a word its grant lacks when a delegate published it or the owner narrowed the grant', () => {
    const own = { app: 'alice/x.html', app_owner: 'alice', origin_bound: true, manage: false, scopes: scopes('memory:read', 'ai:use') };
    expect(autoApproves({ ...own, published_by_other: 'bob@n' }, 'alice', grant)).toBe(false);
    expect(autoApproves({ ...own, published_by_other: 'bob@n' }, 'alice', null)).toBe(false);
    expect(autoApproves(own, 'alice', { ...grant, scopes_fixed_at: '2026-10-25T00:00:00Z' })).toBe(false);
    // What the grant holds still approves with no screen, and so does the owner's own version.
    expect(autoApproves({ ...own, scopes: scopes('memory:read'), published_by_other: 'bob@n' }, 'alice', grant)).toBe(true);
    expect(autoApproves(own, 'alice', grant)).toBe(true);
  });

  it('manage mode always shows the screen', () => {
    const request = { app: 'alice/x.html', app_owner: 'alice', origin_bound: true, manage: true, scopes: scopes('memory:read') };
    expect(autoApproves(request, 'alice', grant)).toBe(false);
    expect(autoApproves(request, 'bob', grant)).toBe(false);
  });
});
