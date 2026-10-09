/**
 * @file test/unit/passkey-origin.test.ts
 * @description passkeyOriginAllowed: where a passkey signing ceremony may come from. The node's own
 *   address and the configured extras, and, when apps have addresses of their own, an app under the
 *   app host with the node's scheme and port. Nothing else: not another site, not a look-alike host,
 *   not http beside an https node.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { describe, it, expect } from 'vitest';
import { passkeyOriginAllowed } from '../../src/services/passkeys.js';
import type { AimeatConfig } from '../../src/config.js';

const cfg = (o: Partial<AimeatConfig>) => ({ baseUrl: 'https://aimeat.io', passkeyExtraOrigins: [], appOriginEnabled: true, appHost: 'apps.aimeat.io', ...o }) as AimeatConfig;

describe('passkeyOriginAllowed', () => {
  it('takes the node itself and an app on its own address', () => {
    expect(passkeyOriginAllowed(cfg({}), 'https://aimeat.io')).toBe(true);
    expect(passkeyOriginAllowed(cfg({}), 'https://allekirjoitus.apps.aimeat.io')).toBe(true);
  });

  it('refuses another site, a look-alike, a scheme or port the node does not use', () => {
    expect(passkeyOriginAllowed(cfg({}), 'https://evil.example')).toBe(false);
    expect(passkeyOriginAllowed(cfg({}), 'https://allekirjoitus.apps.aimeat.io.evil.example')).toBe(false);
    expect(passkeyOriginAllowed(cfg({}), 'https://xapps.aimeat.io')).toBe(false);
    expect(passkeyOriginAllowed(cfg({}), 'http://allekirjoitus.apps.aimeat.io')).toBe(false);
    expect(passkeyOriginAllowed(cfg({}), 'https://allekirjoitus.apps.aimeat.io:8443')).toBe(false);
    expect(passkeyOriginAllowed(cfg({}), 'not a url')).toBe(false);
  });

  it('refuses app origins when apps have no addresses of their own', () => {
    expect(passkeyOriginAllowed(cfg({ appOriginEnabled: false }), 'https://allekirjoitus.apps.aimeat.io')).toBe(false);
  });

  it('a local node: its own http scheme and port', () => {
    const local = cfg({ baseUrl: 'http://localhost:40603', appHost: 'apps.localhost' });
    expect(passkeyOriginAllowed(local, 'http://allekirjoitus.apps.localhost:40603')).toBe(true);
    expect(passkeyOriginAllowed(local, 'http://allekirjoitus.apps.localhost:40604')).toBe(false);
  });
});
