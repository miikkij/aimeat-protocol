/**
 * @file oauth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The OAuth half of attaching a remote MCP server: the round a PERSON completes in a
 *   browser, and the refresh that keeps it alive afterwards.
 *
 *   THE SDK DOES THE PROTOCOL AND THIS FILE DOES THE STORAGE. `auth()` from the SDK's client half
 *   walks RFC 9728 protected-resource metadata, RFC 8414 authorization-server metadata, RFC 7591
 *   dynamic client registration and PKCE, in that order, with the fallbacks each spec allows. All it
 *   asks for is an `OAuthClientProvider` that can remember four things between two HTTP requests.
 *   Re-implementing that walk would be a second answer to a solved question, and it would drift
 *   from the spec the moment the spec moved.
 *
 *   EVERY BYTE OF IT GOES THROUGH guardedFetch, discovery included. That matters more here than on
 *   the tool path: discovery follows addresses the far side supplies, so an attacker-controlled
 *   server could otherwise point our metadata lookup at something internal.
 *
 *   THE PKCE VERIFIER NEVER TRAVELS. It is written against the single-use `state` in a verification
 *   nonce, exactly as the outbound-connections round does it, sealed to that round with the node key
 *   together with a dynamic registration's client_secret (services/oauth-round-secrets.ts).
 *
 *   THE STATE NAMES WHOSE SERVER, THE BINDING NAMES WHICH BROWSER. The owner on the nonce is always
 *   the server's owner, so comparing the two refused nothing: whoever saw a pending authorize address
 *   could sign in with THEIR upstream account and plant it on the owner's server. The round now
 *   stores the hash of a cookie given to the one browser that may finish it, the owner's, at the
 *   start or when they confirm a round an agent started; the callback refuses without it, before the
 *   code is exchanged (secrets audit 2026-10-09, chapter 2).
 *
 *   THE CLIENT REGISTRATION IS SEALED WITH THE TOKENS, not stored beside them. A refresh needs the
 *   same client that minted the token, and putting it in the credential means one sealed document
 *   holds everything the renewal needs instead of two rows that can disagree.
 * @structure startMcpOAuth · finishMcpOAuth · refreshMcpOAuth · refreshPersonalMcpOAuth · renewOnce ·
 *   McpOAuthProvider
 * @usage const r = await startMcpOAuth({ storage, config, server, ownerGhii });
 * @version-history
 *   2026-11-02 — A personal round (`personal`) puts a person's own sign-in on a shared server whose
 *     auth is per-user-oauth into mcp_user_credentials; refreshPersonalMcpOAuth renews it through the
 *     same renewOnce as the server's own credential. finishMcpOAuth asks the route (`roundAdmits`)
 *     whether the round's owner may still sign in there, so a group's server can take a sign-in at
 *     all: until now the round compared the server's ownerGhii, null on a group's server, and failed.
 *   2026-11-01 — The authorization address carries ui_locales, the node's own language
 *     (site.default_locale), so the far side's sign-in page can speak the buyer's language.
 *   2026-11-01 — A finished round writes the row's auth mode as 'oauth' with the token. A row attached
 *     to sign in afterwards was stored as `none`, so the token was kept and never sent, and every
 *     call to aimeat.io answered 401 (aimeat-commercial-1c, test lane).
 *   2026-10-31 — The round stores which cookie carries its binding (`bindCookie`), and finishMcpOAuth
 *     reads the `__Host-` cookie for a round bound over https (roundBindingHeld) (secaudit2026oct31w2
 *     round 10, W2-19).
 *   2026-10-20 — On the MCP SDK v2 client (@modelcontextprotocol/client): the provider keeps the
 *     discovery state with the round, declares application_type 'web', round-trips the issuer stamp
 *     on the tokens and the client registration, and the callback's `iss` reaches auth() (RFC 9207,
 *     SEP-2352, SEP-837; SDK v2 migration step 4a).
 *   2026-10-15 — A failed token renewal parks the server in needs_reauth at once and refreshMcpOAuth
 *     answers 'renewal-failed', instead of logging and carrying on with the old token until the far
 *     side answered 401 (feature-list audit #9).
 *   v1.1.0 — 2026-10-09 — A round is bound to one browser (bindBrowser at the start, the binding checked in
 *     finishMcpOAuth before the exchange, NOT_THIS_BROWSER otherwise); the verifier and the client
 *     registration are sealed in the stored round; the three log lines carry the error through
 *     describeUpstreamError, never an endpoint or an upstream body (secrets audit 2026-10-09).
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy, the OAuth credential path.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { auth } from '@modelcontextprotocol/client';
import type {
  OAuthClientProvider, OAuthClientMetadata, StoredOAuthClientInformation as OAuthClientInformation,
  StoredOAuthTokens as OAuthTokens, OAuthDiscoveryState,
} from '@modelcontextprotocol/client';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { takesPersonalSignIn } from '../../models/mcp-server-schemas.js';
import type { McpServerRecord, McpServerCredential, McpUserCredentialRecord } from '../../models/mcp-server-schemas.js';
import { sealMcpCredential, openMcpCredential, requireEncryptionKey } from './credential.js';
import { guardedFetch } from './transport.js';
import { mcpClientPool } from './pool.js';
import { logger } from '../../utils/logger.js';
import { roundBindingHeld, roundApprovalUrl, sealRoundSecret, openRoundSecret, type RoundBindCookie } from '../oauth-round-secrets.js';
import { describeUpstreamError } from './upstream-error.js';
import { LOCALES } from '../../i18n.js';

/** How long a person has to finish the round in their browser before the state is dead. */
const STATE_TTL_MS = 15 * 60_000;

const b64url = (b: Buffer): string => b.toString('base64url');

/** What the callback needs and the redirect URL must not carry. Stored against the state. */
interface RoundPayload {
  serverId: string;
  /**
   * The registration the SDK made, or the one it found, as JSON sealed to this round
   * (sealRoundSecret): it may carry a client_secret. A refresh must use the same client.
   */
  clientSealed?: string;
  /** Where the person came from, so they land back on their own settings page. */
  returnUrl: string;
  /** SHA-256 of the cookie that binds the round to one browser. Absent until the owner confirms. */
  bind?: string;
  /** Which cookie carries the binding; absent on a round written before 2026-10-31 (the plain one). */
  bindCookie?: RoundBindCookie;
  /** The far side's authorize address, kept so the confirmation step can hand it to the owner. */
  authorizeUrl?: string;
  /** Who started the round: the owner in person, or an agent acting for them. */
  startedBy?: string;
  /**
   * The authorization server the round's redirect targeted, as the SDK discovered it. Handed back
   * on the callback, so the SDK verifies it exchanges the code at the same server (SEP-2352).
   */
  discovery?: OAuthDiscoveryState;
  /**
   * A person's own sign-in on a shared server (auth per-user-oauth): the credential lands on the
   * round's owner in mcp_user_credentials, never on the server row everybody shares.
   */
  personal?: boolean;
}

/** The contexts a waiting round's two secrets are sealed to. */
const verifierContext = (state: string): string => `mcp-oauth-round:${state}:verifier`;
const clientContext = (state: string): string => `mcp-oauth-round:${state}:client`;

export const mcpCallbackUrl = (config: AimeatConfig): string =>
  `${config.baseUrl}/v1/mcp-servers/callback`;

/**
 * The storage-backed `OAuthClientProvider` the SDK drives.
 *
 * It is deliberately a plain object with mutable scratch rather than anything clever: the SDK calls
 * these in a fixed order within ONE `auth()` call, and what has to survive between the two HTTP
 * requests is written out by the caller afterwards, from `captured`. A provider that wrote to
 * storage on every callback would do four writes where one will do, and would leave half a round
 * behind whenever the person closed the tab.
 */
class McpOAuthProvider implements OAuthClientProvider {
  /** Filled in by the SDK as it walks the flow; read by the caller when it returns. */
  captured: {
    authorizationUrl?: string;
    codeVerifier?: string;
    clientInformation?: OAuthClientInformation;
    tokens?: OAuthTokens;
    discoveryState?: OAuthDiscoveryState;
  } = {};

  constructor(
    private readonly config: AimeatConfig,
    private readonly seed: {
      state: string;
      codeVerifier?: string;
      clientInformation?: OAuthClientInformation;
      tokens?: OAuthTokens;
      discoveryState?: OAuthDiscoveryState;
    },
  ) {}

  get redirectUrl(): string { return mcpCallbackUrl(this.config); }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'AIMEAT',
      // The node's own address, so whoever reviews a registration at the far side can see who
      // registered and reach a human.
      client_uri: this.config.baseUrl,
      redirect_uris: [mcpCallbackUrl(this.config)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      // A server-side client with an https redirect (SEP-837); said rather than left to the heuristic.
      application_type: 'web',
    };
  }

  /** Where the round's redirect pointed, kept with the round between the two HTTP requests. */
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.captured.discoveryState ?? this.seed.discoveryState;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.captured.discoveryState = state;
  }

  /** Ours, not the SDK's: it is the key the pending round is stored under. */
  state(): string { return this.seed.state; }

  clientInformation(): OAuthClientInformation | undefined {
    return this.captured.clientInformation ?? this.seed.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformation): void {
    this.captured.clientInformation = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.captured.tokens ?? this.seed.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.captured.tokens = tokens;
  }

  /**
   * NOT a redirect. This node has no browser to send anywhere: it captures the address and hands it
   * back so a PERSON can open it. The same shape as the outbound-connections round, and the reason
   * is the same — nothing here can approve anything on somebody's behalf, and fetching this URL
   * ourselves would accomplish precisely nothing.
   */
  redirectToAuthorization(url: URL): void {
    this.captured.authorizationUrl = url.toString();
  }

  saveCodeVerifier(verifier: string): void { this.captured.codeVerifier = verifier; }

  codeVerifier(): string {
    const v = this.captured.codeVerifier ?? this.seed.codeVerifier;
    if (!v) throw new Error('No PKCE verifier for this round.');
    return v;
  }
}

export type OAuthStart =
  /** `authorizeUrl` is the far side's ('' when nobody had to sign in); `approvalUrl` the node's page. */
  | { ok: true; authorizeUrl: string; approvalUrl: string; state: string }
  | { ok: false; code: 'NO_ENCRYPTION_KEY' | 'NO_OAUTH' | 'UNREACHABLE'; message: string };

/**
 * Begin the round. Returns an address for a PERSON to open.
 *
 * Nothing here can complete it: the consent screen is the far side's, and it is a human who decides.
 * The node's part is to remember the verifier and the registration until they come back.
 */
export async function startMcpOAuth(input: {
  storage: Storage;
  config: AimeatConfig;
  server: McpServerRecord;
  ownerGhii: string;
  returnUrl?: string;
  /** The principal starting the round, shown to the owner on the confirmation page. */
  startedBy?: string;
  /**
   * Makes the binding for this browser and returns its hash, when the owner starts the round from a
   * page of this node (middleware/oauth-round-cookie.ts). Absent for an agent or a CLI, whose round
   * then waits for the owner to confirm it on the node's page.
   */
  bindBrowser?: (state: string, ttlMs: number) => string;
  /** Which cookie bindBrowser set ('host' over https), stored with the binding. */
  bindCookie?: RoundBindCookie;
  /**
   * The round is `ownerGhii`'s own sign-in on a shared server whose auth is per-user-oauth. The
   * caller has proved the server admits them; the credential lands on them, not on the row.
   */
  personal?: boolean;
}): Promise<OAuthStart> {
  const { storage, config, server, ownerGhii } = input;

  const key = requireEncryptionKey(config);
  if (!key) {
    return {
      ok: false,
      code: 'NO_ENCRYPTION_KEY',
      message: 'This node has no encryption key configured, so it cannot hold the token this round '
        + 'would produce. Set AIMEAT_ENCRYPTION_KEY.',
    };
  }
  const endpoint = server.transport.kind === 'http' || server.transport.kind === 'sse'
    ? server.transport.url
    : null;
  if (!endpoint) {
    return { ok: false, code: 'NO_OAUTH', message: 'This server is not reachable over https.' };
  }

  const state = b64url(randomBytes(24));
  const provider = new McpOAuthProvider(config, { state });

  try {
    const result = await auth(provider, { serverUrl: endpoint, fetchFn: guardedFetch });
    if (result === 'AUTHORIZED') {
      // The far side needed nothing from a person — a pre-registered client with a grant already in
      // place. Seal what came back and say the round is done.
      await sealAndStore(storage, config, server, provider, input.personal ? ownerGhii : undefined);
      return { ok: true, authorizeUrl: '', approvalUrl: '', state };
    }
    if (!provider.captured.authorizationUrl) {
      return {
        ok: false,
        code: 'NO_OAUTH',
        message: `"${server.slug}" did not offer an authorization address. It may not use OAuth; `
          + 'attach it with a token instead.',
      };
    }
    // The node's own language (site.default_locale: a node bought from the store speaks its buyer's
    // language) as OAuth's ui_locales, so the far side's sign-in page can speak it too. A hint: a
    // server that does not know the parameter ignores it.
    const uiLocale = (config.siteLinks?.defaultLocale ?? '').trim();
    if ((LOCALES as readonly string[]).includes(uiLocale)) {
      const withLocale = new URL(provider.captured.authorizationUrl);
      if (!withLocale.searchParams.has('ui_locales')) withLocale.searchParams.set('ui_locales', uiLocale);
      provider.captured.authorizationUrl = withLocale.toString();
    }
  } catch (err) {
    // The reason is logged rather than returned: a discovery error can carry the endpoint, and the
    // endpoint is the one thing this design keeps away from callers.
    logger.warn('mcp-client: the OAuth round could not be started', {
      server: server.slug, error: describeUpstreamError(err),
    });
    return {
      ok: false,
      code: 'UNREACHABLE',
      message: `"${server.slug}" could not be asked how to sign in.`,
    };
  }

  // The owner on the nonce says whose server the credential lands on; the binding says which browser
  // may finish the round. Without the second, whoever saw this address could sign in with their own
  // upstream account and plant it here (secrets audit 2026-10-09, chapter 2).
  const bind = input.bindBrowser?.(state, STATE_TTL_MS);
  const client = provider.captured.clientInformation;
  const payload: RoundPayload = {
    serverId: server.id,
    ...(client ? { clientSealed: sealRoundSecret(JSON.stringify(client), key, clientContext(state)) } : {}),
    returnUrl: input.returnUrl ?? '',
    authorizeUrl: provider.captured.authorizationUrl,
    ...(input.startedBy ? { startedBy: input.startedBy } : {}),
    ...(bind ? { bind, ...(input.bindCookie ? { bindCookie: input.bindCookie } : {}) } : {}),
    ...(provider.captured.discoveryState ? { discovery: provider.captured.discoveryState } : {}),
    ...(input.personal ? { personal: true } : {}),
  };

  await storage.createVerificationNonce({
    id: randomUUID(),
    owner: ownerGhii,
    type: 'mcp_connect',
    state,
    // The PKCE verifier stays HERE, sealed to this round. It is the half of the exchange that never travels.
    nonce: sealRoundSecret(provider.captured.codeVerifier ?? '', key, verifierContext(state)),
    redirectUri: input.returnUrl ?? '',
    payload: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  return {
    ok: true, authorizeUrl: provider.captured.authorizationUrl, approvalUrl: roundApprovalUrl(config, state), state,
  };
}

export type OAuthFinish =
  /** `personalFor`: the person whose own sign-in this was, on a server that takes personal sign-ins. */
  | { ok: true; server: McpServerRecord; returnUrl: string; personalFor?: string }
  | { ok: false; code: 'BAD_STATE' | 'NO_SERVER' | 'EXCHANGE_FAILED' | 'NOT_THIS_BROWSER'; message: string };

/**
 * Complete the round: consume the state, exchange the code, seal what came back.
 *
 * The state is single-use and consumed BEFORE the exchange, so a replayed callback finds nothing
 * whether or not the first one succeeded.
 */
export async function finishMcpOAuth(input: {
  storage: Storage;
  config: AimeatConfig;
  state: string;
  code: string;
  /**
   * The callback's `iss` (RFC 9207), '' when it carried none. The SDK compares it with the issuer
   * the round was started against before the code is exchanged.
   */
  iss?: string;
  /** The plain round cookie the callback request carried ('' when it carried none). */
  binding: string;
  /** The `__Host-` round cookie it carried, and whether it came over https (RoundCookies). */
  hostBinding?: string;
  secure?: boolean;
  /**
   * Whether the round's owner may still put this sign-in on this server: manage it (a group's
   * server, signed in once for the group) or, for a personal round, use it. Asked again here because
   * membership can end in the fifteen minutes a round lives. The route answers it with the
   * registry's own tests; without it only the server's own owner passes, as before.
   */
  roundAdmits?: (server: McpServerRecord, ownerGhii: string, personal: boolean) => Promise<boolean>;
}): Promise<OAuthFinish> {
  const { storage, config } = input;
  const used = {
    ok: false as const,
    code: 'BAD_STATE' as const,
    message: 'That sign-in link has already been used, or it expired. Start again from the server.',
  };

  const round = await storage.getVerificationNonce(input.state);
  if (!round || round.type !== 'mcp_connect') return used;
  // Only the caller whose delete removed the row goes on: two callbacks with one state finish once.
  if (!(await storage.deleteVerificationNonce(input.state))) return used;
  if (new Date(round.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'BAD_STATE', message: 'That sign-in link expired. Start again.' };
  }

  let payload: RoundPayload;
  try {
    payload = JSON.parse(round.payload ?? '{}') as RoundPayload;
  } catch {
    logger.warn('mcp-client: a sign-in round has an unreadable payload and was refused');
    return used;
  }
  // The browser that signed in at the far side must be the one the round was bound to: the owner's,
  // at the start or after they confirmed an agent's round. Checked before the code is exchanged, so
  // nothing is sealed for anybody else (secrets audit 2026-10-09, chapter 2).
  if (!roundBindingHeld(input, payload.bind, payload.bindCookie)) {
    return {
      ok: false,
      code: 'NOT_THIS_BROWSER',
      message: 'This sign-in was not started in this browser, so nothing was saved. Start it again from your own account.',
    };
  }
  const key = requireEncryptionKey(config);
  const verifier = key ? openRoundSecret(round.nonce, key, verifierContext(input.state)) : null;
  const clientJson = key && payload.clientSealed ? openRoundSecret(payload.clientSealed, key, clientContext(input.state)) : null;
  if (verifier === null || (payload.clientSealed && clientJson === null)) return used;
  const clientInformation = clientJson ? JSON.parse(clientJson) as OAuthClientInformation : undefined;

  const server = await storage.getMcpServer(payload.serverId);
  const personal = payload.personal === true;
  // A round started for one account cannot land on another's server even if the server row moved.
  // A personal round lands only on a server that takes personal sign-ins, for a person it admits.
  const admitted = !!server && (personal
    ? takesPersonalSignIn(server) && !!input.roundAdmits && await input.roundAdmits(server, round.owner, true)
    : server.ownerGhii === round.owner
      || (!!input.roundAdmits && server.ownership !== 'owner' && await input.roundAdmits(server, round.owner, false)));
  if (!server || !admitted) {
    return { ok: false, code: 'NO_SERVER', message: 'That server is no longer attached.' };
  }

  const endpoint = server.transport.kind === 'http' || server.transport.kind === 'sse'
    ? server.transport.url
    : null;
  if (!endpoint) return { ok: false, code: 'NO_SERVER', message: 'That server is not reachable.' };

  const provider = new McpOAuthProvider(config, {
    state: input.state,
    codeVerifier: verifier,
    ...(clientInformation ? { clientInformation } : {}),
    ...(payload.discovery ? { discoveryState: payload.discovery } : {}),
  });

  try {
    await auth(provider, {
      serverUrl: endpoint, authorizationCode: input.code, fetchFn: guardedFetch,
      ...(input.iss ? { iss: input.iss } : {}),
    });
  } catch (err) {
    logger.warn('mcp-client: the OAuth exchange failed', {
      server: server.slug, error: describeUpstreamError(err),
    });
    return {
      ok: false,
      code: 'EXCHANGE_FAILED',
      message: `"${server.slug}" refused the sign-in. Try connecting it again.`,
    };
  }

  const stored = await sealAndStore(storage, config, server, provider, personal ? round.owner : undefined);
  if (!stored) {
    return {
      ok: false,
      code: 'EXCHANGE_FAILED',
      message: `"${server.slug}" returned no token.`,
    };
  }
  return { ok: true, server: stored, returnUrl: payload.returnUrl, ...(personal ? { personalFor: round.owner } : {}) };
}

/**
 * Seal whatever the round produced into the row.
 *
 * The client registration goes in WITH the tokens, so a refresh has everything it needs in one
 * sealed document. Two rows that can disagree is how a connection authorises fine and then dies on
 * its first renewal.
 */
async function sealAndStore(
  storage: Storage, config: AimeatConfig, server: McpServerRecord, provider: McpOAuthProvider,
  /** Set for a person's own sign-in on a shared server: the credential lands on them, not the row. */
  personalOwner?: string,
): Promise<McpServerRecord | null> {
  const tokens = provider.captured.tokens;
  const key = requireEncryptionKey(config);
  if (!tokens?.access_token || !key) return null;

  const credential: McpServerCredential = {
    shape: 'oauth2',
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    // The SDK's stamp of the authorization server that issued the tokens (SEP-2352), kept verbatim.
    ...(tokens.issuer ? { oauthIssuer: tokens.issuer } : {}),
  };
  const client = provider.clientInformation();
  // Carried in the credential rather than a column: it is as secret as the token beside it, and a
  // refresh needs the client that MINTED the token, not whichever one the node holds today.
  if (client) {
    credential.oauthClient = {
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      ...(client.issuer ? { issuer: client.issuer } : {}),
    };
  }

  // null is a legitimate expiry: some servers issue tokens that do not expire.
  const expiresAt = typeof tokens.expires_in === 'number'
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  if (personalOwner) {
    // The server row is shared and keeps no credential in this mode. Only this person's pooled
    // client goes: everybody else's session still holds a token that works.
    await storage.putMcpUserCredential(server.id, personalOwner, sealMcpCredential(credential, key), expiresAt);
    await mcpClientPool.invalidate(server.id, personalOwner);
    return (await storage.getMcpServer(server.id)) ?? server;
  }

  // 'oauth' with it: a row attached to sign in afterwards, or one stored before 2026-11-01 as
  // `none`, would otherwise hold the token and never send it (invoke.ts resolveCredential).
  await storage.updateMcpServerCredential(server.id, sealMcpCredential(credential, key), expiresAt, 'oauth');
  // The pooled client is holding the OLD credential in its headers. Without this the next call
  // still presents the token the far side just replaced.
  await mcpClientPool.invalidate(server.id);
  return (await storage.getMcpServer(server.id)) ?? server;
}

/** What the server row says when a renewal did not produce a new token. */
export const RENEWAL_FAILED_REASON = 'The sign-in could not be renewed. Sign in to this server again.';

/**
 * Renew an expiring token, single-flight.
 *
 * The claim is what stops two concurrent calls both refreshing: several servers invalidate the old
 * refresh token as they issue a new one, so the loser of that race would hold a dead token and park
 * a healthy server in needs_reauth — a failure caused entirely by our own concurrency.
 *
 * Returns the (possibly renewed) row, null when the stored credential cannot be opened, or
 * 'renewal-failed' when the renewal did not produce a new token. In that last case the row is
 * already in needs_reauth: the caller refuses the call rather than sending a token that is about to
 * expire, because a call that succeeded on it would set the row back to active and hide the failure
 * until the far side answered 401 (feature-list audit #9).
 */
export async function refreshMcpOAuth(
  storage: Storage, config: AimeatConfig, server: McpServerRecord,
): Promise<McpServerRecord | null | 'renewal-failed'> {
  if (server.auth !== 'oauth' || !server.credential) return server;
  // Not expired, or no expiry at all: nothing to do. The skew is what keeps a call from setting off
  // with a token that dies in flight.
  const SKEW_MS = 5 * 60_000;
  if (!server.expiresAt || new Date(server.expiresAt).getTime() - Date.now() > SKEW_MS) return server;

  const won = await storage.claimMcpRefresh(server.id, 60_000);
  if (!won) {
    // Somebody else is refreshing. Wait briefly and take whatever they wrote, rather than racing.
    await new Promise((r) => setTimeout(r, 2_000));
    return (await storage.getMcpServer(server.id)) ?? server;
  }

  try {
    const renewed = await renewOnce(config, server, server.credential);
    if (renewed === 'unreadable') return null;
    if (renewed === 'no-endpoint') return server;
    if ('failed' in renewed) return await markRenewalFailed(storage, server, renewed.failed);
    return await sealAndStore(storage, config, server, renewed.provider);
  } finally {
    await storage.releaseMcpRefresh(server.id);
  }
}

/**
 * One renewal of one sealed credential, shared by the server's own credential and a person's own
 * sign-in on a shared server, so the two cannot renew differently. Writes nothing.
 */
async function renewOnce(
  config: AimeatConfig, server: McpServerRecord, sealed: string,
): Promise<'unreadable' | 'no-endpoint' | { failed: string } | { provider: McpOAuthProvider }> {
  const opened = openMcpCredential(sealed, config);
  if (opened === 'no-key' || opened === null) return 'unreadable';

  const endpoint = server.transport.kind === 'http' || server.transport.kind === 'sse'
    ? server.transport.url
    : null;
  if (!endpoint) return 'no-endpoint';

  const client = opened.oauthClient;
  const provider = new McpOAuthProvider(config, {
    state: '',
    ...(client ? { clientInformation: client } : {}),
    tokens: {
      access_token: opened.accessToken,
      token_type: 'Bearer',
      ...(opened.refreshToken ? { refresh_token: opened.refreshToken } : {}),
      ...(opened.oauthIssuer ? { issuer: opened.oauthIssuer } : {}),
    },
  });

  try {
    await auth(provider, { serverUrl: endpoint, fetchFn: guardedFetch });
  } catch (err) {
    // The authorization server refused the refresh token (invalid_grant and the other OAuth errors
    // the SDK rethrows), or discovery failed. Either way this node holds no token it can renew, so
    // the caller says so now instead of after the far side answers 401 (feature-list audit #9).
    return { failed: describeUpstreamError(err) };
  }
  // No new access token means the SDK could not renew and fell through to a new authorization
  // round ('REDIRECT'): the refresh token was missing, refused, or the token endpoint failed. The
  // SDK v2 also saves the OLD token back once, stamped with the issuer it now knows (SEP-2352), so
  // a captured token is a renewal only when it is a different one.
  const renewed = provider.captured.tokens;
  if (!renewed || renewed.access_token === opened.accessToken) return { failed: 'no new token was issued' };
  return { provider };
}

/**
 * Renew a person's own sign-in on a shared server, single-flight per person.
 *
 * The same contract as refreshMcpOAuth, on mcp_user_credentials: the renewed credential, null when
 * it cannot be opened, or 'renewal-failed' with that person's row (and only theirs) in needs_reauth.
 */
export async function refreshPersonalMcpOAuth(
  storage: Storage, config: AimeatConfig, server: McpServerRecord, row: McpUserCredentialRecord,
): Promise<McpUserCredentialRecord | null | 'renewal-failed'> {
  const SKEW_MS = 5 * 60_000;
  if (!row.expiresAt || new Date(row.expiresAt).getTime() - Date.now() > SKEW_MS) return row;

  const won = await storage.claimMcpUserRefresh(server.id, row.ownerGhii, 60_000);
  if (!won) {
    await new Promise((r) => setTimeout(r, 2_000));
    return (await storage.getMcpUserCredential(server.id, row.ownerGhii)) ?? row;
  }
  try {
    const renewed = await renewOnce(config, server, row.credential);
    if (renewed === 'unreadable') return null;
    if (renewed === 'no-endpoint') return row;
    if ('failed' in renewed) {
      logger.warn('mcp-client: a personal sign-in could not be renewed', { server: server.slug, error: renewed.failed });
      await storage.setMcpUserCredentialStatus(server.id, row.ownerGhii, 'needs_reauth', RENEWAL_FAILED_REASON);
      await mcpClientPool.invalidate(server.id, row.ownerGhii);
      return 'renewal-failed';
    }
    await sealAndStore(storage, config, server, renewed.provider, row.ownerGhii);
    return (await storage.getMcpUserCredential(server.id, row.ownerGhii)) ?? null;
  } finally {
    await storage.releaseMcpUserRefresh(server.id, row.ownerGhii);
  }
}

/**
 * Park the row in needs_reauth after a failed renewal and drop the pooled client, which still holds
 * the old token in its headers. The detail is logged without an endpoint or an upstream body
 * (describeUpstreamError); the row carries the sentence the owner acts on.
 */
async function markRenewalFailed(
  storage: Storage, server: McpServerRecord, detail: string,
): Promise<'renewal-failed'> {
  logger.warn('mcp-client: a token could not be renewed; the server needs a new sign-in', {
    server: server.slug, error: detail,
  });
  await storage.setMcpServerStatus(server.id, 'needs_reauth', RENEWAL_FAILED_REASON);
  await mcpClientPool.invalidate(server.id);
  return 'renewal-failed';
}
