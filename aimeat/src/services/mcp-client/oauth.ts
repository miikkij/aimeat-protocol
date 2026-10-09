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
 * @structure startMcpOAuth · finishMcpOAuth · refreshMcpOAuth · McpOAuthProvider
 * @usage const r = await startMcpOAuth({ storage, config, server, ownerGhii });
 * @version-history
 *   v1.1.0 — 2026-10-09 — A round is bound to one browser (bindBrowser at the start, the binding checked in
 *     finishMcpOAuth before the exchange, NOT_THIS_BROWSER otherwise); the verifier and the client
 *     registration are sealed in the stored round; the three log lines carry the error through
 *     describeUpstreamError, never an endpoint or an upstream body (secrets audit 2026-10-09).
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy, the OAuth credential path.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata, OAuthClientInformation, OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { McpServerRecord, McpServerCredential } from '../../models/mcp-server-schemas.js';
import { sealMcpCredential, openMcpCredential, requireEncryptionKey } from './credential.js';
import { guardedFetch } from './transport.js';
import { mcpClientPool } from './pool.js';
import { logger } from '../../utils/logger.js';
import { bindingMatches, roundApprovalUrl, sealRoundSecret, openRoundSecret } from '../oauth-round-secrets.js';
import { describeUpstreamError } from './upstream-error.js';

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
  /** The far side's authorize address, kept so the confirmation step can hand it to the owner. */
  authorizeUrl?: string;
  /** Who started the round: the owner in person, or an agent acting for them. */
  startedBy?: string;
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
  } = {};

  constructor(
    private readonly config: AimeatConfig,
    private readonly seed: {
      state: string;
      codeVerifier?: string;
      clientInformation?: OAuthClientInformation;
      tokens?: OAuthTokens;
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
    };
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
      await sealAndStore(storage, config, server, provider);
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
    ...(bind ? { bind } : {}),
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
  | { ok: true; server: McpServerRecord; returnUrl: string }
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
  /** The round cookie the callback request carried ('' when it carried none). */
  binding: string;
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
  if (!bindingMatches(input.binding, payload.bind)) {
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
  // A round started for one account cannot land on another's server even if the server row moved.
  if (!server || server.ownerGhii !== round.owner) {
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
  });

  try {
    await auth(provider, {
      serverUrl: endpoint, authorizationCode: input.code, fetchFn: guardedFetch,
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

  const stored = await sealAndStore(storage, config, server, provider);
  if (!stored) {
    return {
      ok: false,
      code: 'EXCHANGE_FAILED',
      message: `"${server.slug}" returned no token.`,
    };
  }
  return { ok: true, server: stored, returnUrl: payload.returnUrl };
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
): Promise<McpServerRecord | null> {
  const tokens = provider.captured.tokens;
  const key = requireEncryptionKey(config);
  if (!tokens?.access_token || !key) return null;

  const credential: McpServerCredential = {
    shape: 'oauth2',
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
  };
  const client = provider.clientInformation();
  // Carried in the credential rather than a column: it is as secret as the token beside it, and a
  // refresh needs the client that MINTED the token, not whichever one the node holds today.
  if (client) {
    credential.oauthClient = {
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    };
  }

  // null is a legitimate expiry: some servers issue tokens that do not expire.
  const expiresAt = typeof tokens.expires_in === 'number'
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await storage.updateMcpServerCredential(server.id, sealMcpCredential(credential, key), expiresAt);
  // The pooled client is holding the OLD credential in its headers. Without this the next call
  // still presents the token the far side just replaced.
  await mcpClientPool.invalidate(server.id);
  return (await storage.getMcpServer(server.id)) ?? server;
}

/**
 * Renew an expiring token, single-flight.
 *
 * The claim is what stops two concurrent calls both refreshing: several servers invalidate the old
 * refresh token as they issue a new one, so the loser of that race would hold a dead token and park
 * a healthy server in needs_reauth — a failure caused entirely by our own concurrency.
 */
export async function refreshMcpOAuth(
  storage: Storage, config: AimeatConfig, server: McpServerRecord,
): Promise<McpServerRecord | null> {
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
    const opened = openMcpCredential(server.credential, config);
    if (opened === 'no-key' || opened === null) return null;

    const endpoint = server.transport.kind === 'http' || server.transport.kind === 'sse'
      ? server.transport.url
      : null;
    if (!endpoint) return server;

    const client = opened.oauthClient;
    const provider = new McpOAuthProvider(config, {
      state: '',
      ...(client ? { clientInformation: client } : {}),
      tokens: {
        access_token: opened.accessToken,
        token_type: 'Bearer',
        ...(opened.refreshToken ? { refresh_token: opened.refreshToken } : {}),
      },
    });

    await auth(provider, { serverUrl: endpoint, fetchFn: guardedFetch });
    if (!provider.captured.tokens) return server;
    return await sealAndStore(storage, config, server, provider);
  } catch (err) {
    // A network failure is NOT a dead grant. Parking the server here would tell the owner to
    // reconnect an account that is perfectly fine, because the far side was briefly down.
    logger.warn('mcp-client: a token could not be renewed', {
      server: server.slug, error: describeUpstreamError(err),
    });
    return server;
  } finally {
    await storage.releaseMcpRefresh(server.id);
  }
}
