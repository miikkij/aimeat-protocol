/**
 * @file src/storage/node-key-at-rest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The database copy of the node's private key, encrypted when the node has a secret to
 *   encrypt it with. Both storage providers call this from setNodeKey and getNodeKey, so every one of
 *   the thirty-odd readers of storage.getNodeKey() keeps receiving the plain key it signs with.
 *
 *   WHY. The NodeKey row is read before the key file, and it was plain text, so AIMEAT_KEY_PASSPHRASE
 *   protected the file and nothing else: a database dump or a backup carried the node's federation
 *   identity and its JWT signing key (secrets audit 2026-10-09, node configuration S4a).
 *
 *   THE FORM. `nk1:<kind>:<salt>:<iv>:<tag>:<ciphertext>`, hex parts, AES-256-GCM with
 *   `aimeat-node-key:<public key>` as additional data, so the ciphertext opens only beside the public
 *   key it belongs to. Kind `p`: the key is PBKDF2-SHA512 (100 000 rounds, 32-byte salt) of
 *   AIMEAT_KEY_PASSPHRASE, the derivation the key file uses (auth/node-keys.ts). Kind `e`: the key is
 *   AIMEAT_ENCRYPTION_KEY itself (64 hex characters), and the salt is empty. The passphrase is used
 *   when both are set, because it is the node key's own secret. With neither, the row is written as
 *   before, in plain text. A plain Ed25519 key is base64 and never contains `:`, so the two forms
 *   cannot be mistaken for each other.
 *
 *   A ROW THAT DOES NOT OPEN throws NodeKeyLockedError, never null: the caller of a null node key
 *   generates a new identity, and a new identity is the one outcome that cannot be undone. The boot
 *   (auth/node-keys.ts initializeNode) answers the error by reading the key file with the same public
 *   key, or by refusing to start, and says which secret is missing.
 *
 *   THE SECRETS come from configureNodeKeySecrets(), which initializeNode calls with the node's
 *   config, and from the process environment when nothing configured them (a CLI command that
 *   opens storage on its own). Opened values are cached per row and per secret, because PBKDF2 at
 *   100 000 rounds on every federation signature would cost tens of milliseconds each.
 * @structure NodeKeySecrets · NodeKeyLockedError · SEALED_NODE_KEY_PREFIX · configureNodeKeySecrets ·
 *   isSealedNodeKey · sealNodePrivateKey · openNodePrivateKey · nodeKeySecretsAvailable
 * @usage
 *   // storage provider
 *   setNodeKey(pub, priv) → store sealNodePrivateKey(priv, pub)
 *   getNodeKey() → { publicKey, privateKey: openNodePrivateKey(row.privateKey, row.publicKey), sealed }
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S4a).
 *   v1.0.1 — 2026-10-10 — The cache of opened rows compares the secrets instead of keying on a
 *     SHA-256 of them (code scanning alert 1726).
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

export interface NodeKeySecrets {
  /** AIMEAT_KEY_PASSPHRASE. */
  passphrase?: string | null;
  /** AIMEAT_ENCRYPTION_KEY, 64 hex characters. */
  dataKeyHex?: string | null;
}

/** The stored row cannot be opened with the secrets this process has. */
export class NodeKeyLockedError extends Error {
  constructor(message: string, readonly publicKey: string) {
    super(message);
    this.name = 'NodeKeyLockedError';
  }
}

export const SEALED_NODE_KEY_PREFIX = 'nk1:';
const PBKDF2_ROUNDS = 100_000;

let configured: NodeKeySecrets | null = null;
/**
 * Opened rows, keyed by public key and stored form, with the secrets each was opened with. The
 * secrets are compared as they are rather than hashed into the key: a fast hash of a passphrase is
 * what code scanning alert 1726 flagged, and this process holds the plain secrets anyway.
 */
const opened = new Map<string, { plain: string; passphrase: string | null; dataKeyHex: string | null }>();

/** Set the secrets this process seals and opens with. initializeNode calls it before it reads the row. */
export function configureNodeKeySecrets(secrets: NodeKeySecrets | null): void {
  configured = secrets;
}

function secretsNow(): NodeKeySecrets {
  return configured ?? { passphrase: process.env.AIMEAT_KEY_PASSPHRASE ?? null, dataKeyHex: process.env.AIMEAT_ENCRYPTION_KEY ?? null };
}

function dataKeyOf(hex: string | null | undefined): Buffer | null {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

/** True when this process has a secret to seal the row with. */
export function nodeKeySecretsAvailable(secrets: NodeKeySecrets = secretsNow()): boolean {
  return !!secrets.passphrase || !!dataKeyOf(secrets.dataKeyHex);
}

export function isSealedNodeKey(stored: string): boolean {
  return stored.startsWith(SEALED_NODE_KEY_PREFIX);
}

const aadOf = (publicKey: string): Buffer => Buffer.from(`aimeat-node-key:${publicKey}`, 'utf8');

/** What setNodeKey stores: the sealed form when a secret is set, the plain key otherwise. */
export function sealNodePrivateKey(privateKey: string, publicKey: string, secrets: NodeKeySecrets = secretsNow()): string {
  let kind: 'p' | 'e';
  let salt: Buffer;
  let key: Buffer;
  if (secrets.passphrase) {
    kind = 'p';
    salt = randomBytes(32);
    key = pbkdf2Sync(secrets.passphrase, salt, PBKDF2_ROUNDS, 32, 'sha512');
  } else {
    const dk = dataKeyOf(secrets.dataKeyHex);
    if (!dk) return privateKey;
    kind = 'e';
    salt = Buffer.alloc(0);
    key = dk;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadOf(publicKey));
  const ct = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return `${SEALED_NODE_KEY_PREFIX}${kind}:${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

/** The plain private key from a stored row. A plain row is returned as it is; a sealed one is opened or refused. */
export function openNodePrivateKey(stored: string, publicKey: string, secrets: NodeKeySecrets = secretsNow()): string {
  if (!isSealedNodeKey(stored)) return stored;
  const cacheKey = `${publicKey}:${stored}`;
  const hit = opened.get(cacheKey);
  // A hit counts only for the secrets it was opened with: a changed secret opens the row again.
  if (hit && hit.passphrase === (secrets.passphrase ?? null) && hit.dataKeyHex === (secrets.dataKeyHex ?? null)) return hit.plain;

  const parts = stored.slice(SEALED_NODE_KEY_PREFIX.length).split(':');
  if (parts.length !== 5 || (parts[0] !== 'p' && parts[0] !== 'e')) {
    throw new NodeKeyLockedError('The node key stored in the database is in a form this version does not read.', publicKey);
  }
  const [kind, saltHex, ivHex, tagHex, ctHex] = parts;
  let key: Buffer;
  if (kind === 'p') {
    if (!secrets.passphrase) {
      throw new NodeKeyLockedError('The node key in the database is encrypted with AIMEAT_KEY_PASSPHRASE, and it is not set.', publicKey);
    }
    key = pbkdf2Sync(secrets.passphrase, Buffer.from(saltHex, 'hex'), PBKDF2_ROUNDS, 32, 'sha512');
  } else {
    const dk = dataKeyOf(secrets.dataKeyHex);
    if (!dk) {
      throw new NodeKeyLockedError('The node key in the database is encrypted with AIMEAT_ENCRYPTION_KEY, and it is not set.', publicKey);
    }
    key = dk;
  }
  let plain: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAAD(aadOf(publicKey));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    plain = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // The GCM tag check failed: turned into a refusal that names the secret.
    throw new NodeKeyLockedError(`The node key in the database does not open with the ${kind === 'p' ? 'AIMEAT_KEY_PASSPHRASE' : 'AIMEAT_ENCRYPTION_KEY'} this server has: the value changed, or the row was altered.`, publicKey);
  }
  if (opened.size > 8) opened.clear();
  opened.set(cacheKey, { plain, passphrase: secrets.passphrase ?? null, dataKeyHex: secrets.dataKeyHex ?? null });
  return plain;
}
