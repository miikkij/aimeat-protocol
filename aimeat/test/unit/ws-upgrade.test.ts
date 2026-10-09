/**
 * @file test/unit/ws-upgrade.test.ts
 * @description The upgrade credential reader (src/auth/ws-upgrade.ts), with the token check stubbed:
 *   which of the three credential forms wins, that a ticket is spent once and opens one socket kind,
 *   and that the deprecated ?token= is refused when switched off, counted when taken, and logged at
 *   most once a day without the token or the URL. Secrets audit 2026-10-09, d3. The same rules run
 *   against a live node in e2e-realtime-rooms, e2e-personal-tunnel and e2e-connect-tunnel.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';

const warn = vi.fn();
const incrementTyped = vi.fn();
vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/stats.js', () => ({
  getStats: () => ({ incrementTyped: (...a: unknown[]) => incrementTyped(...a) }),
}));
// Every token "verifies" to a principal named after it, except 'bad'; 'revoked' is revoked.
vi.mock('../../src/auth/jwt.js', () => ({
  verifyJWT: async (t: string) => (t === 'bad' ? null : { sub: `sub-of-${t}`, owner: 'o', node: 'n', roles: ['owner'], exp: 0 }),
}));
vi.mock('../../src/auth/middleware.js', () => ({
  credentialRevoked: async (t: string) => t === 'revoked',
}));

import { authenticateUpgrade, mintSocketTicket, refuseUpgrade } from '../../src/auth/ws-upgrade.js';

function req(query: string, authorization?: string): { request: IncomingMessage; url: URL } {
  const url = new URL(`http://node.test/v1/realtime/ws?${query}`);
  return { request: { headers: authorization ? { authorization } : {} } as IncomingMessage, url };
}

describe('authenticateUpgrade', () => {
  beforeEach(() => { warn.mockClear(); incrementTyped.mockClear(); });

  it('takes the Authorization header first, and nothing is counted', async () => {
    const { request, url } = req('token=q', 'Bearer h');
    const a = await authenticateUpgrade(request, url, 'realtime', true);
    expect(a).toMatchObject({ outcome: 'verified', token: 'h', via: 'header' });
    expect(incrementTyped).not.toHaveBeenCalled();
  });

  it('spends a ticket once, for its own socket kind only', async () => {
    const t = mintSocketTicket('realtime', 'tk', 'sub-of-tk');
    const first = await authenticateUpgrade(req(`ticket=${t}`).request, req(`ticket=${t}`).url, 'realtime', true);
    expect(first).toMatchObject({ outcome: 'verified', token: 'tk', via: 'ticket' });
    const again = await authenticateUpgrade(req(`ticket=${t}`).request, req(`ticket=${t}`).url, 'realtime', true);
    expect(again).toMatchObject({ outcome: 'refused', status: 401, code: 'INVALID_TICKET' });

    const other = mintSocketTicket('personal-tunnel', 'tk', 'sub-of-tk');
    const wrong = await authenticateUpgrade(req(`ticket=${other}`).request, req(`ticket=${other}`).url, 'realtime', true);
    expect(wrong).toMatchObject({ outcome: 'refused', code: 'TICKET_WRONG_SOCKET' });
  });

  it('re-verifies the token behind a ticket: a revoked one opens nothing', async () => {
    const t = mintSocketTicket('connect-tunnel', 'revoked', 'sub-of-revoked');
    const a = await authenticateUpgrade(req(`ticket=${t}`).request, req(`ticket=${t}`).url, 'connect-tunnel', true);
    expect(a).toMatchObject({ outcome: 'refused', code: 'CREDENTIAL_REVOKED' });
  });

  it('refuses ?token= with WS_QUERY_TOKEN_DISABLED when switched off, and counts nothing', async () => {
    const { request, url } = req('token=q');
    const a = await authenticateUpgrade(request, url, 'personal-tunnel', false);
    expect(a).toMatchObject({ outcome: 'refused', status: 401, code: 'WS_QUERY_TOKEN_DISABLED' });
    expect(incrementTyped).not.toHaveBeenCalled();
  });

  it('counts each accepted ?token= by socket kind, and logs once a day without the token', async () => {
    const secret = 'canary-jwt-9d1e';
    for (let i = 0; i < 3; i++) {
      const { request, url } = req(`token=${secret}`);
      const a = await authenticateUpgrade(request, url, 'connect-tunnel', true);
      expect(a).toMatchObject({ outcome: 'verified', via: 'query' });
    }
    expect(incrementTyped).toHaveBeenCalledTimes(3);
    expect(incrementTyped).toHaveBeenCalledWith('ws_query_token', 'connect-tunnel');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });

  it('answers none when there is no credential, and refuses a token that does not verify', async () => {
    expect(await authenticateUpgrade(req('room=r').request, req('room=r').url, 'realtime', true)).toEqual({ outcome: 'none' });
    expect(await authenticateUpgrade(req('token=bad').request, req('token=bad').url, 'realtime', true))
      .toMatchObject({ outcome: 'refused', code: 'INVALID_TOKEN' });
  });
});

describe('refuseUpgrade', () => {
  it('writes the status, the X-AIMEAT-Error header and the envelope, then closes', () => {
    const socket = new PassThrough();
    let written = '';
    socket.on('data', (c: Buffer) => { written += c.toString(); });
    const destroy = vi.spyOn(socket, 'destroy');
    refuseUpgrade(socket, 401, 'INVALID_TICKET', 'spent');
    expect(written.startsWith('HTTP/1.1 401 Unauthorized\r\n')).toBe(true);
    expect(written).toContain('X-AIMEAT-Error: INVALID_TICKET\r\n');
    expect(written).toContain('{"ok":false,"error":{"code":"INVALID_TICKET","message":"spent"}}');
    expect(destroy).toHaveBeenCalled();
  });
});
