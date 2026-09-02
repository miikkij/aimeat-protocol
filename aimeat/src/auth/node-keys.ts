/**
 * @file src/auth/node-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 — 2026-09-03 — THE KEY BELONGS TO THE NODE, NOT THE MACHINE. The path had no node in it
 *     and no way to configure it, so every node process on one host loaded the same keypair: two
 *     nodes started side by side published an IDENTICAL federation public key, and a signature from
 *     one verified as the other. That makes the unconditional attestation verification hardened in
 *     v1.6.0 of register-login decide nothing between them — and it is not an exotic setup, it is
 *     what someone does when they try federation before deploying it (measured 2026-09-02).
 *     Now `$HOME/.aimeat/nodes/<nodeId>/node-key.json`, overridable with AIMEAT_NODE_KEY_PATH
 *     (documented in .env.example with a safe default). The old shared file is still READ when this
 *     node has none, so no existing install loses its identity, and the first node to adopt it
 *     stamps its id inside — a second node reads that stamp, declines the file and generates its
 *     own. Refusing to START belongs to the RESOLVED path instead: two node ids pointed at one
 *     AIMEAT_NODE_KEY_PATH is a real shared identity, and it is refused naming both nodes. The
 *     first draft had the refusal on the legacy branch, where nothing is shared because the second
 *     node has a path of its own; that stopped an E2E suite from starting at all (2026-09-03), and
 *     would have stopped any machine with a personal install from ever running a second node.
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

/**
 * WHERE THIS NODE'S KEY LIVES — per NODE, not per machine.
 *
 * It used to be `$HOME/.aimeat/node-key.json` with no node in the path and no way to configure it,
 * so every node process on one host loaded the SAME keypair. Two nodes started side by side
 * published an identical federation public key, which means a signature from one verifies as the
 * other: the unconditional attestation verification hardened over two rounds decides nothing
 * between them. That is not an exotic setup — it is what a person does when they try federation
 * before deploying it, and it is how this was found (2026-09-02, two local nodes, one key).
 *
 * `AIMEAT_NODE_KEY_PATH` wins when set and is then authoritative: an explicit path is an operator
 * decision and must not be second-guessed by a fallback. Otherwise the path carries the node id,
 * so two nodes on one machine cannot collide unless they claim the same identity — at which point
 * they are the same node and sharing a key is correct.
 */
function getNodeKeyPath(config?: AimeatConfig): string {
  const explicit = process.env.AIMEAT_NODE_KEY_PATH?.trim();
  if (explicit) return explicit;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  if (!config?.nodeId) return join(home, '.aimeat', 'node-key.json');
  // Node ids are `[a-z0-9-]`-shaped, but a path is not the place to trust that. Separators become
  // underscores so the id stays ONE segment — and a segment of nothing but dots is replaced
  // outright, because `..` survives the character filter and `join(..., '..', ...)` walks back out
  // of the directory, landing on the legacy shared file this change exists to stop sharing.
  const oneSegment = config.nodeId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeId = /^\.+$/.test(oneSegment) ? `node_${Buffer.from(config.nodeId).toString('hex')}` : oneSegment;
  return join(home, '.aimeat', 'nodes', safeId, 'node-key.json');
}

/** The single shared file every install used before 2026-09-03. Read, and claimed; never moved. */
function getLegacyNodeKeyPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return join(home, '.aimeat', 'node-key.json');
}

/**
 * Which node id already owns a key file, if any.
 *
 * The claim lives INSIDE the file rather than beside it, so it travels with the thing it is about
 * and a stray marker cannot outlive the key or vice versa. It also sits OUTSIDE the encrypted blob,
 * because "who owns this key" has to be answerable without the passphrase. An unreadable or
 * unparseable file answers `null` here on purpose: `loadPersistedNodeKey` is the one that refuses
 * to start over a broken file, and it says so far better than a duplicate check would.
 */
function readKeyFileClaim(keyPath: string): string | null {
  try {
    const data = JSON.parse(readFileSync(keyPath, 'utf-8')) as { nodeId?: unknown };
    return typeof data.nodeId === 'string' && data.nodeId ? data.nodeId : null;
  } catch {
    // An unreadable key file is not this function's to report: loadPersistedNodeKey refuses to
    // start over it, and says why far better than a duplicate check here could.
    // eslint-disable-next-line aimeat/no-silent-catch
    return null;
  }
}

/** Record which node owns a key file, leaving the keypair itself untouched. */
function stampKeyFileClaim(keyPath: string, nodeId: string): void {
  try {
    const data = JSON.parse(readFileSync(keyPath, 'utf-8')) as Record<string, unknown>;
    if (data.nodeId === nodeId) return;
    writeFileSync(keyPath, JSON.stringify({ ...data, nodeId }, null, 2) + '\n', { mode: 0o600 });
  } catch (err) {
    // Not fatal: the node has its key and runs. It means a SECOND node could later adopt the same
    // file and share this identity, so it is loud.
    logger.error('Could not record which node owns this key file. Another node on this machine '
      + 'could adopt the same identity without being refused. Give each node its own '
      + 'AIMEAT_NODE_KEY_PATH.', { path: keyPath, nodeId, error: (err as Error).message });
  }
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
function loadPersistedNodeKey(keyPath: string): { publicKey: string; privateKey: string } | null {
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

function persistNodeKey(kp: { publicKey: string; privateKey: string }, keyPath: string): void {
  try {
    const dir = dirname(keyPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const passphrase = process.env.AIMEAT_KEY_PASSPHRASE;
    if (passphrase) {
      // P3-8: Encrypt the key file using AES-256-GCM with passphrase-derived key
      const encrypted = encryptNodeKey(kp, passphrase);
      writeFileSync(keyPath, JSON.stringify(encrypted, null, 2) + '\n', { mode: 0o600 });
      logger.info('Node key encrypted and saved', { path: keyPath });
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
      const keyPath = getNodeKeyPath(config);
      const legacyPath = getLegacyNodeKeyPath();

      // THE NODE'S OWN FILE FIRST — and this is where "two nodes, one file" is actually possible.
      // The default path carries the node id, so it cannot collide; an explicit
      // AIMEAT_NODE_KEY_PATH can, and pointing two node ids at one file is the exact failure this
      // whole change exists to stop. Refuse, and name both nodes: an operator who set that variable
      // needs to know WHICH other node already owns the file, not merely that something is wrong.
      const ownerOfKeyFile = existsSync(keyPath) ? readKeyFileClaim(keyPath) : null;
      if (ownerOfKeyFile && ownerOfKeyFile !== config.nodeId) {
        logger.error('This key file already belongs to another node, so this one will not start. Two '
          + 'nodes sharing one key share one federation identity: a signature from either verifies as '
          + 'the other, and the attestation check decides nothing between them. Point '
          + 'AIMEAT_NODE_KEY_PATH at a file of this node\'s own, or unset it to use the per-node '
          + 'default.', { path: keyPath, ownedBy: ownerOfKeyFile, thisNode: config.nodeId });
        process.exit(1);
      }

      nodeKey = loadPersistedNodeKey(keyPath);
      if (nodeKey) {
        await storage.setNodeKey(nodeKey.publicKey, nodeKey.privateKey);
        stampKeyFileClaim(keyPath, config.nodeId);
        logger.info('Node key loaded', { path: keyPath, nodeId: config.nodeId });
      } else if (keyPath !== legacyPath && existsSync(legacyPath)) {
        // THE OLD SHARED FILE, ADOPTED RATHER THAN ABANDONED. Every install before 2026-09-03 kept
        // its key here, and a node that silently regenerates its identity is a node whose peers all
        // stop trusting it — so this is read, in place, and never moved.
        //
        // BUT ONLY ONE NODE MAY HAVE IT. The first node to adopt it stamps its own id inside. A
        // DIFFERENT node arriving here DECLINES the file and falls through to generating its own —
        // it does not refuse to start, because nothing is being shared: this node has a per-node
        // path of its own and was on its way there anyway. Refusing here was wrong and cost a test
        // suite its run on 2026-09-03; the machine that already had a personal install could then
        // never start a second node. The refusal belongs on the RESOLVED path above, where two
        // nodes genuinely land on one file.
        const claimed = readKeyFileClaim(legacyPath);
        if (claimed && claimed !== config.nodeId) {
          logger.info('The pre-2026-09-03 shared key file belongs to another node on this machine, so '
            + 'this node is generating its own identity rather than borrowing one. Nothing is shared, '
            + 'and nothing of that node\'s is touched.',
            { path: legacyPath, ownedBy: claimed, thisNode: config.nodeId });
        } else {
          nodeKey = loadPersistedNodeKey(legacyPath);
          if (nodeKey) {
            await storage.setNodeKey(nodeKey.publicKey, nodeKey.privateKey);
            stampKeyFileClaim(legacyPath, config.nodeId);
            logger.info('Node key loaded from the pre-2026-09-03 shared path, and this node has claimed '
              + 'it. A second node on this machine will generate its own rather than share this one.',
              { path: legacyPath, nodeId: config.nodeId });
          }
        }
      }

      if (!nodeKey) {
        logger.info('Generating node keypair...');
        const kp = await generateKeyPair();
        await storage.setNodeKey(kp.publicKey, kp.privateKey);
        nodeKey = kp;
        persistNodeKey(kp, keyPath);
        // Stamp it now, not on the next boot: the claim is what a SECOND node reads to know this
        // file is taken, and a file written without one is a file anyone may adopt.
        if (existsSync(keyPath)) stampKeyFileClaim(keyPath, config.nodeId);
        logger.info('Node keypair generated and saved', { path: keyPath, nodeId: config.nodeId });
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

/**
 * Path resolution, exposed for the unit test that pins "two nodes on one machine, two identities".
 * Deliberately not part of the module's API: nothing else should be deciding where a node's key
 * lives, and a second caller would be a second answer to that question.
 */
export const __testables = { getNodeKeyPath, getLegacyNodeKeyPath, readKeyFileClaim, stampKeyFileClaim };
