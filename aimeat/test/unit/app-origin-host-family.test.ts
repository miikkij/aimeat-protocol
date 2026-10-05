/**
 * @file test/unit/app-origin-host-family.test.ts
 * @description appOriginHostFamily (services/app-origin-target.ts): the one test of which address
 *   family a host belongs to, which the grant redirect check and resolveAppOriginTarget both ask
 *   (secaudit 2026-10, C8).
 * @usage pnpm test -- app-origin-host-family
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C8).
 */
import { describe, it, expect } from 'vitest';
import { appOriginHostFamily } from '../../src/services/app-origin-target.js';

const config = {
  appHost: 'apps.example.org', portfolioOriginEnabled: true, portfolioHost: 'me.example.org',
  coOriginEnabled: true, coHost: 'co.example.org',
} as never;

describe('appOriginHostFamily', () => {
  it('names the family and the label of a one-label subdomain', () => {
    expect(appOriginHostFamily(config, 'notes.apps.example.org')).toEqual({ family: 'app', label: 'notes' });
    expect(appOriginHostFamily(config, 'Alice.me.example.org')).toEqual({ family: 'portfolio', label: 'alice' });
    expect(appOriginHostFamily(config, 'acme.co.example.org')).toEqual({ family: 'co', label: 'acme' });
  });

  it('refuses the bare family host, a deeper subdomain, a look-alike and another site', () => {
    for (const host of ['apps.example.org', 'co.example.org', 'a.b.apps.example.org', 'evilapps.example.org', 'example.org', 'notes.apps.example.org.evil.test']) {
      expect(appOriginHostFamily(config, host)).toBeNull();
    }
  });

  it('ignores a family the node has switched off', () => {
    expect(appOriginHostFamily({ ...(config as object), coOriginEnabled: false } as never, 'acme.co.example.org')).toBeNull();
  });
});
