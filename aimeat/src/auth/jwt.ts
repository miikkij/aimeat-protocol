/**
 * @file jwt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EdDSA JWT minting/verification signed with the node's Ed25519 key, plus storage-backed
 *   token revocation. Issues credentials for every authenticated principal — owner (GHII), agent
 *   (GAII), and ecosystem app (GEAI). Optional claims (mcp_client, federated, eco_app, …) are threaded
 *   conditionally so tokens stay minimal.
 * @structure initNodeKeys / AccountDisabledError / issueJWT / verifyJWT (+ asVisitor) / generateSessionId / tokenIdOf / revokeToken / isRevoked
 * @usage import { issueJWT, verifyJWT } from '../auth/jwt.js';
 * @version-history
 *   v1.10.0 — 2026-10-09 — verifyJWT refuses as a session any token that carries a purpose claim
 *     (`typ`, `purpose`, `vc`), a header type other than JWT, or lacks the session claims (sub, owner,
 *     node as strings, roles as a list of strings). A download, upload, share or app-access token, a
 *     pending signup and a verifiable credential now answer 401 as a Bearer, not 500 (secrets audit
 *     2026-10-09, S-1). The optional `auth_time` claim: when an ecosystem app's refresh chain began.
 *   v1.9.0 — 2026-09-29 — The optional `via: 'pat'` claim: issueJWT writes it for a token minted from a
 *     personal access token and verifyJWT carries it onto the verified token, so classification reads
 *     such a session as an AI (TARGET-082 V4). It changes no role and no scope.
 *   v1.8.0 — 2026-09-26 — The revoked-token table is each node's own: initRevocationStorage files a
 *     node's storage under its node id, and isRevoked, revokeToken and the mint check in issueJWT read
 *     the one of the node the code runs as (./node-auth.ts), with its cache entries filed per node and
 *     one expiry sweep per node. One node per process in production, so nothing there changes.
 *   v1.7.0 — 2026-09-26 — issueJWT writes the issue time in milliseconds (`iat_ms`) beside `iat`, from
 *     one clock reading, and verifyJWT carries it as `iatMs`, so a credential's age is compared with
 *     an account or a record to the millisecond (auth/credential-age.ts).
 *   v1.6.0 — 2026-09-26 — verifyJWT carries the token's `iat`, so the credential check can refuse an
 *     ecosystem app's token issued before the app record it names was made (auth/middleware.ts).
 *   v1.5.1 — 2026-09-26 — The old-key read (spellingHashOf) names its removal: the first release made
 *     90 days after 3.20.0 reaches the nodes, when every token revoked before v1.5.0 has expired.
 *     No flag, because turning it off early would bring a revoked token back (invariant 16).
 *   v1.5.0 — 2026-09-26 — A token is revoked and checked under its id (tokenIdOf: the hash of the
 *     header and claims its signature covers), not under its string, so every spelling of a revoked
 *     token is refused. isRevoked also reads the old key, the hash of the string, so a token revoked
 *     before this change stays revoked (secaudit 2026-09, N4).
 *   v1.4.0 — 2026-09-24 — verifyJWT reads a federated token as a VISITOR: role `federated` and its
 *     home GHII as `owner` and `sub`, whatever the token says. Every consumer of a token goes
 *     through here (the global auth middleware, MCP, the tunnels, device approval, OAuth consent), so
 *     no door can take a visitor from another node for the local account that shares its local part
 *     (secaudit 2026-09, root cause F-1).
 *   v1.3.0 — 2026-08-23 — Mint backstop (BR-04): issueJWT throws AccountDisabledError for a
 *     deactivated local owner, so a door that forgot to ask still cannot mint in their name.
 *   v1.2.0 — 2026-08-10 — Fails closed at both ends: issueJWT writes [] rather than ['*'] when the
 *     caller omits scopes, and verifyJWT reads a missing claim the same way. issueJWT has always
 *     written the claim, so no token in circulation lacks it.
 *   v1.1.0 — 2026-06-14 — Add optional `eco_app` claim for GEAI (ecosystem app) sessions.
 */
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { FEDERATED_ROLE, currentNodeId, homeIdentityOf, isForeignPrincipal } from '../utils/gaii.js';
import { PerNode } from './node-auth.js';

// We use EdDSA JWTs signed with the node's private key
// jose requires CryptoKey objects, so we convert from raw Ed25519 bytes

let nodePrivateKey: CryptoKey | null = null;
let nodePublicKey: CryptoKey | null = null;

export function getNodeCryptoKeys(): { privateKey: CryptoKey; publicKey: CryptoKey } {
  if (!nodePrivateKey || !nodePublicKey) throw new Error('Node keys not initialized');
  return { privateKey: nodePrivateKey, publicKey: nodePublicKey };
}

export async function initNodeKeys(publicKeyBase64: string, privateKeyBase64: string): Promise<void> {
  const publicKeyBytes = Buffer.from(publicKeyBase64, 'base64');
  const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');

  // Import raw Ed25519 keys into CryptoKey via JWK format
  const publicKeyJwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: Buffer.from(publicKeyBytes).toString('base64url'),
  };
  const privateKeyJwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: Buffer.from(publicKeyBytes).toString('base64url'),
    d: Buffer.from(privateKeyBytes).toString('base64url'),
  };

  nodePublicKey = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'Ed25519' }, true, ['verify']);
  nodePrivateKey = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: 'Ed25519' }, true, ['sign']);
}

export interface JWTPayload {
  sub: string;        // GAII, GEAI, or owner
  owner: string;
  node: string;
  roles: string[];
  scopes?: string[];  // omitted = [] — an agent token that says nothing may do nothing
  // The shared anonymous principal, which VerifiedToken has always carried and no MINT ever set.
  // Every guard that reads it -- the board roster, the agent card, the app legal pages -- was
  // therefore treating a minted anonymous token as an ordinary agent. Review item 2.9.
  anonymous?: boolean;
  mcp_client?: string; // OAuth client name for MCP sessions (e.g. "Claude", "Cursor")
  federated?: boolean;  // true for federated login sessions
  homeNode?: string;    // home node ID for federated sessions
  homeUrl?: string;     // home node base URL for federated sessions
  eco_app?: string;     // ecosystem app global name (e.g. "zendesk") for GEAI (role: ecosystem) sessions
  app_grant?: string;   // app-grant id for scoped, user-approved app tokens (role: app) — H-2
  app?: string;         // the app's own id ("owner/filename") for role-'app' tokens, so the caller
                        //   can be NAMED without a grant lookup — see gaii.ts callerPrincipal
  /** 'pat' when the token was minted from a personal access token (the exchange, the PAT-backed
   *  refresh cookie). A mark for classification only (services/classification/reader-kind.ts):
   *  it grants and removes nothing. */
  via?: 'pat';
  /** When the owner approved the credential chain this token belongs to, in epoch seconds (the
   *  OIDC `auth_time` claim). Written on an ecosystem app's token at approval and carried across
   *  each refresh, so the chain ends a fixed time after the owner said yes (routes/eco-refresh.ts). */
  auth_time?: number;
}

/** Generate a unique session ID for JWT tracking. */
export function generateSessionId(): string {
  return `sid-${randomBytes(16).toString('hex')}`;
}

/** Thrown by issueJWT when the owner an aspiring credential would act for is deactivated (BR-04).
 *  Doors catch it and answer 403 ACCOUNT_DISABLED; a door that forgot to ask still cannot mint. */
export class AccountDisabledError extends Error {
  readonly code = 'ACCOUNT_DISABLED';
  /** Read by the global error handler so an uncaught throw still answers 403, not 500. */
  readonly status = 403;
  constructor(owner: string) {
    super(`Account "${owner}" is deactivated`);
    this.name = 'AccountDisabledError';
  }
}

export async function issueJWT(payload: JWTPayload, ttlSeconds: number, sessionId?: string): Promise<string> {
  if (!nodePrivateKey) throw new Error('Node keys not initialized');

  // Mint backstop (BR-04): no credential is minted in a deactivated owner's name, whichever of the
  // twenty call sites asked. Same shape as provisionOwner's registration-mode backstop — the human
  // doors refuse with a clean 403 before reaching here, and this makes a forgotten door impossible.
  // Federated mints are excluded: their `owner` is a remote node's name, judged by its home node.
  const storage = revocationStore.get();
  if (payload.owner && !isForeignPrincipal(payload) && storage) {
    const ownerRecord = await storage.getOwner(payload.owner);
    if (ownerRecord?.disabledAt) throw new AccountDisabledError(payload.owner);
  }

  // The issue time to the millisecond, beside `iat`, which counts whole seconds. The account and
  // record checks compare a credential's age with it exactly (auth/credential-age.ts).
  const issuedMs = Date.now();
  const builder = new SignJWT({
    owner: payload.owner,
    node: payload.node,
    roles: payload.roles,
    iat_ms: issuedMs,
    // Fail closed. This was `?? ['*']`, so forgetting the field minted a credential over the whole
    // account — which is how proving control of a mailbox returned a wildcard token, and how every
    // MCP OAuth session came back as one. An owner or operator session is unaffected either way,
    // because requireScope lets those through on the role; an AGENT token with no scopes can do
    // nothing, which is the right answer to "the caller did not say what this is for".
    scopes: payload.scopes ?? [],
    ...(payload.mcp_client ? { mcp_client: payload.mcp_client } : {}),
    ...(payload.federated ? { federated: true } : {}),
    ...(payload.homeNode ? { homeNode: payload.homeNode } : {}),
    ...(payload.homeUrl ? { homeUrl: payload.homeUrl } : {}),
    ...(payload.eco_app ? { eco_app: payload.eco_app } : {}),
    ...(payload.app_grant ? { app_grant: payload.app_grant } : {}),
    ...(payload.app ? { app: payload.app } : {}),
    ...(payload.via === 'pat' ? { via: 'pat' } : {}),
    ...(typeof payload.auth_time === 'number' ? { auth_time: payload.auth_time } : {}),
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt(Math.floor(issuedMs / 1000))
    .setExpirationTime(`${ttlSeconds}s`);

  // P3-7: Embed session ID for server-side session tracking
  if (sessionId) {
    builder.setJti(sessionId);
  }

  return builder.sign(nodePrivateKey);
}

export interface VerifiedToken {
  sub: string;
  owner: string;
  node: string;
  roles: string[];
  exp: number;
  iat?: number;        // when the token was issued, in seconds (every minted token carries it)
  iatMs?: number;      // the same, in milliseconds (`iat_ms`, on every token minted from 2026-09-26 on)
  scopes: string[];
  anonymous?: boolean;
  sessionId?: string;  // P3-7: Server-side session tracking
  mcp_client?: string; // OAuth client name for MCP sessions
  federated?: boolean;  // true for federated login sessions
  homeNode?: string;    // home node ID for federated sessions
  homeUrl?: string;     // home node base URL for federated sessions
  eco_app?: string;     // ecosystem app global name for GEAI (role: ecosystem) sessions
  app_grant?: string;   // app-grant id for scoped, user-approved app tokens (role: app)
  app?: string;         // the app's own id ("owner/filename") for role-'app' tokens
  via?: 'pat';          // made from a personal access token: set by the auth middleware on a raw PAT
                        //   and read from the `via` claim of a JWT minted from one
  authTime?: number;    // `auth_time`: when the owner approved this token's chain (ecosystem apps)
}

/**
 * A session signed in on ANOTHER node, as this node must see it: a visitor, holding the role
 * `federated` and no other, named by its home GHII.
 *
 * The federated login minted `roles: ['owner']` and the bare local part of the visitor's name until
 * 2026-09-24, and whatever this function returns is what every door reads. A door that asked "is this
 * the account holder" of the role, or looked an account up by the name, answered for the LOCAL
 * account sharing the local part: the agent roster, the home feed, the A2A account road, the
 * AI-spend gate, device authorization's same-owner shortcut, the schema door, the personal tunnel
 * (secaudit 2026-09). Rewritten here, once, so a token minted before this change reads the same as
 * one minted after it, and every consumer of a token sees one answer.
 */
function asVisitor(v: VerifiedToken): VerifiedToken {
  if (!isForeignPrincipal(v)) return v;
  const home = homeIdentityOf(v);
  return { ...v, sub: home, owner: home, roles: [FEDERATED_ROLE] };
}

/**
 * The claims that mark a token minted for one purpose rather than as a session: `typ` (download,
 * upload, share, app-access, draft-preview, frame-grant, confirm), `purpose` (the pending signup of
 * an external login) and `vc` (a verifiable credential). issueJWT writes none of them.
 */
const PURPOSE_CLAIMS = ['typ', 'purpose', 'vc'] as const;

/**
 * Is this signed payload a session, as issueJWT writes one? Every short-lived token the node mints
 * is signed with the same node key, so the signature alone says only "this node signed it". A
 * session carries `sub`, `owner` and `node` as strings and `roles` as a list of strings, under the
 * header type `JWT`, and none of the purpose claims above. A token that fails this is refused as a
 * session (401), never read with a default for the missing claim (secrets audit 2026-10-09, S-1).
 */
function isSessionShape(payload: Record<string, unknown>, headerTyp: unknown): boolean {
  if (headerTyp !== undefined && headerTyp !== 'JWT') return false;
  if (PURPOSE_CLAIMS.some((claim) => payload[claim] !== undefined)) return false;
  if (typeof payload.sub !== 'string' || typeof payload.owner !== 'string' || typeof payload.node !== 'string') return false;
  return Array.isArray(payload.roles) && payload.roles.every((r) => typeof r === 'string');
}

export async function verifyJWT(token: string): Promise<VerifiedToken | null> {
  if (!nodePublicKey) throw new Error('Node keys not initialized');

  try {
    const { payload, protectedHeader } = await jwtVerify(token, nodePublicKey, {
      algorithms: ['EdDSA'],
    });
    // A download, upload, share or app-access token, a draft preview, a frame grant, an operator
    // confirmation, a pending signup and a verifiable credential are signed with this key too. They
    // are not sessions, so they authenticate nothing here.
    if (!isSessionShape(payload as Record<string, unknown>, protectedHeader.typ)) return null;
    return asVisitor({
      sub: payload.sub as string,
      owner: payload.owner as string,
      node: payload.node as string,
      roles: payload.roles as string[],
      exp: payload.exp as number,
      iat: payload.iat as number | undefined,
      iatMs: typeof payload.iat_ms === 'number' ? payload.iat_ms : undefined,
      // The other end of the same door. issueJWT has always written this claim, so a token
      // without one is not an old token — it is not one of ours.
      scopes: (payload.scopes as string[]) ?? [],
      // Carried through, so the guards that read it on the INJECTED identity see the same fact
      // on the minted one. It was written by no mint and read off no token until 2026-09-07.
      anonymous: (payload.anonymous as boolean | undefined) ?? undefined,
      sessionId: payload.jti as string | undefined,
      mcp_client: payload.mcp_client as string | undefined,
      federated: (payload.federated as boolean) ?? false,
      homeNode: payload.homeNode as string | undefined,
      homeUrl: payload.homeUrl as string | undefined,
      eco_app: payload.eco_app as string | undefined,
      app_grant: payload.app_grant as string | undefined,
      app: payload.app as string | undefined,
      // Only the one known value is carried; anything else in the claim is not ours.
      ...(payload.via === 'pat' ? { via: 'pat' as const } : {}),
      ...(typeof payload.auth_time === 'number' ? { authTime: payload.auth_time } : {}),
    });
  } catch {
    // Fail-closed by design: any verification error (bad signature, expiry, malformed claims) means
    // "not authenticated". Logging every rejected token on a public endpoint is a flooding vector.
    // eslint-disable-next-line aimeat/no-silent-catch -- null here means "not authenticated"
    return null;
  }
}

// ── Token Revocation (storage-backed with in-memory cache) ─────────────

/** Keeps a token id apart from the other hashes the revoked-token table holds (spent assertions). */
const TOKEN_ID_PREFIX = 'jwt-signed:';

/**
 * A token's id: the hash of what its signature covers, the header and the claims. A token is
 * revoked and checked under this, never under its string.
 *
 * WHY NOT THE STRING. An Ed25519 signature is 64 bytes in 86 base64url characters, so the last
 * character carries four bits nobody reads, and verifyJWT accepts all sixteen spellings of one
 * signature. A key made from the string names one spelling of sixteen. The header and the claims
 * are signed exactly as written, so every copy that verifies has the same ones (secaudit 2026-09,
 * N4; the assertion spend keys the same way, services/assertion-spend.ts).
 *
 * WHY NOT THE jti ALONE. Not every token carries one (an MCP OAuth access token, an app grant's
 * token, a personal access token's exchange), and an owner's web session keeps one jti across every
 * refresh, so there a jti names the session and not the token. The claims carry the jti where there
 * is one, beside iat and exp, so this id is one token's and nothing wider.
 */
export function tokenIdOf(token: string): string {
  const cut = token.lastIndexOf('.');
  const signed = cut > 0 ? token.slice(0, cut) : token;
  return createHash('sha256').update(`${TOKEN_ID_PREFIX}${signed}`).digest('hex');
}

/**
 * Where a revocation made before 2026-09-26 was filed: the hash of the token's exact string. Read
 * as well as the id, so a token revoked before this change stays revoked.
 *
 * DEPRECATED, REMOVED ON A DATE (invariant 16). No flag: it is on wherever it ships, because turning
 * it off would bring a revoked token back. It is removed, together with its read in isRevoked, in
 * the first release made 90 days after 3.20.0 reaches the nodes. By then every token revoked before
 * this change has expired: 90 days (AIMEAT_AGENT_JWT_TTL, 7776000 s by default) is the longest a
 * token lives.
 */
function spellingHashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// In-memory cache for fast repeated lookups (TTL 60 seconds), filed per node (cacheKey), so an answer
// read from one node's table is never another node's.
// Entries are { revoked: boolean, cachedAt: number }.
const revocationCache = new Map<string, { revoked: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

/** Where a key of the revoked-token table is cached: under the node the code runs as. */
const cacheKey = (key: string): string => `${currentNodeId() ?? ''}\u0000${key}`;

// The storage layer of each node, filed by initRevocationStorage() under the node id and read for the
// node the code runs as (./node-auth.ts): its revoked-token table and, for the mint check, its
// accounts. Code that runs as no node reads the one filed last. One expiry sweep per node.
const revocationStore = new PerNode<Storage>('last');
const cleanupSweeps = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Initialize the token revocation system with a persistent storage backend. Called once per node
 * during server startup (after storage is created), with that node's id; without one, the storage is
 * filed for the node the code runs as. A production process serves one node.
 */
export function initRevocationStorage(storage: Storage, nodeId?: string): void {
  const key = revocationStore.set(storage, nodeId);

  // Periodic cleanup of this node's expired revoked tokens (every 60 seconds)
  const previous = cleanupSweeps.get(key);
  if (previous) clearInterval(previous);
  cleanupSweeps.set(key, setInterval(async () => {
    try {
      await storage.cleanExpiredRevocations();
    } catch (err) {
      // Non-critical for the request path, but not free: a cleanup that keeps failing means the
      // revoked-token table grows without bound, and nobody would ever find out.
      logger.warn('Expired-revocation cleanup failed; revoked token rows are accumulating', { error: (err as Error).message });
    }
    // Also evict stale cache entries
    const now = Date.now();
    for (const [cached, entry] of revocationCache) {
      if (now - entry.cachedAt > CACHE_TTL_MS) {
        revocationCache.delete(cached);
      }
    }
  }, 60_000));
}

/**
 * Revoke a token, under its id (tokenIdOf), so every spelling of it is revoked. Persists to storage
 * and updates the in-memory cache.
 */
export async function revokeToken(token: string, expiresAt: number): Promise<void> {
  const id = tokenIdOf(token);

  // Persist to the storage of the node the code runs as
  const storage = revocationStore.get();
  if (storage) {
    await storage.revokeToken(id, expiresAt);
  }

  // Update cache
  revocationCache.set(cacheKey(id), { revoked: true, cachedAt: Date.now() });

  // P2: if this token, in any spelling (the tunnel matches on tokenIdOf), holds a live connector
  // tunnel, push `auth_revoked` + close it now so the agent re-auths immediately instead of probing
  // for liveness. Decoupled via a registered hook (the tunnel manager registers it) so this
  // foundational auth module never imports the tunnel.
  try {
    _onTokenRevoked?.(token);
  } catch (err) {
    // The hook is optional, but a failure here means a REVOKED bearer may still hold an open tunnel
    // until it next probes — a security-relevant miss that must not be invisible.
    logger.warn('Token revoked, but the tunnel-close hook failed; a revoked session may stay open', { error: (err as Error).message });
  }
}

/**
 * Hook invoked with the raw token whenever a token is revoked — the connector tunnel manager
 * registers it to push `auth_revoked` to a live socket. Null = no tunnel (the common case in tests).
 */
let _onTokenRevoked: ((token: string) => void) | null = null;
export function setTokenRevokedHook(fn: ((token: string) => void) | null): void { _onTokenRevoked = fn; }

/**
 * Check if a token has been revoked: under its id, which every spelling of it shares, and under the
 * hash of its exact string, where a revocation made before 2026-09-26 was filed (spellingHashOf).
 */
export async function isRevoked(token: string): Promise<boolean> {
  if (await revokedUnder(tokenIdOf(token))) return true;
  return revokedUnder(spellingHashOf(token));
}

/**
 * One key of the revoked-token table: the in-memory cache as L1, storage on a miss. Each key has its
 * own cache entry: the old key differs per spelling, so its answer is never cached under the id that
 * every spelling shares.
 */
async function revokedUnder(key: string): Promise<boolean> {
  // L1: Check in-memory cache
  const cachedUnder = cacheKey(key);
  const cached = revocationCache.get(cachedUnder);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.revoked;
  }

  // L2: Check the storage of the node the code runs as
  const storage = revocationStore.get();
  if (storage) {
    const revoked = await storage.isTokenRevoked(key);
    revocationCache.set(cachedUnder, { revoked, cachedAt: Date.now() });
    return revoked;
  }

  return false;
}
