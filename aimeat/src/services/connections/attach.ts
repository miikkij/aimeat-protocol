/**
 * @file attach.ts
 * @description Connecting an account by SUPPLYING a credential rather than by an authorization
 *   round (TARGET-057). The other half of the connect surface, and the one that existed as a
 *   provider entry before it existed as a route.
 *
 *   THE APP PASSWORD IS KEPT ALONGSIDE THE SESSION, deliberately. A session expires and its refresh
 *   token can be rotated away or rejected; the secret the user handed over does not expire, so a
 *   dead session can be re-minted without sending them back to a settings page to find something
 *   they already gave us. That is the whole practical advantage of a non-expiring credential and
 *   throwing it away after the first exchange would waste it.
 *
 *   THE SECRET IS NEVER ECHOED. Not in the response, not in an error, not in a log line. The only
 *   thing that comes back is the connection, and the connection's projection has no credential in
 *   it at any level.
 * @structure attachCredential · mintSession
 * @usage import { attachCredential } from './attach.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 6.
 */

import { randomUUID } from 'node:crypto';
import { safeFetch } from '../../utils/url-validator.js';
import { sealCredential } from './credential.js';
import { findProvider } from './providers.js';
import type { ConnectContext } from './oauth.js';
import type {
  ConnectionCredential, ConnectionMode, ConnectionRecord,
} from '../../models/connection-schemas.js';

/** Bluesky's default Personal Data Server. A user on their own PDS supplies it as a field later. */
const BLUESKY_PDS = 'https://bsky.social';

export type AttachResult =
  | { ok: true; connection: ConnectionRecord; created: boolean }
  | { ok: false; code: string; reason: string };

/** What a mint produced: the session, plus who it belongs to at the provider. */
export interface MintedSession {
  credential: ConnectionCredential;
  externalId: string;
  accountLabel: string;
  expiresAt: string | null;
}

/**
 * Exchange a supplied secret for a session.
 *
 * Exported because `refresh.ts` needs it too: re-minting from the stored app password is what a
 * session-shaped connection falls back to when its refresh is rejected, and having two copies of
 * this exchange is how the two paths drift.
 */
export async function mintSession(
  providerId: string, fields: Record<string, string>, baseUrl: string,
): Promise<MintedSession | { error: string }> {
  const identifier = (fields.identifier ?? '').trim();
  const password = fields.password ?? '';
  if (!identifier || !password) return { error: 'both a handle and a secret are required' };

  if (providerId === 'bluesky') {
    try {
      const r = await safeFetch(`${BLUESKY_PDS}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        // Deliberately not the provider's raw body: a failed login response can echo the identifier
        // and sometimes the attempt itself. The actionable half is that the pair was refused.
        return { error: r.status === 401
          ? 'Bluesky refused that handle and app password. Check it is an APP password, not your account password.'
          : `Bluesky refused the sign-in (HTTP ${r.status})` };
      }
      const j = await r.json() as { accessJwt?: unknown; refreshJwt?: unknown; did?: unknown; handle?: unknown };
      const accessJwt = typeof j.accessJwt === 'string' ? j.accessJwt : '';
      const did = typeof j.did === 'string' ? j.did : '';
      if (!accessJwt || !did) return { error: 'Bluesky returned no usable session' };
      return {
        credential: {
          shape: 'session',
          accessToken: accessJwt,
          ...(typeof j.refreshJwt === 'string' ? { refreshToken: j.refreshJwt } : {}),
          // The secret is kept so a dead session can be re-minted; `pds` so a user on their own
          // server is a field change rather than a code change.
          extra: { appPassword: password, identifier, pds: BLUESKY_PDS, did },
        },
        externalId: did,
        accountLabel: typeof j.handle === 'string' ? `@${j.handle}` : did,
        // AT Proto does not state a lifetime here. Null means "do not pre-emptively refresh"; the
        // 401-then-refresh path handles expiry when it actually arrives.
        expiresAt: null,
      };
    } catch (err) {
      return { error: `could not reach Bluesky: ${(err as Error).message}` };
    }
  }

  if (providerId === 'fake-static') {
    try {
      const r = await safeFetch(`${baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return { error: `the test provider refused the credential (HTTP ${r.status})` };
      const j = await r.json() as { accessJwt?: unknown; refreshJwt?: unknown; did?: unknown; handle?: unknown };
      const accessJwt = typeof j.accessJwt === 'string' ? j.accessJwt : '';
      const did = typeof j.did === 'string' ? j.did : '';
      if (!accessJwt || !did) return { error: 'the test provider returned no usable session' };
      return {
        credential: {
          shape: 'session',
          accessToken: accessJwt,
          ...(typeof j.refreshJwt === 'string' ? { refreshToken: j.refreshJwt } : {}),
          extra: { appPassword: password, identifier, pds: baseUrl, did },
        },
        externalId: did,
        accountLabel: typeof j.handle === 'string' ? `@${j.handle}` : did,
        expiresAt: null,
      };
    } catch (err) {
      return { error: `could not reach the test provider: ${(err as Error).message}` };
    }
  }

  return { error: `no supplied-credential recipe for ${providerId}` };
}

/**
 * Connect an account from a credential the user supplied.
 *
 * Re-attaching an account that is already connected UPDATES that row, exactly as re-authorising
 * does on the OAuth side — which is what makes "my app password stopped working, here is a new one"
 * a repair rather than a way to accumulate duplicates.
 */
export async function attachCredential(
  ctx: ConnectContext,
  input: { principal: string; provider: string; mode: ConnectionMode; fields: Record<string, string> },
): Promise<AttachResult> {
  const provider = findProvider(ctx.providers, input.provider);
  if (!provider) return { ok: false, code: 'UNKNOWN_PROVIDER', reason: `no provider '${input.provider}'` };
  if (!provider.enabled) {
    return { ok: false, code: 'PROVIDER_DISABLED', reason: provider.disabledReason ?? 'provider is disabled' };
  }
  if (!provider.attachFields) {
    // The two paths never overlap: a provider with an authorization round must go through it, or a
    // caller could skip the consent screen by posting here instead.
    return { ok: false, code: 'NEEDS_AUTHORIZATION', reason: `${provider.id} is connected by approving it at the provider, not by supplying a credential` };
  }
  for (const f of provider.attachFields) {
    if (!input.fields[f.name]) {
      return { ok: false, code: 'MISSING_FIELD', reason: `${f.label} is required` };
    }
  }

  const minted = await mintSession(provider.id, input.fields, ctx.config.connectFakeBaseUrl);
  if ('error' in minted) return { ok: false, code: 'ATTACH_FAILED', reason: minted.error };

  const credential = sealCredential(minted.credential, ctx.key);
  const now = new Date().toISOString();

  const existing = await ctx.storage.findConnection(input.principal, provider.id, minted.externalId, null);
  if (existing) {
    await ctx.storage.updateConnectionCredential(existing.id, credential, minted.expiresAt);
    const refreshed = await ctx.storage.getConnection(existing.id);
    return { ok: true, connection: refreshed ?? existing, created: false };
  }

  const connection: ConnectionRecord = {
    id: randomUUID(),
    principal: input.principal,
    mode: input.mode,
    provider: provider.id,
    instance: null,
    accountLabel: minted.accountLabel,
    externalId: minted.externalId,
    credential,
    credentialShape: 'session',
    scopes: provider.scopes,
    expiresAt: minted.expiresAt,
    status: 'active',
    lastOkAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.storage.createConnection(connection);
  return { ok: true, connection, created: true };
}
