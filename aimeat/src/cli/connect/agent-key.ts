/**
 * @file agent-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector half of Agent v2 identity: an agent's own Ed25519 key, the card it
 *   signs with it, and the short-lived credentials it mints from it.
 *
 *   WHAT CHANGES ON DISK. A v1 agent stores a ninety-day bearer at
 *   `<AIMEAT_HOME>/tokens/{agent}@{owner}.token`. A v2 agent stores a private key at
 *   `<AIMEAT_HOME>/keys/{agent}@{owner}.key` and no bearer at all. Both are worth protecting — a key
 *   is a credential — but the difference is what a copy is worth over time: the token file is three
 *   months of access to somebody's account, the key file mints one hour at a time from a node that
 *   can stop honouring it the moment the owner says so.
 *
 *   THE TWO DIRECTORIES ARE WHY BOTH PATHS RUN SIDE BY SIDE. `listAllTokens()` finds v1 agents and
 *   `listAllAgentKeys()` finds v2 ones; a daemon that restarts picks up both and neither knows about
 *   the other. Nothing in the v1 path reads this file.
 *
 *   THE CACHE. A minted token is held in memory until shortly before it expires, so a burst of calls
 *   is one signature rather than one per call, and a restart mints fresh. It is deliberately not
 *   written anywhere: a cached bearer on disk is the thing this whole path exists to remove.
 *
 * @structure
 *   - key store: storeAgentKey / getAgentKey / deleteAgentKey / listAllAgentKeys / hasAgentKey
 *   - crypto: generateAgentKey / signCompact
 *   - credentials: mintAgentToken / resolveToken
 * @usage
 *   const key = await generateAgentKey();
 *   const jws = await signCompact(card, key.privateKey, key.kid);
 *   const token = await resolveToken(agent, owner, nodeUrl);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompactSign, importJWK, calculateJwkThumbprint, generateKeyPair, exportJWK } from 'jose';
import { getConfigDir } from './config.js';
import { getToken } from './keychain.js';
import { parseTokenFilename } from './keychain.js';
import { logger } from '../../utils/logger.js';

/** The grant type the node's /v1/agents/v2/token accepts. Kept in step with routes/agents-v2/token.ts. */
export const AGENT_KEY_GRANT = 'urn:aimeat:params:oauth:grant-type:agent-key';

/** Mint a fresh token once fewer than this many seconds of the held one remain. */
const REFRESH_MARGIN_SECONDS = 300;
/** How long a signed assertion is valid. Long enough for one round trip and nothing else. */
const ASSERTION_LIFETIME_SECONDS = 60;

function keysDir(): string {
  const dir = join(getConfigDir(), 'keys');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function keyPath(agent: string, owner: string): string {
  return join(keysDir(), `${agent}@${owner}.key`);
}

export interface AgentKey {
  /** The private half, base64url. */
  privateKey: string;
  /** The public half, base64url — the `x` of the JWK the card carries. */
  publicKey: string;
  /** RFC 7638 thumbprint, named in the JWS header and in the card. */
  kid: string;
}

/** A fresh Ed25519 keypair for one agent, in the shape a card and an assertion both want. */
export async function generateAgentKey(): Promise<AgentKey> {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const priv = await exportJWK(pair.privateKey);
  const pub = await exportJWK(pair.publicKey);
  if (!priv.d || !pub.x) throw new Error('Key generation produced an unusable Ed25519 key');
  const kid = await calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: pub.x }, 'sha256');
  return { privateKey: priv.d, publicKey: pub.x, kid };
}

/** Sign a JSON payload as a compact JWS with an agent's private key. */
export async function signCompact(payload: unknown, privateKeyBase64Url: string, publicKeyBase64Url: string, kid: string): Promise<string> {
  const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', d: privateKeyBase64Url, x: publicKeyBase64Url }, 'EdDSA');
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .sign(key);
}

/**
 * What is written to disk for one v2 agent: the key halves, their thumbprint, and WHICH IDENTITY ON
 * WHICH NODE they are for. No bearer.
 *
 * The identity is stored rather than derived because the assertion's audience is the node id, and an
 * assertion whose audience is wrong is refused. Deriving it from a filename would mean guessing.
 */
interface StoredKey { privateKey: string; publicKey: string; kid: string; gaii: string; nodeId: string }

/** A key on disk, with the identity it belongs to. */
export interface AgentKeyRecord extends AgentKey { gaii: string; nodeId: string }

export async function storeAgentKey(agent: string, owner: string, record: AgentKeyRecord): Promise<void> {
  const doc: StoredKey = {
    privateKey: record.privateKey, publicKey: record.publicKey, kid: record.kid,
    gaii: record.gaii, nodeId: record.nodeId,
  };
  writeFileSync(keyPath(agent, owner), JSON.stringify(doc), { mode: 0o600 });
}

export async function getAgentKey(agent: string, owner: string): Promise<AgentKeyRecord | null> {
  const p = keyPath(agent, owner);
  if (!existsSync(p)) return null;
  try {
    const doc = JSON.parse(readFileSync(p, 'utf-8')) as StoredKey;
    if (!doc.privateKey || !doc.publicKey || !doc.kid || !doc.gaii || !doc.nodeId) return null;
    return { privateKey: doc.privateKey, publicKey: doc.publicKey, kid: doc.kid, gaii: doc.gaii, nodeId: doc.nodeId };
  } catch (err) {
    logger.warn('agent-key: unreadable key file, skip', { error: String(err) });
    return null;
  }
}

export function hasAgentKey(agent: string, owner: string): boolean {
  return existsSync(keyPath(agent, owner));
}

export async function deleteAgentKey(agent: string, owner: string): Promise<boolean> {
  const p = keyPath(agent, owner);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  tokenCache.delete(`${agent}@${owner}`);
  return true;
}

export interface StoredAgentKey { agent: string; owner: string; key: AgentKeyRecord }

/**
 * Every v2 agent this machine holds a key for. The parallel of listAllTokens(): a restarting daemon
 * reads both directories and serves the union, so an owner with one of each does not have to know
 * which is which.
 */
export async function listAllAgentKeys(): Promise<StoredAgentKey[]> {
  let entries: string[];
  try {
    entries = readdirSync(keysDir());
  } catch (err) {
    logger.warn('agent-key: keys directory unreadable', { error: String(err) });
    return [];
  }
  const out: StoredAgentKey[] = [];
  for (const name of entries) {
    if (!name.endsWith('.key')) continue;
    // Same `{agent}@{owner}` grammar as the token files, so one parser answers for both.
    const parsed = parseTokenFilename(`${name.slice(0, -'.key'.length)}.token`);
    if (!parsed) continue;
    const key = await getAgentKey(parsed.agent, parsed.owner);
    if (!key) continue;
    out.push({ agent: parsed.agent, owner: parsed.owner, key });
  }
  return out;
}

// ── Credentials ──────────────────────────────────────────────────────────────

interface CachedToken { token: string; expiresAtMs: number }
const tokenCache = new Map<string, CachedToken>();

/**
 * Exchange the agent's key for a short-lived credential. One signed assertion, one POST, one token.
 * Throws with the node's own message on a refusal — the caller (the tunnel client's getToken) turns
 * a null or a throw into the "run aimeat connect" guidance, and a wrong answer here should not look
 * like a network blip.
 */
export async function mintAgentToken(
  nodeUrl: string, key: AgentKeyRecord,
): Promise<{ token: string; expiresInSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signCompact({
    sub: key.gaii,
    aud: key.nodeId,
    iat: now,
    exp: now + ASSERTION_LIFETIME_SECONDS,
    jti: randomUUID(),
  }, key.privateKey, key.publicKey, key.kid);

  const res = await fetch(`${nodeUrl.replace(/\/+$/, '')}/v1/agents/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ grant_type: AGENT_KEY_GRANT, assertion }),
  });
  const text = await res.text();
  let body: { access_token?: string; expires_in?: number; error?: { message?: string } } | null;
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: the node did not send JSON, and the status below is what the caller needs
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok || !body?.access_token) {
    throw new Error(body?.error?.message ?? `Token exchange failed (${res.status})`);
  }
  return { token: body.access_token, expiresInSeconds: body.expires_in ?? 3600 };
}

/**
 * The token to use for this agent right now.
 *
 * A v2 agent (one with a key on disk) mints, and holds the result in memory until shortly before it
 * expires. A v1 agent reads its stored bearer, exactly as before. Every caller in the daemon goes
 * through here so neither has to know which kind it is holding.
 */
export async function resolveToken(agent: string, owner: string, nodeUrl: string): Promise<string | null> {
  const key = await getAgentKey(agent, owner);
  if (!key) return getToken(agent, owner);

  const cacheKey = `${agent}@${owner}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - Date.now() > REFRESH_MARGIN_SECONDS * 1000) return cached.token;

  try {
    const minted = await mintAgentToken(nodeUrl, key);
    tokenCache.set(cacheKey, { token: minted.token, expiresAtMs: Date.now() + minted.expiresInSeconds * 1000 });
    return minted.token;
  } catch (err) {
    logger.warn('agent-key: could not mint a credential', { agent, error: String(err) });
    return null;
  }
}

/**
 * Hold a credential the node has just handed us — the one enrolment returns. Without this the
 * daemon would immediately sign a second assertion for a token it is already holding.
 */
export function cacheToken(agent: string, owner: string, token: string, expiresInSeconds: number): void {
  tokenCache.set(`${agent}@${owner}`, { token, expiresAtMs: Date.now() + expiresInSeconds * 1000 });
}

/** Drop a cached credential — after a revocation, or when an agent is removed. */
export function forgetCachedToken(agent: string, owner: string): void {
  tokenCache.delete(`${agent}@${owner}`);
}
