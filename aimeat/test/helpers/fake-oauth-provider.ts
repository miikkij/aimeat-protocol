/**
 * @file fake-oauth-provider.ts
 * @description A real HTTP OAuth2 provider for the connection E2E (TARGET-057). Not a mock: the
 *   node talks to it over the network through safeFetch, so the tests exercise the actual
 *   authorization round rather than a stub of it.
 *
 *   IT ROTATES THE REFRESH TOKEN AND RETIRES THE OLD ONE. That is the whole reason it exists.
 *   Concurrent refresh is only destructive against a provider that behaves this way, and a stub
 *   that keeps returning the same token would let the single-flight guard be deleted without a
 *   single test going red.
 *
 *   It also counts what it was asked to do, so a test can assert "the provider was called ONCE"
 *   rather than inferring it from the absence of an error — which is how a double refresh hides.
 * @structure startFakeProvider(): { baseUrl, stats, close, expireAccessTokens, breakRefresh }
 * @usage const p = await startFakeProvider(); process.env.AIMEAT_CONNECT_FAKE_BASE_URL = p.baseUrl;
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 2.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

interface Grant {
  subject: string;
  accessToken: string;
  refreshToken: string;
  /** Retired refresh tokens. Presenting one is the failure mode single-flight prevents. */
  retired: Set<string>;
  revoked: boolean;
}

export interface FakeProvider {
  baseUrl: string;
  stats: {
    tokenExchanges: number;
    refreshes: number;
    /** Refresh attempts that presented an already-rotated token. Must stay 0 under single flight. */
    staleRefreshAttempts: number;
    revocations: number;
    identityLookups: number;
    /** Secrets exchanged for a session, and pairs refused. */
    sessionMints: number;
    sessionRejections: number;
    /** Publishes accepted, content refusals, and the byte count the last publish carried. */
    publishes: number;
    contentRejections: number;
    lastPublishBytes: number;
  };
  /** Seconds the next issued access token lasts. Set to 0 to force the refresh path. */
  accessTokenTtlSeconds: number;
  /** When true, every refresh answers 400 — the "grant is gone" case. */
  breakRefresh: boolean;
  /** When true, a publish is refused as CONTENT — permanent, and must never be retried. */
  rejectContent: boolean;
  /** Milliseconds a refresh takes, so a test can create a real overlap between two callers. */
  refreshDelayMs: number;
  close(): Promise<void>;
}

function body(req: import('node:http').IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(new URLSearchParams(raw)));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Start the provider on an ephemeral loopback port.
 *
 * A code is `code-<subject>`; whatever subject the test names is who the token belongs to. That
 * keeps the tests readable and lets one test hold two accounts at the same provider, which is what
 * the dedupe key has to survive.
 */
export async function startFakeProvider(port = 0): Promise<FakeProvider> {
  const grants = new Map<string, Grant>();          // accessToken  → grant
  const byRefresh = new Map<string, Grant>();       // refreshToken → grant

  const state: FakeProvider = {
    baseUrl: '',
    stats: { tokenExchanges: 0, refreshes: 0, staleRefreshAttempts: 0, revocations: 0, identityLookups: 0, sessionMints: 0, sessionRejections: 0, publishes: 0, contentRejections: 0, lastPublishBytes: 0 },
    accessTokenTtlSeconds: 3600,
    breakRefresh: false,
    rejectContent: false,
    refreshDelayMs: 0,
    close: async () => { /* replaced below */ },
  };

  const issue = (subject: string, previous?: Grant): Grant => {
    const g: Grant = {
      subject,
      accessToken: `at-${randomUUID()}`,
      refreshToken: `rt-${randomUUID()}`,
      retired: previous ? new Set([...previous.retired, previous.refreshToken]) : new Set(),
      revoked: false,
    };
    grants.set(g.accessToken, g);
    byRefresh.set(g.refreshToken, g);
    if (previous) {
      // The rotation, made real: the old refresh token is retired rather than left working.
      grants.delete(previous.accessToken);
      byRefresh.delete(previous.refreshToken);
      for (const old of g.retired) byRefresh.set(old, g);
    }
    return g;
  };

  const json = (res: import('node:http').ServerResponse, status: number, payload: unknown): void => {
    const s = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
    res.end(s);
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/token' && req.method === 'POST') {
        const form = await body(req);
        const grantType = form.get('grant_type');

        if (grantType === 'authorization_code') {
          const code = form.get('code') ?? '';
          if (!code.startsWith('code-')) return json(res, 400, { error: 'invalid_grant' });
          // PKCE is sent by the node; its presence is asserted rather than verified, because the
          // thing under test is that the node keeps and sends the verifier at all.
          if (!form.get('code_verifier')) return json(res, 400, { error: 'missing_code_verifier' });
          state.stats.tokenExchanges++;
          const g = issue(code.slice('code-'.length));
          return json(res, 200, {
            access_token: g.accessToken, refresh_token: g.refreshToken,
            expires_in: state.accessTokenTtlSeconds, scope: 'publish',
          });
        }

        if (grantType === 'refresh_token') {
          if (state.refreshDelayMs) await sleep(state.refreshDelayMs);
          if (state.breakRefresh) return json(res, 400, { error: 'invalid_grant' });
          const presented = form.get('refresh_token') ?? '';
          const g = byRefresh.get(presented);
          if (!g || g.revoked) return json(res, 400, { error: 'invalid_grant' });
          if (g.retired.has(presented)) {
            // A second caller arriving with a token the first one already rotated away. Counted
            // rather than merely refused, so a test can assert this NEVER happens.
            state.stats.staleRefreshAttempts++;
            return json(res, 400, { error: 'invalid_grant', error_description: 'refresh token already used' });
          }
          state.stats.refreshes++;
          const next = issue(g.subject, g);
          return json(res, 200, {
            access_token: next.accessToken, refresh_token: next.refreshToken,
            expires_in: state.accessTokenTtlSeconds,
          });
        }
        return json(res, 400, { error: 'unsupported_grant_type' });
      }

      // The consent page, as a real provider has one: it redirects back to the caller's callback
      // with a code. A browser-driven test needs this to exist; an API-driven one calls the
      // callback directly and never comes here.
      if (url.pathname === '/authorize' && req.method === 'GET') {
        const redirect = url.searchParams.get('redirect_uri') ?? '';
        const st = url.searchParams.get('state') ?? '';
        const subject = url.searchParams.get('login_hint') ?? 'browser';
        const back = new URL(redirect);
        back.searchParams.set('code', `code-${subject}`);
        back.searchParams.set('state', st);
        res.writeHead(302, { Location: back.toString() });
        res.end();
        return;
      }

      // A publish target, so the route -- gate, credential, recipe, outcome -- can be driven end to
      // end without touching anyone's real account.
      if (url.pathname === '/publish' && req.method === 'POST') {
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const g = grants.get(token);
        if (!g || g.revoked) return json(res, 401, { error: 'invalid_token' });
        const raw = await new Promise<Buffer>((resolve) => {
          const parts: Buffer[] = [];
          req.on('data', (c: Buffer) => parts.push(c));
          req.on('end', () => resolve(Buffer.concat(parts)));
        });
        if (state.rejectContent) {
          state.stats.contentRejections++;
          return json(res, 422, { error: 'content_rejected', detail: 'the test provider will not take this' });
        }
        state.stats.publishes++;
        state.stats.lastPublishBytes = raw.length;
        return json(res, 200, { url: `https://test.example/${g.subject}/${state.stats.publishes}` });
      }

      if (url.pathname === '/revoke' && req.method === 'POST') {
        const form = await body(req);
        const token = form.get('token') ?? '';
        const g = byRefresh.get(token) ?? grants.get(token);
        if (g) { g.revoked = true; state.stats.revocations++; }
        return json(res, 200, {});
      }

      if (url.pathname === '/me' && req.method === 'GET') {
        state.stats.identityLookups++;
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const g = grants.get(token);
        if (!g || g.revoked) return json(res, 401, { error: 'invalid_token' });
        return json(res, 200, { id: g.subject, label: `Test account ${g.subject}` });
      }

      // ── The session-shaped half: a credential the user SUPPLIES, no authorization round ──
      // Mirrors AT Proto's shape closely enough to prove the path: a secret is exchanged for a
      // session, the session refreshes with the refresh token as a BEARER, and the secret keeps
      // working afterwards so a dead session can be re-minted.
      if (url.pathname === '/session' && req.method === 'POST') {
        const raw = await new Promise<string>((resolve) => {
          let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b));
        });
        let parsed: { identifier?: unknown; password?: unknown };
        try { parsed = JSON.parse(raw) as typeof parsed; } catch { return json(res, 400, { error: 'bad_json' }); }
        const identifier = typeof parsed.identifier === 'string' ? parsed.identifier : '';
        const password = typeof parsed.password === 'string' ? parsed.password : '';
        // One wrong secret, so a test can prove the refusal message rather than only the success.
        if (!identifier || password !== 'good-secret') {
          state.stats.sessionRejections++;
          return json(res, 401, { error: 'invalid_credentials' });
        }
        state.stats.sessionMints++;
        const g = issue(identifier);
        return json(res, 200, {
          accessJwt: g.accessToken, refreshJwt: g.refreshToken,
          did: `did:test:${identifier}`, handle: identifier,
        });
      }

      if (url.pathname === '/xrpc/com.atproto.server.refreshSession' && req.method === 'POST') {
        const presented = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const g = byRefresh.get(presented);
        if (!g || g.revoked || g.retired.has(presented) || state.breakRefresh) {
          return json(res, 400, { error: 'ExpiredToken' });
        }
        state.stats.refreshes++;
        const next = issue(g.subject, g);
        return json(res, 200, { accessJwt: next.accessToken, refreshJwt: next.refreshToken });
      }

      // The Mastodon-shaped registration endpoint, so the lazy per-instance path can be driven
      // against a real server too.
      if (url.pathname === '/api/v1/apps' && req.method === 'POST') {
        await body(req);
        return json(res, 200, { client_id: `cid-${randomUUID()}`, client_secret: `cs-${randomUUID()}` });
      }

      json(res, 404, { error: 'not_found' });
    })();
  });

  // A FIXED port when one is given: the node reads its provider base URL from the environment at
  // boot, before this server exists, so the two can only meet on a port agreed in advance.
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : 0;
  state.baseUrl = `http://127.0.0.1:${bound}`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}
