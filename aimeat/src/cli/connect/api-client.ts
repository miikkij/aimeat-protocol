/**
 * @file api-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HTTP client for AIMEAT node API with automatic auth header injection.
 * @structure Wraps fetch, response-envelope handling, and stored-token based client
 *   construction. `Transport` is the pluggable seam: the default transport does a
 *   direct `fetch` with `Connection: close` (one-shot CLI behavior); the serve
 *   daemon swaps in a tunnel transport (`ConnectTunnelClient.forward`) so every
 *   MCP tool call flows over the single persistent WS without per-tool changes.
 * @usage Imported by `aimeat connect` subcommands and MCP tools.
 * @version-history
 *   v1.5.0 -- 2026-09-07 -- The retry asks the right store. v1.4.0 paired `forgetCachedToken`
 *     (agent-key.ts's mint cache) with `keychain.getToken` (the stored-bearer FILE), which that
 *     cache has nothing to do with -- so a v2 agent, holding a key and no bearer, got null back and
 *     skipped the retry, and a v1 agent got the identical string and skipped it too. Third version
 *     of this retry and the third way of not firing, which is why it now has a test that counts
 *     dispatches instead of a reading of the source: test/unit/connect-scope-retry.test.ts, seven
 *     cases, two of which fail on the v1.4.0 pairing. `resolveToken` is the pair `forgetCachedToken`
 *     exists for, and it is what local-server.ts and acp/index.ts already call. Its MintFailedError
 *     is caught here: a refusal handed back as an exception is a worse answer than the refusal.
 *   v1.4.0 -- 2026-09-07 -- The SCOPE_DENIED retry, done the way v1.3.0 could not. `send()` is now
 *     a guard around `dispatch()`, so the ONE retry sits in front of both the tunnel and the direct
 *     fetch rather than after the transport's early return. The anti-amplification guard is a single
 *     attempt per call, never a token-string comparison: a fresh JWT differs in `iat` and `jti`
 *     every time, so that comparison could not fire. A client that does not know whose credential
 *     it holds skips the retry and returns the refusal unchanged. Asked for by crewaimeat on
 *     2026-09-06, after an owner granted a scope three times in one evening and the only thing that
 *     made it take effect was killing the shared serve daemon.
 *   v1.3.0 -- 2026-09-06 -- A SCOPE_DENIED retry was added here and removed the same day. It sat
 *     AFTER the transport branch, which returns first, so it could not run on the tunnel -- the path
 *     the bug was reported on -- and where it did run it re-minted on every refused call, because a
 *     fresh JWT is never the same string as the one it replaces. A stale pin is replaced by
 *     re-attaching on the tunnel (tunnel-client.ts), which is where the node's copy actually lives.
 *   v1.10.0 — 2026-09-01 — `lastStatus`: the HTTP status of the most recent call. The loopback
 *     dispatcher behind /v1/invoke needs it to hand back the SAME refusal the target route
 *     gave; without it every refusal came back as 400. Additive — nothing else reads it.
 *   v1.9.4 — 2026-05-28 — Update connector guidance and close one-shot CLI HTTP connections.
 *   v2.0.0 — 2026-06-10 — Phase 4: Transport seam (direct fetch default, tunnel override).
 *   v2.1.0 — 2026-08-01 — TARGET-058 Phase 11b: ApiResponse models `meta`. It always arrived; not
 *     being in the type is why every tool handler dropped meta.provenance without anyone noticing.
 */
import { getToken } from './keychain.js';
import { loadConfig } from './config.js';
import { forgetCachedToken, resolveToken } from './agent-key.js';

export interface ApiResponse {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  /**
   * The envelope's `meta` slot. It has always ARRIVED — every transport here returns the parsed
   * envelope whole — but it was not in this type, so every `resp.data ?? resp` in a tool handler
   * dropped it and nothing complained.
   *
   * That matters because `meta.provenance` is the ONE carrier the AI-provenance work froze for a
   * response that IS a piece of generated content (22-frozen-vocabulary.md §A4). `GET /v1/memory/:key`
   * serves the whole record there, and a crew reading its own content back through the connector got
   * only `ai_provenance_id` — the pointer, not the statement. TARGET-058 Phase 11b.
   */
  meta?: Record<string, unknown>;
}

/**
 * Pluggable request transport. `path` is always node-relative (`/v1/...`);
 * absolute URLs never reach a transport (they go direct — see `send()`).
 * Returns the HTTP status and the parsed (envelope) body.
 */
export interface Transport {
  request(method: string, path: string, opts?: { body?: unknown; query?: Record<string, string> }): Promise<{ status: number; body: unknown }>;
}

export class AimeatClient {
  private baseUrl: string;
  private token: string | null = null;
  private transport: Transport | null = null;

  constructor(baseUrl: string, token?: string, identity?: { agent: string; owner: string }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token ?? null;
    this.agent = identity?.agent ?? null;
    this.owner = identity?.owner ?? null;
  }

  static async fromConfig(): Promise<AimeatClient> {
    const config = loadConfig();
    if (!config) throw new Error('Not configured. Run: npx aimeat connect');
    const token = await getToken(config.agent, config.owner);
    if (!token) throw new Error('No stored token. Run: npx aimeat connect');
    return new AimeatClient(config.node_url, token, { agent: config.agent, owner: config.owner });
  }

  /**
   * Whose credential this client carries. Needed to re-mint after a SCOPE_DENIED; a client that
   * does not know it simply skips the retry and returns the refusal, which is the old behaviour.
   */
  private agent: string | null;
  private owner: string | null;

  /** Name the identity on a client built by hand (the serve daemon builds one per registered agent). */
  setIdentity(agent: string, owner: string): void { this.agent = agent; this.owner = owner; }

  /**
   * The HTTP status of the most recent call, or 0 before the first one.
   *
   * `send()` returns the parsed envelope and nothing else, which is what every caller wants and is
   * why it was written that way. One caller needs more: the loopback dispatcher behind
   * `/v1/invoke` has to hand back the SAME refusal the target route gave, and a refusal without
   * its status is not the same refusal — it reported 400 where the route said 403, so a caller
   * could not tell "you are not allowed" from "you asked wrongly". Recording it here is additive:
   * nothing else reads it, and no existing call changes shape.
   */
  lastStatus = 0;

  /** Route subsequent requests through `t` (e.g. the tunnel). `null` restores direct fetch. */
  setTransport(t: Transport | null): void { this.transport = t; }
  hasTransport(): boolean { return this.transport !== null; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Connection: 'close' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Single dispatch point for every verb. Node-relative paths go through the
   * transport when one is set; absolute URLs (presigned uploads etc.) and the
   * default case use direct fetch with `Connection: close`.
   */
  private async send(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    const first = await this.dispatch(method, path, body);
    if (!this.isScopeDenied(first)) return first;

    // SCOPE_DENIED means the node compared our token's scopes against the agent's record and
    // refused. The record is the truth and the token is a snapshot, so a refusal on THIS code is
    // by definition a stale credential — the only remedy is a fresh one. Reported 2026-09-06:
    // an owner granted a scope three times in one evening and the only thing that made it take
    // effect was killing the shared serve daemon, because the mint is cached for `expires_in`.
    //
    // ONE retry, gated by a flag and never by comparing the two token strings. The version that
    // shipped and was removed on 2026-09-06 used that comparison as its anti-amplification guard,
    // and it can never fire: a freshly minted JWT differs from its predecessor in `iat` and `jti`
    // every single time. It also sat AFTER the transport branch below, so on the tunnel — the path
    // the bug was reported on — it never ran at all. This sits in front of BOTH paths.
    if (!this.agent || !this.owner) return first;
    forgetCachedToken(this.agent, this.owner);

    // resolveToken, NOT keychain.getToken. They are different stores, and pairing the wrong one
    // with `forgetCachedToken` is why this could not fire: the cache that was just dropped belongs
    // to agent-key.ts, and `keychain.getToken` reads the stored-bearer FILE, which it does not
    // touch. So a v2 agent -- a key on disk and no bearer at all, which is what a migrated fleet
    // runs on -- got null back and the retry was skipped, and a v1 agent got the identical string
    // and it was skipped too. Measured in test/unit/connect-scope-retry.test.ts: one dispatch, both
    // shapes. `resolveToken` is what every other credential consumer in the daemon already calls
    // (local-server.ts, acp/index.ts) and what `forgetCachedToken` exists to invalidate: it mints
    // for a key-holder and reads the file for a bearer, so this line does not have to know which.
    //
    // A v1 agent still does not retry, and that is right rather than a leftover -- a stored bearer
    // cannot be re-minted, so a second attempt would carry the same refused token. The connector
    // says so on `scopes_changed`: an ADDED permission needs `aimeat connect` re-run.
    let fresh: string | null;
    try {
      fresh = await resolveToken(this.agent, this.owner, this.baseUrl);
    } catch {
      // A mint that failed is not a credential that does not exist (MintFailedError). Either way the
      // answer to THIS call is the refusal the node already gave: the caller asked whether it may do
      // something and it may not, and handing that back as an exception would be a worse answer than
      // the refusal itself.
      return first;
    }
    if (!fresh || fresh === this.token) return first;
    this.token = fresh;
    return this.dispatch(method, path, body);
  }

  /** True when the node refused this call for a scope the token does not carry. */
  private isScopeDenied(r: ApiResponse): boolean {
    return this.lastStatus === 403 && r?.ok === false && r?.error?.code === 'SCOPE_DENIED';
  }

  /** One attempt. Node-relative paths go through the transport when one is set. */
  private async dispatch(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    if (this.transport && !path.startsWith('http')) {
      const r = await this.transport.request(method, path, { body });
      this.lastStatus = r.status;
      return r.body as ApiResponse;
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
    this.lastStatus = res.status;
    return res.json() as Promise<ApiResponse>;
  }

  async get(path: string): Promise<ApiResponse> { return this.send('GET', path); }
  async post(path: string, body?: unknown): Promise<ApiResponse> { return this.send('POST', path, body); }
  async put(path: string, body?: unknown): Promise<ApiResponse> { return this.send('PUT', path, body); }
  async patch(path: string, body?: unknown): Promise<ApiResponse> { return this.send('PATCH', path, body); }
  async delete(path: string): Promise<ApiResponse> { return this.send('DELETE', path); }

  getBaseUrl(): string { return this.baseUrl; }
  getTokenValue(): string | null { return this.token; }
  setToken(t: string): void { this.token = t; }
}
