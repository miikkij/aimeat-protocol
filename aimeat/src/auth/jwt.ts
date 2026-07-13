/**
 * @file jwt.ts
 * @description EdDSA JWT minting/verification signed with the node's Ed25519 key, plus storage-backed
 *   token revocation. Issues credentials for every authenticated principal — owner (GHII), agent
 *   (GAII), and ecosystem app (GEAI). Optional claims (mcp_client, federated, eco_app, …) are threaded
 *   conditionally so tokens stay minimal.
 * @structure initNodeKeys / issueJWT / verifyJWT / generateSessionId / revokeToken / isRevoked
 * @usage import { issueJWT, verifyJWT } from '../auth/jwt.js';
 * @version-history
 *   v1.1.0 — 2026-06-14 — Add optional `eco_app` claim for GEAI (ecosystem app) sessions.
 */
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import type { Storage } from '../storage/interface.js';

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
  scopes?: string[];  // omitted = ['*'] for backward compat
  mcp_client?: string; // OAuth client name for MCP sessions (e.g. "Claude", "Cursor")
  federated?: boolean;  // true for federated login sessions
  homeNode?: string;    // home node ID for federated sessions
  homeUrl?: string;     // home node base URL for federated sessions
  eco_app?: string;     // ecosystem app global name (e.g. "zendesk") for GEAI (role: ecosystem) sessions
  app_grant?: string;   // app-grant id for scoped, user-approved app tokens (role: app) — H-2
}

/** Generate a unique session ID for JWT tracking. */
export function generateSessionId(): string {
  return `sid-${randomBytes(16).toString('hex')}`;
}

export async function issueJWT(payload: JWTPayload, ttlSeconds: number, sessionId?: string): Promise<string> {
  if (!nodePrivateKey) throw new Error('Node keys not initialized');

  const builder = new SignJWT({
    owner: payload.owner,
    node: payload.node,
    roles: payload.roles,
    scopes: payload.scopes ?? ['*'],
    ...(payload.mcp_client ? { mcp_client: payload.mcp_client } : {}),
    ...(payload.federated ? { federated: true } : {}),
    ...(payload.homeNode ? { homeNode: payload.homeNode } : {}),
    ...(payload.homeUrl ? { homeUrl: payload.homeUrl } : {}),
    ...(payload.eco_app ? { eco_app: payload.eco_app } : {}),
    ...(payload.app_grant ? { app_grant: payload.app_grant } : {}),
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
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
  scopes: string[];
  anonymous?: boolean;
  sessionId?: string;  // P3-7: Server-side session tracking
  mcp_client?: string; // OAuth client name for MCP sessions
  federated?: boolean;  // true for federated login sessions
  homeNode?: string;    // home node ID for federated sessions
  homeUrl?: string;     // home node base URL for federated sessions
  eco_app?: string;     // ecosystem app global name for GEAI (role: ecosystem) sessions
  app_grant?: string;   // app-grant id for scoped, user-approved app tokens (role: app)
}

export async function verifyJWT(token: string): Promise<VerifiedToken | null> {
  if (!nodePublicKey) throw new Error('Node keys not initialized');

  try {
    const { payload } = await jwtVerify(token, nodePublicKey, {
      algorithms: ['EdDSA'],
    });
    return {
      sub: payload.sub as string,
      owner: payload.owner as string,
      node: payload.node as string,
      roles: payload.roles as string[],
      exp: payload.exp as number,
      scopes: (payload.scopes as string[]) ?? ['*'],
      sessionId: payload.jti as string | undefined,
      mcp_client: payload.mcp_client as string | undefined,
      federated: (payload.federated as boolean) ?? false,
      homeNode: payload.homeNode as string | undefined,
      homeUrl: payload.homeUrl as string | undefined,
      eco_app: payload.eco_app as string | undefined,
      app_grant: payload.app_grant as string | undefined,
    };
  } catch {
    return null;
  }
}

// ── Token Revocation (storage-backed with in-memory cache) ─────────────

/** Hash a raw JWT token to a fixed-length hex string for storage. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// In-memory cache for fast repeated lookups (TTL 60 seconds).
// Entries are { revoked: boolean, cachedAt: number }.
const revocationCache = new Map<string, { revoked: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

// Reference to the storage layer, set via initRevocationStorage().
let _storage: Storage | null = null;
let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the token revocation system with a persistent storage backend.
 * Must be called once during server startup (after storage is created).
 */
export function initRevocationStorage(storage: Storage): void {
  _storage = storage;

  // Periodic cleanup of expired revoked tokens (every 60 seconds)
  if (_cleanupInterval) clearInterval(_cleanupInterval);
  _cleanupInterval = setInterval(async () => {
    try {
      await storage.cleanExpiredRevocations();
    } catch {
      // Swallow cleanup errors silently — non-critical
    }
    // Also evict stale cache entries
    const now = Date.now();
    for (const [key, entry] of revocationCache) {
      if (now - entry.cachedAt > CACHE_TTL_MS) {
        revocationCache.delete(key);
      }
    }
  }, 60_000);
}

/**
 * Revoke a token. Persists to storage and updates the in-memory cache.
 */
export async function revokeToken(token: string, expiresAt: number): Promise<void> {
  const hash = hashToken(token);

  // Persist to storage
  if (_storage) {
    await _storage.revokeToken(hash, expiresAt);
  }

  // Update cache
  revocationCache.set(hash, { revoked: true, cachedAt: Date.now() });

  // P2: if this exact bearer holds a live connector tunnel, push `auth_revoked` + close it now so the
  // agent re-auths immediately instead of probing for liveness. Decoupled via a registered hook (the
  // tunnel manager registers it) so this foundational auth module never imports the tunnel.
  try { _onTokenRevoked?.(token); } catch { /* tunnel optional */ }
}

/**
 * Hook invoked with the raw token whenever a token is revoked — the connector tunnel manager
 * registers it to push `auth_revoked` to a live socket. Null = no tunnel (the common case in tests).
 */
let _onTokenRevoked: ((token: string) => void) | null = null;
export function setTokenRevokedHook(fn: ((token: string) => void) | null): void { _onTokenRevoked = fn; }

/**
 * Check if a token has been revoked.
 * Uses in-memory cache as L1, falls back to storage for cache misses.
 */
export async function isRevoked(token: string): Promise<boolean> {
  const hash = hashToken(token);

  // L1: Check in-memory cache
  const cached = revocationCache.get(hash);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.revoked;
  }

  // L2: Check storage
  if (_storage) {
    const revoked = await _storage.isTokenRevoked(hash);
    revocationCache.set(hash, { revoked, cachedAt: Date.now() });
    return revoked;
  }

  return false;
}
