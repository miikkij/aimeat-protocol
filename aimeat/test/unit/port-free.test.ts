/**
 * @file test/unit/port-free.test.ts
 * @description A port is free only when NOTHING on this machine holds it, on any address.
 *
 *   The sandbox asked the wildcard address and `localhost`. On Windows a wildcard bind succeeds
 *   while another process holds 127.0.0.1 on that port, and `localhost` may resolve to ::1, where
 *   nobody answers: so a port another session's node was listening on at 127.0.0.1 read as free.
 *   A second node started there, requests to 127.0.0.1 went to the FIRST one (the more specific
 *   bind wins), a publish was answered with another session's page, and the seeding failed on
 *   "token undefined". Reported by a build session on 2026-09-19 (port 40605).
 * @usage cd aimeat && pnpm vitest run test/unit/port-free.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { portIsFree } from '../../scripts/lib/port-free.js';

const open: Server[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => new Promise<void>(r => s.close(() => r())))); });

function hold(host: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, host, () => { open.push(s); resolve((s.address() as { port: number }).port); });
  });
}

describe('a port somebody holds', () => {
  it('on 127.0.0.1 only, which is the case the wildcard probe missed', async () => {
    expect(await portIsFree(await hold('127.0.0.1'))).toBe(false);
  });
  it('on the wildcard address', async () => {
    expect(await portIsFree(await hold(undefined))).toBe(false);
  });
});

describe('a port nobody holds', () => {
  it('is free, and stays bindable afterwards', async () => {
    const port = await hold('127.0.0.1');
    await new Promise<void>(r => open.pop()!.close(() => r()));
    expect(await portIsFree(port)).toBe(true);
    expect(await hold('127.0.0.1').then(() => true)).toBe(true);
  });
});
