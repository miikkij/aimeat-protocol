/**
 * @file test/unit/sdk-public-fetch.test.ts
 * @description The SDK libs' public read (sdk-libs/_core/public-fetch.js) works on a node that shows
 *   its content to its own signed-in accounts only, and changes nothing on an open node.
 *
 *   On such a node a read without a session answers 401 SIGN_IN_REQUIRED, so an app opened by a
 *   signed-in person lost its config (AIMEAT.data.appConfig) and its WebMCP tools (signed-in browser
 *   audit, 2026-10-19). The read is sent again with the page's session, and later reads send it first.
 * @structure open node: one plain request · signed-in-only node: refusal, then the session · no session: the refusal stands · other 401s are not retried
 * @usage pnpm exec vitest run test/unit/sdk-public-fetch.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Call = { url: string; auth: string | null };
const refusal = (code: string) => new Response(JSON.stringify({ ok: false, error: { code, message: 'x' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
const fine = () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });

let calls: Call[];
function stubFetch(answer: (c: Call) => Response) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const c = { url, auth: new Headers(init?.headers).get('Authorization') };
    calls.push(c);
    return answer(c);
  });
}
function stubSession(jwt: string | null) {
  vi.stubGlobal('window', { AIMEAT: { auth: { getSession: () => (jwt ? { jwt } : null) } } });
}
/** A fresh module each test: the "node refuses reads without a session" flag is module state. */
async function load() {
  vi.resetModules();
  return import('../../src/static/sdk-libs/_core/public-fetch.js');
}

describe('publicFetch', () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('on an open node sends one plain request, session or not', async () => {
    stubSession('tok');
    stubFetch(() => fine());
    const { publicFetch } = await load();
    const r = await publicFetch('/v1/apps/a/b.html/config');
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ url: '/v1/apps/a/b.html/config', auth: null }]);
  });

  it('on a signed-in-only node sends the read again with the session, and the session first from then on', async () => {
    stubSession('tok');
    stubFetch((c) => (c.auth ? fine() : refusal('SIGN_IN_REQUIRED')));
    const { publicFetch } = await load();
    expect((await publicFetch('/v1/apps/a/b.html/webmcp')).status).toBe(200);
    expect((await publicFetch('/v1/commerce/feed', { headers: { Accept: 'application/json' } })).status).toBe(200);
    expect(calls.map(c => c.auth)).toEqual([null, 'Bearer tok', 'Bearer tok']);
  });

  it('FAILURE: with nobody signed in the refusal stands, and nothing is retried', async () => {
    stubSession(null);
    stubFetch(() => refusal('SIGN_IN_REQUIRED'));
    const { publicFetch } = await load();
    const r = await publicFetch('/v1/apps/a/b.html/config');
    expect(r.status).toBe(401);
    expect(((await r.json()) as any).error.code).toBe('SIGN_IN_REQUIRED');
    expect(calls).toHaveLength(1);
  });

  it('FAILURE: another 401 (an expired token) is not retried with the session', async () => {
    stubSession('tok');
    stubFetch(() => refusal('UNAUTHORIZED'));
    const { publicFetch } = await load();
    expect((await publicFetch('/v1/memory/a/k')).status).toBe(401);
    expect(calls).toHaveLength(1);
  });
});
