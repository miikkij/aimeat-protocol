import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pbkdf2Sync, randomBytes as cryptoRandomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { generateKeyPair } from './keypair.js';
import { initNodeKeys } from './jwt.js';
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

function loadPersistedNodeKey(): { publicKey: string; privateKey: string } | null {
  const keyPath = getNodeKeyPath();
  try {
    if (!existsSync(keyPath)) return null;
    const data = JSON.parse(readFileSync(keyPath, 'utf-8'));

    // P3-8: Handle encrypted key file
    if (data.encrypted) {
      const passphrase = process.env.AIMEAT_KEY_PASSPHRASE;
      if (!passphrase) {
        logger.error('Node key file is encrypted but AIMEAT_KEY_PASSPHRASE is not set. Cannot decrypt.');
        process.exit(1);
      }
      return decryptNodeKey(data, passphrase);
    }

    if (data.publicKey && data.privateKey) return data;
    return null;
  } catch {
    return null;
  }
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
    }
  } catch (err) {
    logger.warn('Could not persist node key', { path: keyPath, error: err });
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
    logger.info('Node keys initialized for JWT signing');
  } catch (err) {
    logger.error('Failed to initialize node keys', { error: err });
  }
}
