/**
 * @file test/unit/same-origin-path.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is an address a path of THIS node, the way a browser reads it: the helper in
 *   src/utils/same-origin-path.ts, and every door that sends a person's browser to an address a
 *   request named, or shows them a link to follow.
 *
 *   The doors are asserted here beside the helper, and not only the helper, because the defect was
 *   never in one function: the same `startsWith('/') && !startsWith('//')` was written out in seven
 *   places, and each admitted `/\evil.example`, which a browser reads as `//evil.example`. The
 *   route-level arms live with their routes (account-events.test.ts, e2e-mcp-proxy.ts).
 * @usage cd aimeat && pnpm exec vitest run test/unit/same-origin-path.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09 A2-3, A5-5).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { isSameOriginPath, safeRedirectPath } from '../../src/utils/same-origin-path.js';
import { safeNotificationLink } from '../../src/services/extension-notify.js';
import { isSafeNotifActionEndpoint } from '../../src/services/notify.js';
import { createPrincipalNotification } from '../../src/services/notification-create.js';

/** Each of these is `//evil.example` to a browser: another site. */
const OFF_SITE = [
  '//evil.example/x', '/\\evil.example/x', '/\\/evil.example', '\\\\evil.example',
  '/\t/evil.example', '/\n/evil.example', '/\r\n/evil.example',
];

describe('isSameOriginPath and safeRedirectPath', () => {
  it('keep a path of this node', () => {
    for (const path of ['/', '/spa.html#access', '/profile?tab=access&x=1', '/v1/apps/a/b.html?mode=inline']) {
      expect(isSameOriginPath(path), path).toBe(true);
      expect(safeRedirectPath(path)).toBe(path);
    }
  });

  it('refuse every address a browser resolves to another site', () => {
    for (const raw of [...OFF_SITE, 'https://evil.example/x', 'evil.example', '', 42, null, undefined]) {
      expect(isSameOriginPath(raw), JSON.stringify(raw)).toBe(false);
      expect(safeRedirectPath(raw), JSON.stringify(raw)).toBe('/');
    }
  });

  it('refuse a backslash or a control character anywhere, since no path of ours holds one', () => {
    for (const raw of ['/x\\..\\evil', '/spa.html#a\\b', '/a\u0000b', '/a\u007fb', '/a\u001bb']) {
      expect(isSameOriginPath(raw), JSON.stringify(raw)).toBe(false);
    }
  });

  it('answer with the fallback the caller names', () => {
    expect(safeRedirectPath('//evil.example', '/profile#access')).toBe('/profile#access');
    expect(safeRedirectPath(undefined, '/profile#access')).toBe('/profile#access');
    // An empty fallback lets a caller tell "no safe address" apart from "go to the root".
    expect(safeRedirectPath('/\\evil.example', '')).toBe('');
    expect(safeRedirectPath('/spa.html#access', '')).toBe('/spa.html#access');
  });
});

describe('the links a notification carries', () => {
  const config = {
    nodeId: 'test-node-001', baseUrl: 'https://node.example', appHost: 'apps.node.example',
  } as unknown as AimeatConfig;

  it("an extension's link: a path of this node, an app origin of this node, or the fallback", () => {
    const fallback = '/v1/profile?tab=extensions';
    expect(safeNotificationLink(config, '/v1/profile?tab=agents', fallback)).toBe('/v1/profile?tab=agents');
    expect(safeNotificationLink(config, 'https://shop.apps.node.example/x', fallback))
      .toBe('https://shop.apps.node.example/x');
    for (const link of OFF_SITE) {
      expect(safeNotificationLink(config, link, fallback), JSON.stringify(link)).toBe(fallback);
    }
  });

  it("an action's endpoint or link is a path of this node, or it is refused", () => {
    expect(isSafeNotifActionEndpoint('/v1/agents/pending/approve')).toBe(true);
    for (const path of OFF_SITE) {
      expect(isSafeNotifActionEndpoint(path), JSON.stringify(path)).toBe(false);
    }
  });

  it('a principal notifying its own owner gives a path of this node, or is refused', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const auth = { owner: 'alice', sub: 'alice', roles: ['owner'] };
    for (const link of OFF_SITE) {
      await expect(createPrincipalNotification(storage, config, auth, { title: 'Hello', link }),
        JSON.stringify(link)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    }
  });
});
