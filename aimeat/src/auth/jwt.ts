import { SignJWT, jwtVerify, importPKCS8, importSPKI, exportPKCS8, exportSPKI } from 'jose';
import * as ed from '@noble/ed25519';

// We use EdDSA JWTs signed with the node's private key
// jose requires CryptoKey objects, so we convert from raw Ed25519 bytes

let nodePrivateKey: CryptoKey | null = null;
let nodePublicKey: CryptoKey | null = null;

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
  sub: string;        // GAII or owner
  owner: string;
  node: string;
  roles: string[];
  scopes?: string[];  // omitted = ['*'] for backward compat
}

export async function issueJWT(payload: JWTPayload, ttlSeconds: number): Promise<string> {
  if (!nodePrivateKey) throw new Error('Node keys not initialized');

  return new SignJWT({
    owner: payload.owner,
    node: payload.node,
    roles: payload.roles,
    scopes: payload.scopes ?? ['*'],
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(nodePrivateKey);
}

export interface VerifiedToken {
  sub: string;
  owner: string;
  node: string;
  roles: string[];
  exp: number;
  scopes: string[];
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
    };
  } catch {
    return null;
  }
}

// Revocation list (in-memory, TTL-based)
const revokedTokens = new Map<string, number>(); // token -> expiresAt

export function revokeToken(token: string, expiresAt: number): void {
  revokedTokens.set(token, expiresAt);
}

export function isRevoked(token: string): boolean {
  const exp = revokedTokens.get(token);
  if (exp === undefined) return false;
  // Clean up expired entries
  if (Date.now() / 1000 > exp) {
    revokedTokens.delete(token);
    return false;
  }
  return true;
}

// Periodic cleanup of expired revoked tokens
setInterval(() => {
  const now = Date.now() / 1000;
  for (const [token, exp] of revokedTokens) {
    if (now > exp) revokedTokens.delete(token);
  }
}, 60_000);
