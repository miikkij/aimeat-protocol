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
 *   nonce, exactly as the outbound-connections round does it, and the nonce is bound to the owner —
 *   which is the CSRF gate: a code redeemed by anyone else lands on a nonce that is not theirs.
 *
 *   THE CLIENT REGISTRATION IS SEALED WITH THE TOKENS, not stored beside them. A refresh needs the
 *   same client that minted the token, and putting it in the credential means one sealed document
 *   holds everything the renewal needs instead of two rows that can disagree.
 * @structure startMcpOAuth · finishMcpOAuth · refreshMcpOAuth · McpOAuthProvider
 * @usage const r = await startMcpOAuth({ storage, config, server, ownerGhii });
 * @version-history
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

/** How long a person has to finish the round in their browser before the state is dead. */
const STATE_TTL_MS = 15 * 60_000;

const b64url = (b: Buffer): string => b.toString('base64url');

/** What the callback needs and the redirect URL must not carry. Stored against the state. */
interface RoundPayload {
  serverId: string;
  /** The registration the SDK made, or the one it found. A refresh must use the same client. */
  clientInformation?: OAuthClientInformation;
  /** Where the person came from, so they land back on their own settings page. */
  returnUrl: string;
}

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
  | { ok: true; authorizeUrl: string; state: string }
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
}): Promise<OAuthStart> {
  const { storage, config, server, ownerGhii } = input;

  if (!requireEncryptionKey(config)) {
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
      return { ok: true, authorizeUrl: '', state };
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
      server: server.slug, error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      code: 'UNREACHABLE',
      message: `"${server.slug}" could not be asked how to sign in.`,
    };
  }

  const payload: RoundPayload = {
    serverId: server.id,
    ...(provider.captured.clientInformation ? { clientInformation: provider.captured.clientInformation } : {}),
    returnUrl: input.returnUrl ?? '',
  };

  await storage.createVerificationNonce({
    id: randomUUID(),
    // Binding the round to the owner is the CSRF gate: a code redeemed by anyone else lands on a
    // nonce whose owner is not them, and the callback refuses.
    owner: ownerGhii,
    type: 'mcp_connect',
    state,
    // The PKCE verifier stays HERE. It is the half of the exchange that never travels.
    nonce: provider.captured.codeVerifier ?? '',
    redirectUri: input.returnUrl ?? '',
    payload: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  return { ok: true, authorizeUrl: provider.captured.authorizationUrl, state };
}

export type OAuthFinish =
  | { ok: true; server: McpServerRecord; returnUrl: string }
  | { ok: false; code: 'BAD_STATE' | 'NO_SERVER' | 'EXCHANGE_FAILED'; message: string };

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
}): Promise<OAuthFinish> {
  const { storage, config } = input;

  const round = await storage.getVerificationNonce(input.state);
  if (!round || round.type !== 'mcp_connect') {
    return {
      ok: false,
      code: 'BAD_STATE',
      message: 'That sign-in link has already been used, or it expired. Start again from the server.',
    };
  }
  await storage.deleteVerificationNonce(input.state);
  if (new Date(round.expiresAt).getTime() < Date.now()) {
    return { ok: false, code: 'BAD_STATE', message: 'That sign-in link expired. Start again.' };
  }

  const payload = JSON.parse(round.payload ?? '{}') as RoundPayload;
  const server = await storage.getMcpServer(payload.serverId);
  // The owner on the nonce is the fence: a round started for one account cannot land on another's
  // server even if somebody replays the exact state.
  if (!server || server.ownerGhii !== round.owner) {
    return { ok: false, code: 'NO_SERVER', message: 'That server is no longer attached.' };
  }

  const endpoint = server.transport.kind === 'http' || server.transport.kind === 'sse'
    ? server.transport.url
    : null;
  if (!endpoint) return { ok: false, code: 'NO_SERVER', message: 'That server is not reachable.' };

  const provider = new McpOAuthProvider(config, {
    state: input.state,
    codeVerifier: round.nonce,
    ...(payload.clientInformation ? { clientInformation: payload.clientInformation } : {}),
  });

  try {
    await auth(provider, {
      serverUrl: endpoint, authorizationCode: input.code, fetchFn: guardedFetch,
    });
  } catch (err) {
    logger.warn('mcp-client: the OAuth exchange failed', {
      server: server.slug, error: err instanceof Error ? err.message : String(err),
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
      server: server.slug, error: err instanceof Error ? err.message : String(err),
    });
    return server;
  } finally {
    await storage.releaseMcpRefresh(server.id);
  }
}
