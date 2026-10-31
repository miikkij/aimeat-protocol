/**
 * @file test/unit/openhands-nginx-runtime-route.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The OpenHands bundle's nginx example forwards /runtime-<port> to the host's docker0
 *   address without Basic Auth. It reaches only the port range OpenHands publishes runtime containers
 *   on (30000-59999) and refuses the AIMEAT node's port inside it; any other /runtime-<n> falls to the
 *   Basic Auth location. Read from the file itself: its runtime location regex (PCRE, the same syntax
 *   as a JavaScript regex here) and its refusal lines (secaudit2026oct31w2 round 10,
 *   openhands.conf.example:runtime-location-proxies-any-host-port-without-auth).
 * @usage cd aimeat && pnpm exec vitest run test/unit/openhands-nginx-runtime-route.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const conf = readFileSync(resolve(__dirname, '../../../tools/aimeat-openhands/nginx/openhands.conf.example'), 'utf8');
const block = /location ~ "?(\^\/runtime-[^"\s]+)"? \{([\s\S]*?)\n {4}\}/.exec(conf);
const route = new RegExp(block![1]!);
const refused = [...block![2]!.matchAll(/if \(\$rt_port = (\d+)\) \{ return 404; \}/g)].map((m) => m[1]);
const auth = /auth_basic off;/.test(block![2]!);

/** What nginx does with a request path: forwarded to which port without auth, refused, or sent on to Basic Auth. */
function outcome(path: string): string {
  const m = route.exec(path);
  if (!m) return 'basic-auth';
  if (refused.includes(m.groups!.rt_port!)) return '404';
  return auth ? `forward:${m.groups!.rt_port}` : 'basic-auth';
}

describe('/runtime-<port> outside the runtime range', () => {
  it('a host service on another port is not reached without Basic Auth', () => {
    expect(outcome('/runtime-18080/')).toBe('basic-auth');
    expect(outcome('/runtime-22/')).toBe('basic-auth');
    expect(outcome('/runtime-5432/')).toBe('basic-auth');
    expect(outcome('/runtime-13781/')).toBe('basic-auth');
    expect(outcome('/runtime-60000/')).toBe('basic-auth');
    expect(outcome('/runtime-123456/')).toBe('basic-auth');
  });
  it('the AIMEAT node port inside the range is refused', () => {
    expect(outcome('/runtime-40050/v1/build')).toBe('404');
  });
});

describe('runtime containers keep working', () => {
  it('agent server, VS Code and app ports are forwarded without Basic Auth, with their path', () => {
    expect(outcome('/runtime-30000/')).toBe('forward:30000');
    expect(outcome('/runtime-35123/api/conversations')).toBe('forward:35123');
    expect(outcome('/runtime-41234/')).toBe('forward:41234');
    expect(outcome('/runtime-56743/sockets/events')).toBe('forward:56743');
    expect(outcome('/runtime-59999')).toBe('forward:59999');
    expect(route.exec('/runtime-35123/api/x')!.groups!.rt_path).toBe('/api/x');
  });
});
