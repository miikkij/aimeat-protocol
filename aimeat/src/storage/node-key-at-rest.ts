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
 *   isSealedNodeKey · sealNodePrivateKey · openNodePrivateKey · nodeKeySecretsAvailable ·
 *   nodeKeyRowSealedWith · nodeKeySecretsNow
 * @usage
 *   // storage provider
 *   setNodeKey(pub, priv) → store sealNodePrivateKey(priv, pub)
 *   getNodeKey() → { publicKey, privateKey: openNodePrivateKey(row.privateKey, row.publicKey), sealed }
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S4a).
 *   v1.0.1 — 2026-10-10 — The cache of opened rows compares the secrets instead of keying on a
 *     SHA-256 of them (code scanning alert 1726).
 *   v1.0.2 — 2026-11-04 — AES-GCM through utils/aes-gcm.ts, the node's one implementation; the
 *     `nk1:` form is unchanged (codebase analysis 2026-11-03, item B9).
 *   v1.1.0 — 2026-11-05 — With a second data key, a `nk1:e:` row opens under the ring's other key
 *     too (olderDataKeyHexes), and nodeKeyRowSealedWith() tells the re-encrypt job which key sealed it.
 *     The `nk1:` form is unchanged (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { gcmOpen, gcmSeal } from '../utils/aes-gcm.js';

export interface NodeKeySecrets {
  /** AIMEAT_KEY_PASSPHRASE. */
  passphrase?: string | null;
  /** AIMEAT_ENCRYPTION_KEY, 64 hex characters: the data key a row is sealed with. */
  dataKeyHex?: string | null;
  /**
   * The ring's other data key, when AIMEAT_ENCRYPTION_KEY_1 is set (services/encryption.ts): a row
   * sealed with it still opens, and the re-encrypt job seals it again with `dataKeyHex`. Empty or
   * absent on a node with one data key.
   */
  olderDataKeyHexes?: string[];
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
  if (configured) return configured;
  const first = process.env.AIMEAT_ENCRYPTION_KEY ?? null;
  const second = process.env.AIMEAT_ENCRYPTION_KEY_1 || null;
  // The environment's second data key, as auth/node-keys.ts nodeKeyDataKeys() reads it from the config.
  if (!second || !dataKeyOf(second)) return { passphrase: process.env.AIMEAT_KEY_PASSPHRASE ?? null, dataKeyHex: first };
  const secondCurrent = process.env.AIMEAT_ENCRYPTION_KEY_CURRENT === '1' || !first;
  return {
    passphrase: process.env.AIMEAT_KEY_PASSPHRASE ?? null,
    dataKeyHex: secondCurrent ? second : first,
    olderDataKeyHexes: secondCurrent ? (first ? [first] : []) : [second],
  };
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
  const { iv, tag, ct } = gcmSeal(key, privateKey, aadOf(publicKey));
  return `${SEALED_NODE_KEY_PREFIX}${kind}:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
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
  const sealed = { iv: Buffer.from(ivHex, 'hex'), tag: Buffer.from(tagHex, 'hex'), ct: Buffer.from(ctHex, 'hex') };
  // A row sealed with the data key may be under the ring's other key (olderDataKeyHexes), tried after
  // the current one; with one data key the list is empty and the row opens or is refused as before.
  const candidates = kind === 'e' ? [key, ...(secrets.olderDataKeyHexes ?? []).map(dataKeyOf).filter((k): k is Buffer => !!k)] : [key];
  const tried = firstKeyThatOpens(candidates, sealed, publicKey);
  if (!('plain' in tried)) {
    // The GCM tag check failed: turned into a refusal that names the secret.
    throw new NodeKeyLockedError(`The node key in the database does not open with the ${kind === 'p' ? 'AIMEAT_KEY_PASSPHRASE' : 'AIMEAT_ENCRYPTION_KEY'} this server has: the value changed, or the row was altered.`, publicKey);
  }
  const plain = tried.plain;
  if (opened.size > 8) opened.clear();
  opened.set(cacheKey, { plain, passphrase: secrets.passphrase ?? null, dataKeyHex: secrets.dataKeyHex ?? null });
  return plain;
}

/**
 * Which secret a stored row is sealed with, for the data key's re-encrypt job: `plain` (not sealed),
 * `passphrase` (AIMEAT_KEY_PASSPHRASE, untouched by a data key rotation), `current` (opens with the
 * data key that seals now), `older` (opens only with the ring's other data key, so sealing it again
 * moves it) or `unreadable` (opens with none of them).
 */
export function nodeKeyRowSealedWith(stored: string, publicKey: string, secrets: NodeKeySecrets = secretsNow()): 'plain' | 'passphrase' | 'current' | 'older' | 'unreadable' {
  if (!isSealedNodeKey(stored)) return 'plain';
  const parts = stored.slice(SEALED_NODE_KEY_PREFIX.length).split(':');
  if (parts.length !== 5) return 'unreadable';
  if (parts[0] === 'p') return 'passphrase';
  if (parts[0] !== 'e') return 'unreadable';
  const sealed = { iv: Buffer.from(parts[2], 'hex'), tag: Buffer.from(parts[3], 'hex'), ct: Buffer.from(parts[4], 'hex') };
  const keysOf = (hexes: Array<string | null | undefined>): Buffer[] => hexes.map(dataKeyOf).filter((k): k is Buffer => !!k);
  if ('plain' in firstKeyThatOpens(keysOf([secrets.dataKeyHex]), sealed, publicKey)) return 'current';
  return 'plain' in firstKeyThatOpens(keysOf(secrets.olderDataKeyHexes ?? []), sealed, publicKey) ? 'older' : 'unreadable';
}

/** The first of `keys` the row opens with, and its plain text; or the last failure when none opens. */
function firstKeyThatOpens(keys: Buffer[], sealed: { iv: Buffer; tag: Buffer; ct: Buffer }, publicKey: string): { plain: string } | { failure: unknown } {
  let failure: unknown = new Error('no key to open the node key row with');
  for (const k of keys) {
    try {
      return { plain: gcmOpen(k, sealed, aadOf(publicKey)).toString('utf8') };
    } catch (err) {
      // The tag check failed for this key; the next key may be the one, and the failure is answered when none is.
      failure = err;
    }
  }
  return { failure };
}

/** The secrets this process seals and opens the row with (configured, or read from the environment). */
export function nodeKeySecretsNow(): NodeKeySecrets {
  return secretsNow();
}
