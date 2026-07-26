/**
 * @file src/auth/node-keys.ts
 * @description Bootstraps the node's Ed25519 signing keypair: loads it from storage,
 *   falls back to a persisted `~/.aimeat/node-key.json` (optionally AES-256-GCM
 *   encrypted via AIMEAT_KEY_PASSPHRASE), or generates a fresh pair — then wires the
 *   keys into every token subsystem (JWT, upload/download/confirm/share/draft tokens).
 *
 * @structure
 *   - encryptNodeKey/decryptNodeKey: AES-256-GCM + PBKDF2 key-file protection (P3-8)
 *   - loadPersistedNodeKey/persistNodeKey: read/write the on-disk key file (0o600)
 *   - initializeNode(config, storage): resolve/generate keys and init all token signers
 *
 * @version-history
 *   v1.1.0 — 2026-07-26 — loadPersistedNodeKey distinguishes "no key file" from "cannot read the key
 *     file". It used to answer null to both, and the caller's answer to null is to generate a NEW
 *     keypair — silently changing the node identity so issued JWTs and pinned peer keys stop
 *     verifying. An unreadable/corrupt/undecryptable file now refuses to start. A failed persist is
 *     logged at error, because the node is then one restart away from a new identity.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pbkdf2Sync, randomBytes as cryptoRandomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from './keypair.js';
import { initNodeKeys, getNodeCryptoKeys } from './jwt.js';
import { initUploadTokenKeys } from '../services/upload-token.js';
import { initConfirmTokenKeys } from '../services/operator-confirm.js';
import { initDownloadTokenKeys } from '../services/download-token.js';
import { initShareTokenKeys } from '../services/share-token.js';
import { initDraftTokenKeys } from '../services/draft-token.js';
import { logger } from '../utils/logger.js';

// ── P3-8: Node Key Encryption Helpers ────────────────────────────────

interface EncryptedKeyFile {
  encrypted: true;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
}

function getNodeKeyPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return join(home, '.aimeat', 'node-key.json');
}

function encryptNodeKey(
  kp: { publicKey: string; privateKey: string },
  passphrase: string,
): EncryptedKeyFile {
  const salt = cryptoRandomBytes(32);
  const iv = cryptoRandomBytes(12); // 96-bit IV for AES-256-GCM
  const derivedKey = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha512');

  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
  const plaintext = JSON.stringify({ publicKey: kp.publicKey, privateKey: kp.privateKey });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: true,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

function decryptNodeKey(
  file: EncryptedKeyFile,
  passphrase: string,
): { publicKey: string; privateKey: string } {
  const salt = Buffer.from(file.salt, 'hex');
  const iv = Buffer.from(file.iv, 'hex');
  const authTag = Buffer.from(file.authTag, 'hex');
  const encryptedData = Buffer.from(file.data, 'hex');
  const derivedKey = pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha512');

  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  const data = JSON.parse(decrypted.toString('utf-8'));

  if (!data.publicKey || !data.privateKey) {
    throw new Error('Decrypted key file does not contain valid key data');
  }

  return { publicKey: data.publicKey, privateKey: data.privateKey };
}

/**
 * Read the persisted key file. `null` means ONE thing: there is no key file, so the caller may
 * generate a fresh identity.
 *
 * Everything else is fatal on purpose. This function used to end in `catch { return null; }`, so a
 * key file that existed but could not be read (permissions, truncation, a half-written file, invalid
 * JSON) was indistinguishable from "no key yet" — and the caller's response to null is to GENERATE A
 * NEW KEYPAIR. That silently changes the node's identity: every JWT it issued stops verifying and
 * every federation peer that pinned the old public key rejects it. Refusing to start is recoverable;
 * a new identity is not.
 */
function loadPersistedNodeKey(): { publicKey: string; privateKey: string } | null {
  const keyPath = getNodeKeyPath();
  if (!existsSync(keyPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(keyPath, 'utf-8');
  } catch (err) {
    logger.error('Node key file exists but could not be read. Refusing to start with a NEW identity — '
      + 'fix the file permissions, or move the file aside if you intend to regenerate the node key.',
      { path: keyPath, error: (err as Error).message });
    process.exit(1);
  }

  let data: { encrypted?: boolean; publicKey?: string; privateKey?: string };
  try {
    data = JSON.parse(raw);
  } catch (err) {
    logger.error('Node key file exists but is not valid JSON. Refusing to start with a NEW identity — '
      + 'restore the file from backup, or move it aside if you intend to regenerate the node key.',
      { path: keyPath, error: (err as Error).message });
    process.exit(1);
  }

  // P3-8: Handle encrypted key file
  if (data.encrypted) {
    const passphrase = process.env.AIMEAT_KEY_PASSPHRASE;
    if (!passphrase) {
      logger.error('Node key file is encrypted but AIMEAT_KEY_PASSPHRASE is not set. Cannot decrypt.');
      process.exit(1);
    }
    try {
      return decryptNodeKey(data as EncryptedKeyFile, passphrase);
    } catch (err) {
      logger.error('Node key file could not be decrypted (wrong AIMEAT_KEY_PASSPHRASE, or the file is '
        + 'corrupt). Refusing to start with a NEW identity.', { path: keyPath, error: (err as Error).message });
      process.exit(1);
    }
  }

  if (data.publicKey && data.privateKey) {
    return { publicKey: data.publicKey, privateKey: data.privateKey };
  }
  logger.error('Node key file is present but holds no keypair. Refusing to start with a NEW identity — '
    + 'move the file aside if you intend to regenerate the node key.', { path: keyPath });
  process.exit(1);
}

function persistNodeKey(kp: { publicKey: string; privateKey: string }): void {
  const keyPath = getNodeKeyPath();
  try {
    const dir = dirname(keyPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const passphrase = process.env.AIMEAT_KEY_PASSPHRASE;
    if (passphrase) {
      // P3-8: Encrypt the key file using AES-256-GCM with passphrase-derived key
      const encrypted = encryptNodeKey(kp, passphrase);
      writeFileSync(keyPath, JSON.stringify(encrypted, null, 2) + '\n', { mode: 0o600 });
      logger.info('Node key encrypted and saved to ~/.aimeat/node-key.json');
    } else {
      // Backward compatible: write plaintext
      writeFileSync(keyPath, JSON.stringify({ publicKey: kp.publicKey, privateKey: kp.privateKey }, null, 2) + '\n', { mode: 0o600 });
      if (process.platform === 'win32') {
        logger.warn('Node key saved without encryption. Windows does not enforce 0o600 permissions. Set AIMEAT_KEY_PASSPHRASE.');
      }
    }
  } catch (err) {
    // Not fatal (a read-only home directory is a legitimate deployment), but it MUST be loud: the
    // node is now running on an in-memory key and will come back with a different identity after a
    // restart, which looks like a federation/JWT bug hours later.
    logger.error('Could not persist the node key. This node is running on an IN-MEMORY key and will '
      + 'have a DIFFERENT identity after restart — previously issued tokens and pinned peer keys will '
      + 'stop verifying. Fix the path permissions or set the key explicitly in config.',
      { path: keyPath, error: (err as Error).message });
  }
}

/**
 * Initialize node keys: load from storage, fall back to persisted file, or generate new.
 */
export async function initializeNode(config: AimeatConfig, storage: Storage): Promise<void> {
  try {
    let nodeKey = await storage.getNodeKey();
    if (!nodeKey) {
      // I-3: Try loading persisted key from ~/.aimeat/node-key.json
      nodeKey = loadPersistedNodeKey();
      if (nodeKey) {
        await storage.setNodeKey(nodeKey.publicKey, nodeKey.privateKey);
        logger.info('Node key loaded from ~/.aimeat/node-key.json');
      } else {
        logger.info('Generating node keypair...');
        const kp = await generateKeyPair();
        await storage.setNodeKey(kp.publicKey, kp.privateKey);
        nodeKey = kp;
        persistNodeKey(kp);
        logger.info('Node keypair generated and saved to ~/.aimeat/node-key.json');
      }
    }
    await initNodeKeys(nodeKey.publicKey, nodeKey.privateKey);
    const { privateKey, publicKey } = getNodeCryptoKeys();
    initUploadTokenKeys(privateKey, publicKey);
    initDownloadTokenKeys(privateKey, publicKey);
    initConfirmTokenKeys(privateKey, publicKey);
    initShareTokenKeys(privateKey, publicKey);
    initDraftTokenKeys(privateKey, publicKey);
    logger.info('Node keys initialized for JWT signing');
  } catch (err) {
    logger.error('Failed to initialize node keys', { error: err });
  }
}
