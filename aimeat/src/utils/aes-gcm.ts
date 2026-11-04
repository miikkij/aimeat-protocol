/**
 * @file src/utils/aes-gcm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's one AES-256-GCM implementation. Every value the node encrypts goes through
 *   gcmSeal and comes back through gcmOpen: the stored secrets (services/encryption.ts), the
 *   two-step sign-in secrets (services/totp.ts), the node key in the database
 *   (storage/node-key-at-rest.ts) and in its file (auth/node-keys.ts), and the short-lived claim rows
 *   (services/ephemeral-claims.ts).
 *
 *   WHY ONE. Until 2026-11-04 each of those five files had its own copy of the same twenty lines
 *   (codebase analysis 2026-11-03, security-architecture finding 10, which counted four; the fifth
 *   came with the ephemeral claims the same day). A copy that drifts (an IV reused, a tag not
 *   checked, AAD set after the data) is a defect a reviewer cannot see from the other four.
 *
 *   WHAT IT IS NOT. It chooses no key and no stored form. Each caller keeps the form it has always
 *   written (`iv:tag:ct` in hex, `v2:` and `v3:` for bound values, `nk1:`, base64 of iv|tag|ct, the
 *   key file's JSON), so every value already stored opens as before.
 * @structure GcmSealed · gcmSeal(key, plaintext, aad?) · gcmOpen(key, sealed, aad?)
 * @usage
 *   const { iv, tag, ct } = gcmSeal(key, 'secret', Buffer.from(context, 'utf8'));
 *   const plain = gcmOpen(key, { iv, tag, ct }, Buffer.from(context, 'utf8')).toString('utf8');
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: the five copies call it (codebase analysis 2026-11-03, item B9).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** The three parts AES-GCM produces: a 96-bit IV, the 128-bit tag and the ciphertext. */
export interface GcmSealed {
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

/**
 * Encrypt `plaintext` (UTF-8 when a string) with AES-256-GCM under a fresh random 96-bit IV, and
 * authenticate `aad` with it when given.
 */
export function gcmSeal(key: Buffer, plaintext: string | Buffer, aad?: Buffer): GcmSealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const head = typeof plaintext === 'string' ? cipher.update(plaintext, 'utf8') : cipher.update(plaintext);
  const ct = Buffer.concat([head, cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

/**
 * Open what gcmSeal wrote. Throws when the key, the IV, the tag, the ciphertext or `aad` differ from
 * the seal, so a caller never receives bytes the tag did not cover.
 */
export function gcmOpen(key: Buffer, sealed: GcmSealed, aad?: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ct), decipher.final()]);
}
