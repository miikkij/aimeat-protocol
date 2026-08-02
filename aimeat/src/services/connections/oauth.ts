/**
 * @file oauth.ts
 * @description The authorization round for an outbound connection (TARGET-057): start it, and
 *   complete it when the provider redirects back.
 *
 *   WHAT THE URL MUST NOT CARRY. Everything the callback needs to make a decision — which provider,
 *   which instance, which mode, who asked — is stored server-side against a single-use `state` and
 *   never put in the redirect URL. Carrying it in the URL would let whoever reaches the callback
 *   choose which provider their code is redeemed against and whose connection it becomes.
 *
 *   WHY THE STATE IS CONSUMED FIRST. `completeAuthorization` deletes the nonce BEFORE it exchanges
 *   the code. A replayed callback then finds nothing and stops, rather than racing the original and
 *   producing two connections from one authorization.
 *
 *   THE GOOGLE PARAMETERS ARE NOT OPTIONAL. `access_type=offline` and `prompt=consent` are why a
 *   refresh token arrives at all. Without them a repeat authorization returns an access token and no
 *   refresh token, and the connection silently becomes a one-hour connection that dies and cannot
 *   renew — with nothing in the response to say so.
 * @structure startAuthorization · completeAuthorization · resolveClient · fetchAccountIdentity
 * @usage import { startAuthorization, completeAuthorization } from './oauth.js';
 * @version-history
 *   v1.0.0 — 2026-08-02 — TARGET-057 Phase 1c.
 */

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { safeFetch } from '../../utils/url-validator.js';
import { sealCredential } from './credential.js';
import { normalizeInstance, registerAtInstance, type InstanceClient } from './instance.js';
import { findProvider, type OutboundProvider } from './providers.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { ConnectionMode, ConnectionRecord } from '../../models/connection-schemas.js';

/** How long an unfinished authorization stays valid. Long enough to read a consent screen. */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface ConnectContext {
  config: AimeatConfig;
  storage: Storage;
  providers: OutboundProvider[];
  key: Buffer;
}

/** What the callback needs and the URL must not carry. Stored against the state, server-side. */
interface StatePayload {
  provider: string;
  instance: string | null;
  mode: ConnectionMode;
}

export type StartResult =
  | { ok: true; authorizeUrl: string; state: string }
  | { ok: false; code: string; reason: string };

export type CompleteResult =
  | { ok: true; connection: ConnectionRecord; returnUrl: string; created: boolean }
  | { ok: false; code: string; reason: string };

/** base64url without padding — what PKCE and OAuth2 expect. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The node's own callback address. One per node, and it must match the provider registration byte for byte. */
export function callbackUrl(config: AimeatConfig): string {
  return config.connectRedirectUri || `${config.baseUrl.replace(/\/$/, '')}/v1/connections/callback`;
}

/**
 * Client credentials for this provider: from config for a fixed endpoint, from the node's
 * registration at the instance for a federated one (registering on first contact).
 */
async function resolveClient(
  ctx: ConnectContext, provider: OutboundProvider, instance: string | null,
): Promise<InstanceClient | { error: string }> {
  if (!provider.instanceScoped) {
    if (!provider.client) return { error: provider.disabledReason ?? 'provider is not configured' };
    return { clientId: provider.client.id, clientSecret: provider.client.secret };
  }
  if (!instance) return { error: 'this provider needs an instance address' };
  return registerAtInstance(ctx.storage, ctx.key, provider.id, instance, {
    name: 'AIMEAT',
    redirectUri: callbackUrl(ctx.config),
    scopes: provider.scopes,
    website: ctx.config.baseUrl,
  });
}

/**
 * Begin an authorization. Returns the URL to send the user's browser to; the user grants consent at
 * the PROVIDER, never here.
 */
export async function startAuthorization(
  ctx: ConnectContext,
  input: { principal: string; provider: string; instance?: string; mode: ConnectionMode; returnUrl: string },
): Promise<StartResult> {
  const provider = findProvider(ctx.providers, input.provider);
  if (!provider) return { ok: false, code: 'UNKNOWN_PROVIDER', reason: `no provider '${input.provider}'` };
  if (!provider.enabled) {
    // The reason travels with the refusal: an operator staring at "disabled" has nothing to act on.
    return { ok: false, code: 'PROVIDER_DISABLED', reason: provider.disabledReason ?? 'provider is disabled' };
  }
  if (provider.credentialShape !== 'oauth2') {
    return { ok: false, code: 'NOT_AN_OAUTH_PROVIDER', reason: `${provider.id} does not use an authorization round` };
  }

  let instance: string | null = null;
  if (provider.instanceScoped) {
    const norm = normalizeInstance(input.instance ?? '');
    if (!norm.ok) return { ok: false, code: 'BAD_INSTANCE', reason: norm.reason };
    instance = norm.origin;
  }

  const client = await resolveClient(ctx, provider, instance);
  if ('error' in client) return { ok: false, code: 'CLIENT_UNAVAILABLE', reason: client.error };

  const endpoints = provider.endpoints(instance);
  if (!endpoints) return { ok: false, code: 'NO_ENDPOINTS', reason: 'provider has no authorization endpoint' };

  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const payload: StatePayload = { provider: provider.id, instance, mode: input.mode };

  await ctx.storage.createVerificationNonce({
    id: randomUUID(),
    // Binding the state to the principal is the CSRF gate: a code redeemed by anyone else lands on
    // a nonce whose owner is not them, and the callback refuses.
    owner: input.principal,
    type: 'connect',
    state,
    // The PKCE verifier stays HERE. It is the half of the exchange that never travels.
    nonce: verifier,
    redirectUri: input.returnUrl,
    payload: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  const q = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: callbackUrl(ctx.config),
    scope: provider.scopes.join(' '),
    state,
  });
  if (provider.pkce) {
    q.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
    q.set('code_challenge_method', 'S256');
  }
  if (provider.id === 'youtube') {
    // Not optional, and the failure is silent: without these Google returns no refresh token on a
    // repeat authorization and the connection quietly becomes a one-hour connection.
    q.set('access_type', 'offline');
    q.set('prompt', 'consent');
  }

  return { ok: true, authorizeUrl: `${endpoints.authorize}?${q.toString()}`, state };
}

/** The provider's answer to a token request, narrowed to what is actually used. */
interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

/** Who this account is at the provider. Both fields come FROM the provider, never from input. */
interface AccountIdentity {
  externalId: string;
  accountLabel: string;
}

/**
 * Ask the provider who the token belongs to.
 *
 * This lives in the node rather than in a publishing recipe because it is part of the CONNECTION's
 * lifecycle, not of publishing: `externalId` is the dedupe key that stops one account becoming two
 * rows, and `accountLabel` is what the owner reads in the panel. A label the app supplied would be
 * a label the app chose.
 */
async function fetchAccountIdentity(
  provider: OutboundProvider, instance: string | null, accessToken: string,
): Promise<AccountIdentity | { error: string }> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  try {
    if (provider.id === 'mastodon') {
      const r = await safeFetch(`${instance}/api/v1/accounts/verify_credentials`, {
        headers: auth, signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return { error: `instance rejected the token (HTTP ${r.status})` };
      const j = await r.json() as { id?: unknown; acct?: unknown };
      const id = typeof j.id === 'string' ? j.id : '';
      const acct = typeof j.acct === 'string' ? j.acct : '';
      if (!id) return { error: 'instance returned no account id' };
      const host = instance ? new URL(instance).hostname : '';
      return { externalId: id, accountLabel: acct ? `@${acct}@${host}` : host };
    }
    if (provider.id === 'youtube') {
      const r = await safeFetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: auth, signal: AbortSignal.timeout(15_000) },
      );
      if (!r.ok) return { error: `Google rejected the token (HTTP ${r.status})` };
      const j = await r.json() as { items?: { id?: unknown; snippet?: { title?: unknown } }[] };
      const item = Array.isArray(j.items) ? j.items[0] : undefined;
      const id = typeof item?.id === 'string' ? item.id : '';
      // A Google account with no YouTube channel authorizes fine and then has nothing to publish to.
      // Saying so here is far kinder than an upload failing later for a reason nobody can read.
      if (!id) return { error: 'this Google account has no YouTube channel' };
      const title = typeof item?.snippet?.title === 'string' ? item.snippet.title : id;
      return { externalId: id, accountLabel: title };
    }
    if (provider.id === 'fake') {
      // Test-only, and reached only when a base URL is configured. It goes through the same
      // safeFetch + shape-checking path as the real ones so the tests exercise that code rather
      // than a shortcut around it.
      const base = provider.endpoints(null)?.token.replace(/\/token$/, '') ?? '';
      const r = await safeFetch(`${base}/me`, { headers: auth, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { error: `test provider rejected the token (HTTP ${r.status})` };
      const j = await r.json() as { id?: unknown; label?: unknown };
      const id = typeof j.id === 'string' ? j.id : '';
      if (!id) return { error: 'test provider returned no account id' };
      return { externalId: id, accountLabel: typeof j.label === 'string' ? j.label : id };
    }
    return { error: `no identity lookup for ${provider.id}` };
  } catch (err) {
    return { error: `could not reach the provider: ${(err as Error).message}` };
  }
}

/**
 * Complete an authorization: consume the state, exchange the code, learn who the account is, and
 * store the connection.
 *
 * Re-authorising an account already connected UPDATES that row rather than adding a second one —
 * which is what makes "reconnect" a repair rather than a way to accumulate duplicates.
 */
export async function completeAuthorization(
  ctx: ConnectContext, input: { state: string; code: string },
): Promise<CompleteResult> {
  const nonce = await ctx.storage.getVerificationNonce(input.state);
  if (!nonce || nonce.type !== 'connect') {
    return { ok: false, code: 'UNKNOWN_STATE', reason: 'this authorization is not one we started' };
  }
  // Consumed BEFORE the exchange: a replayed callback then finds nothing, rather than racing the
  // original and producing two connections from one authorization.
  await ctx.storage.deleteVerificationNonce(input.state);
  if (new Date(nonce.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'STATE_EXPIRED', reason: 'the authorization took too long; start again' };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(nonce.payload ?? '') as StatePayload;
  } catch {
    return { ok: false, code: 'BAD_STATE', reason: 'the stored authorization is unreadable' };
  }

  const provider = findProvider(ctx.providers, payload.provider);
  if (!provider?.enabled) {
    return { ok: false, code: 'PROVIDER_DISABLED', reason: 'that provider is no longer available' };
  }
  const client = await resolveClient(ctx, provider, payload.instance);
  if ('error' in client) return { ok: false, code: 'CLIENT_UNAVAILABLE', reason: client.error };
  const endpoints = provider.endpoints(payload.instance);
  if (!endpoints) return { ok: false, code: 'NO_ENDPOINTS', reason: 'provider has no token endpoint' };

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: callbackUrl(ctx.config),
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  if (provider.pkce) body.set('code_verifier', nonce.nonce);

  let token: TokenResponse;
  try {
    const r = await safeFetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { ok: false, code: 'EXCHANGE_FAILED', reason: `the provider refused the code (HTTP ${r.status})` };
    token = await r.json() as TokenResponse;
  } catch (err) {
    return { ok: false, code: 'EXCHANGE_FAILED', reason: `could not reach the provider: ${(err as Error).message}` };
  }

  const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
  if (!accessToken) return { ok: false, code: 'EXCHANGE_FAILED', reason: 'the provider returned no access token' };
  const refreshToken = typeof token.refresh_token === 'string' ? token.refresh_token : undefined;
  const expiresAt = typeof token.expires_in === 'number'
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    // NOT an error and NOT zero: some providers issue tokens that never expire, and treating the
    // absence as "expired" would park a working connection on its first refresh check.
    : null;
  const scopes = typeof token.scope === 'string' ? token.scope.split(/[\s,]+/).filter(Boolean) : provider.scopes;

  const identity = await fetchAccountIdentity(provider, payload.instance, accessToken);
  if ('error' in identity) return { ok: false, code: 'IDENTITY_FAILED', reason: identity.error };

  const credential = sealCredential(
    { shape: provider.credentialShape, accessToken, ...(refreshToken ? { refreshToken } : {}) },
    ctx.key,
  );
  const now = new Date().toISOString();

  const existing = await ctx.storage.findConnection(
    nonce.owner, provider.id, identity.externalId, payload.instance,
  );
  if (existing) {
    // Re-authorising repairs the row it already has. updateConnectionCredential also clears the
    // error state, because a successful exchange IS the evidence that whatever was wrong is not.
    await ctx.storage.updateConnectionCredential(existing.id, credential, expiresAt, scopes);
    const refreshed = await ctx.storage.getConnection(existing.id);
    return { ok: true, connection: refreshed ?? existing, returnUrl: nonce.redirectUri, created: false };
  }

  const connection: ConnectionRecord = {
    id: randomUUID(),
    principal: nonce.owner,
    mode: payload.mode,
    provider: provider.id,
    instance: payload.instance,
    accountLabel: identity.accountLabel,
    externalId: identity.externalId,
    credential,
    credentialShape: provider.credentialShape,
    scopes,
    expiresAt,
    status: 'active',
    lastOkAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.storage.createConnection(connection);
  return { ok: true, connection, returnUrl: nonce.redirectUri, created: true };
}
