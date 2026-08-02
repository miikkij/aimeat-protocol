/**
 * @file refresh.ts
 * @description Keeping a connection's credential usable, and taking it away (TARGET-057).
 *
 *   SINGLE FLIGHT, AND WHY. Several providers invalidate the old refresh token as part of issuing a
 *   new one. Two concurrent publishes on one connection therefore refresh twice, and the second
 *   exchange presents a token the provider has already retired: one publish works, the other parks
 *   the connection in `needs_reauth`, and the owner is told to reconnect an account that was never
 *   broken. The claim in the store makes exactly one caller refresh; the others wait and re-read.
 *
 *   REFRESH BEFORE EXPIRY, NOT AFTER. A token that expires mid-upload fails a request that has
 *   already moved bytes. The skew below is what turns "it expired" into "it was replaced".
 *
 *   REVOKING MEANS REVOKING. Deleting our row while the provider still honours the token is not a
 *   revocation, it is forgetting. The provider is told first, wherever it offers a way to be told.
 * @structure ensureFreshCredential · revokeConnection
 * @usage import { ensureFreshCredential } from './refresh.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1c.
 */

import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { sealCredential, openCredential } from './credential.js';
import { findProvider, tokenRequest } from './providers.js';
import { mintSession } from './attach.js';
import type { ConnectContext } from './oauth.js';
import type { ConnectionCredential, ConnectionRecord } from '../../models/connection-schemas.js';

/** Refresh this far ahead of expiry, so a long upload does not start on a token about to die. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** A claim older than this is treated as abandoned — a crash mid-refresh must not wedge a connection. */
const CLAIM_STALE_MS = 60 * 1000;

/** How long a loser of the claim waits for the winner before giving up. */
const WAIT_TOTAL_MS = 15 * 1000;
const WAIT_STEP_MS = 250;

export type FreshResult =
  | { ok: true; credential: ConnectionCredential; connection: ConnectionRecord }
  | { ok: false; code: string; reason: string };

function needsRefresh(c: ConnectionRecord): boolean {
  // null expiry is a provider that does not expire tokens, not an unknown. Treating it as expired
  // would refresh a Mastodon connection forever, using a refresh token it does not have.
  if (!c.expiresAt) return false;
  return new Date(c.expiresAt).getTime() - Date.now() < REFRESH_SKEW_MS;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A credential that will still be valid when it is used.
 *
 * Returns a failure rather than throwing for every expected outcome — a dead refresh token, a
 * missing key, a provider that is gone — because every caller has to show the owner something, and
 * an exception at this depth surfaces as a 500 in whatever background job touched it first.
 */
export async function ensureFreshCredential(
  ctx: ConnectContext, connectionId: string,
): Promise<FreshResult> {
  let conn = await ctx.storage.getConnection(connectionId);
  if (!conn) return { ok: false, code: 'NOT_FOUND', reason: 'no such connection' };
  if (conn.status === 'revoked') return { ok: false, code: 'REVOKED', reason: 'this connection was revoked' };

  if (!needsRefresh(conn)) {
    const credential = openCredential(conn.credential, ctx.key);
    if (!credential) {
      // Unreadable ciphertext is a rotated key or a restored backup. The honest thing to tell the
      // owner is "reconnect", so the connection is parked rather than the request 500ing.
      await ctx.storage.setConnectionStatus(conn.id, 'needs_reauth', 'stored credential cannot be read');
      return { ok: false, code: 'UNREADABLE', reason: 'stored credential cannot be read; reconnect this account' };
    }
    return { ok: true, credential, connection: conn };
  }

  const won = await ctx.storage.claimConnectionRefresh(conn.id, CLAIM_STALE_MS);
  if (!won) {
    // Someone else is refreshing. Wait for their result instead of racing them into the failure
    // this whole mechanism exists to prevent.
    for (let waited = 0; waited < WAIT_TOTAL_MS; waited += WAIT_STEP_MS) {
      await sleep(WAIT_STEP_MS);
      const latest = await ctx.storage.getConnection(conn.id);
      if (!latest) return { ok: false, code: 'NOT_FOUND', reason: 'no such connection' };
      if (latest.status === 'needs_reauth') {
        return { ok: false, code: 'NEEDS_REAUTH', reason: latest.lastError ?? 'this account needs to be reconnected' };
      }
      if (!needsRefresh(latest)) {
        const credential = openCredential(latest.credential, ctx.key);
        if (!credential) return { ok: false, code: 'UNREADABLE', reason: 'stored credential cannot be read' };
        return { ok: true, credential, connection: latest };
      }
    }
    return { ok: false, code: 'REFRESH_BUSY', reason: 'another refresh is still running; try again' };
  }

  try {
    // Re-read under the claim: the winner may have been queued behind a refresh that already
    // finished, and refreshing again would burn a token that was just issued.
    conn = (await ctx.storage.getConnection(conn.id)) ?? conn;
    if (!needsRefresh(conn)) {
      const credential = openCredential(conn.credential, ctx.key);
      if (!credential) return { ok: false, code: 'UNREADABLE', reason: 'stored credential cannot be read' };
      return { ok: true, credential, connection: conn };
    }
    return await performRefresh(ctx, conn);
  } finally {
    await ctx.storage.releaseConnectionRefresh(conn.id);
  }
}

/** The exchange itself. Only ever runs inside a held claim. */
async function performRefresh(ctx: ConnectContext, conn: ConnectionRecord): Promise<FreshResult> {
  const current = openCredential(conn.credential, ctx.key);
  if (!current) {
    await ctx.storage.setConnectionStatus(conn.id, 'needs_reauth', 'stored credential cannot be read');
    return { ok: false, code: 'UNREADABLE', reason: 'stored credential cannot be read; reconnect this account' };
  }
  const provider = findProvider(ctx.providers, conn.provider);
  if (!provider) {
    return { ok: false, code: 'PROVIDER_GONE', reason: 'that provider is no longer configured on this node' };
  }

  // BEFORE the refresh-token guard below, and that order is load-bearing: a session-shaped
  // credential whose refresh token is gone can still be re-minted from the stored secret, and
  // checking for a refresh token first would park exactly the connection that has a second chance.
  if (current.shape === 'session') return refreshSession(ctx, conn, current);

  if (!current.refreshToken) {
    // An expiring token with no way to renew it. Google does this when access_type=offline was
    // missing, and the connection is genuinely finished — say so instead of retrying forever.
    await ctx.storage.setConnectionStatus(conn.id, 'needs_reauth', 'no refresh token; reconnect this account');
    return { ok: false, code: 'NEEDS_REAUTH', reason: 'this account needs to be reconnected' };
  }

  const endpoints = provider.endpoints(conn.instance);
  if (!endpoints) {
    return { ok: false, code: 'PROVIDER_GONE', reason: 'that provider is no longer configured on this node' };
  }

  const client = provider.instanceScoped
    ? await (async () => {
      const pc = conn.instance ? await ctx.storage.getProviderClient(provider.id, conn.instance) : undefined;
      if (!pc) return null;
      const secret = openCredential(pc.clientSecret, ctx.key);
      return secret ? { clientId: pc.clientId, clientSecret: secret.accessToken } : null;
    })()
    : provider.client ? { clientId: provider.client.id, clientSecret: provider.client.secret } : null;
  if (!client) return { ok: false, code: 'CLIENT_UNAVAILABLE', reason: 'no client credentials for this provider' };

  // Same builder as the first exchange. A refresh that authenticated differently from the exchange
  // is a connection that links successfully and then cannot renew -- visible only hours later.
  const req = tokenRequest(provider, client, {
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });

  let res: Response;
  try {
    res = await safeFetch(endpoints.token, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // A network failure is NOT a dead token. Leaving the status alone means the next attempt tries
    // again; parking it here would make an outage at the provider look like a revoked account.
    return { ok: false, code: 'REFRESH_UNREACHABLE', reason: `could not reach the provider: ${(err as Error).message}` };
  }

  if (!res.ok) {
    // 4xx from a token endpoint means the grant is gone: revoked at the provider, expired past its
    // limit, or a testing-mode token past its seven days. That IS a reconnect.
    if (res.status >= 400 && res.status < 500) {
      await ctx.storage.setConnectionStatus(conn.id, 'needs_reauth', 'the provider no longer accepts this authorization');
      return { ok: false, code: 'NEEDS_REAUTH', reason: 'this account needs to be reconnected' };
    }
    return { ok: false, code: 'REFRESH_FAILED', reason: `the provider failed the refresh (HTTP ${res.status})` };
  }

  const json = await res.json().catch((err: unknown) => {
    // A 200 that is not JSON is a different fault from a 200 whose JSON lacks access_token, and both
    // end at the same message below. Logged so the two can be told apart in production.
    logger.warn('connections: refresh response was unparseable', {
      connectionId: conn.id, provider: conn.provider, error: String(err),
    });
    return null;
  }) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!accessToken) return { ok: false, code: 'REFRESH_FAILED', reason: 'the provider returned no access token' };

  const next: ConnectionCredential = {
    shape: current.shape,
    accessToken,
    // A refresh response that omits refresh_token means "keep using the one you have". Dropping it
    // here would leave the connection unable to renew again, one refresh from now.
    ...(typeof json?.refresh_token === 'string' ? { refreshToken: json.refresh_token } : current.refreshToken ? { refreshToken: current.refreshToken } : {}),
    ...(current.extra ? { extra: current.extra } : {}),
  };
  const expiresAt = typeof json?.expires_in === 'number'
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;

  await ctx.storage.updateConnectionCredential(conn.id, sealCredential(next, ctx.key), expiresAt);
  const updated = await ctx.storage.getConnection(conn.id);
  return { ok: true, credential: next, connection: updated ?? conn };
}

/**
 * Renew a session-shaped credential, with a fallback the OAuth path does not have.
 *
 * AT Proto refreshes by presenting the refresh token as a BEARER, not as a form field, which is why
 * this is a separate function rather than a parameter on the OAuth exchange. And when that is
 * refused — rotated away, expired, revoked — the stored app password can mint a fresh session. A
 * user who supplied a non-expiring secret should not be asked for it twice.
 */
async function refreshSession(
  ctx: ConnectContext, conn: ConnectionRecord, current: ConnectionCredential,
): Promise<FreshResult> {
  const pds = current.extra?.pds ?? '';
  if (current.refreshToken && pds) {
    try {
      const r = await safeFetch(`${pds}/xrpc/com.atproto.server.refreshSession`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${current.refreshToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        const j = await r.json().catch((err: unknown) => {
          logger.warn('connections: session refresh response was unparseable', {
            connectionId: conn.id, provider: conn.provider, error: String(err),
          });
          return null;
        }) as { accessJwt?: unknown; refreshJwt?: unknown } | null;
        const accessToken = typeof j?.accessJwt === 'string' ? j.accessJwt : '';
        if (accessToken) {
          const next: ConnectionCredential = {
            shape: 'session',
            accessToken,
            ...(typeof j?.refreshJwt === 'string' ? { refreshToken: j.refreshJwt } : current.refreshToken ? { refreshToken: current.refreshToken } : {}),
            ...(current.extra ? { extra: current.extra } : {}),
          };
          await ctx.storage.updateConnectionCredential(conn.id, sealCredential(next, ctx.key), null);
          const updated = await ctx.storage.getConnection(conn.id);
          return { ok: true, credential: next, connection: updated ?? conn };
        }
      }
    } catch (err) {
      // Not fatal and not final: the mint below is the second chance, and reaching it is the point.
      logger.warn('connections: session refresh failed; falling back to re-minting from the stored secret', {
        connectionId: conn.id, provider: conn.provider, error: String(err),
      });
    }
  }

  const secret = current.extra?.appPassword;
  const identifier = current.extra?.identifier;
  if (!secret || !identifier) {
    await ctx.storage.setConnectionStatus(conn.id, 'needs_reauth', 'the session expired and no stored secret can renew it');
    return { ok: false, code: 'NEEDS_REAUTH', reason: 'this account needs to be connected again' };
  }

  const minted = await mintSession(conn.provider, { identifier, password: secret }, ctx.config.connectFakeBaseUrl);
  if ('error' in minted) {
    // The secret itself no longer works — revoked at the provider, or the account changed. That IS
    // a reconnect, and the reason is the one the owner can act on.
    await ctx.storage.setConnectionStatus(conn.id, 'needs_reauth', minted.error);
    return { ok: false, code: 'NEEDS_REAUTH', reason: minted.error };
  }
  await ctx.storage.updateConnectionCredential(
    conn.id, sealCredential(minted.credential, ctx.key), minted.expiresAt,
  );
  const updated = await ctx.storage.getConnection(conn.id);
  return { ok: true, credential: minted.credential, connection: updated ?? conn };
}

/**
 * Revoke: tell the provider first where it offers a way to be told, then drop the credential.
 *
 * The provider call is best-effort and its failure does NOT stop the local removal. An owner who
 * asked to disconnect an account must end up disconnected even when the provider is down; the
 * alternative is a button that sometimes silently does nothing.
 */
export async function revokeConnection(
  ctx: ConnectContext, connectionId: string,
): Promise<{ ok: true; toldProvider: boolean } | { ok: false; code: string; reason: string }> {
  const conn = await ctx.storage.getConnection(connectionId);
  if (!conn) return { ok: false, code: 'NOT_FOUND', reason: 'no such connection' };

  let toldProvider = false;
  const provider = findProvider(ctx.providers, conn.provider);
  const revokeUrl = provider?.endpoints(conn.instance)?.revoke ?? null;
  const credential = openCredential(conn.credential, ctx.key);

  if (revokeUrl && credential) {
    try {
      const body = new URLSearchParams({ token: credential.refreshToken ?? credential.accessToken });
      if (provider?.instanceScoped && conn.instance) {
        const pc = await ctx.storage.getProviderClient(provider.id, conn.instance);
        const secret = pc ? openCredential(pc.clientSecret, ctx.key) : null;
        if (pc && secret) {
          body.set('client_id', pc.clientId);
          body.set('client_secret', secret.accessToken);
        }
      } else if (provider?.client) {
        body.set('client_id', provider.client.id);
        body.set('client_secret', provider.client.secret);
      }
      const r = await safeFetch(revokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      toldProvider = r.ok;
    } catch (err) {
      // NOT swallowed: the local removal below is what the owner asked for and must happen whether
      // or not the provider is reachable, but a token still live at the provider is exactly the kind
      // of thing an operator needs to be able to find later. `toldProvider` reports it to the caller
      // and this reports it to the log.
      logger.warn('connections: provider revocation failed; the local credential was still removed', {
        connectionId: conn.id, provider: conn.provider, error: String(err),
      });
      toldProvider = false;
    }
  }

  await ctx.storage.deleteConnection(conn.id);
  return { ok: true, toldProvider };
}
