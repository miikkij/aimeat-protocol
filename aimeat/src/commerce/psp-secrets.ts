/**
 * @file src/commerce/psp-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The seller's payment-provider secrets at rest: the Stripe secret key and the Stripe
 *   webhook signing secret in the `commerce.psp` memory record.
 *
 *   WHY THEY ARE ENCRYPTED. The record is an ordinary memory record, and memory has many read doors:
 *   GET /v1/memory/:key (an app grant with memory:read, or an agent with owner_scope), the MCP memory
 *   tools, the operator's GET /v1/admin/memory/:owner/:key and the admin search excerpts, exports and
 *   backups. The commerce doors showed only the last four characters and said the key is never
 *   returned, while every one of those doors returned it whole. Masking each door would leave the
 *   next door someone adds unmasked. Encrypting the value means every generic door carries only
 *   ciphertext and a hint, and only the two places that need the key (the Stripe handler and the
 *   webhook verifier) open it.
 *
 *   A stored secret is `{ encrypted, hint }`. A plain string is still read, because a record written
 *   before this file existed, or written through the raw memory API, holds one; the boot pass
 *   (sealStoredPspRecords) encrypts every such record it finds.
 * @structure
 *   - SealedPspSecret, isSealedPspSecret
 *   - sealPspSecret(key, plain) / openPspSecret(config, stored) / pspSecretHint(stored)
 *   - sealPspRecord(key, record): encrypts the string secrets in one record
 *   - sealStoredPspRecords(storage, config): the boot pass over every owner's record
 * @usage
 *   const key = getEncryptionKey(config); if (!key) refuse;
 *   record.secretKey = sealPspSecret(key, plain);
 *   const stripeKey = openPspSecret(config, psp.secretKey);
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial. The Stripe key was stored in plain text and readable through the
 *     generic memory doors by the owner's apps and agents and by the operator.
 */
import type { Storage } from '../storage/interface.js';
import { encrypt, decrypt, getEncryptionKey } from '../services/encryption.js';
import { logger } from '../utils/logger.js';

export const PSP_RECORD_KEY = 'commerce.psp';
/** The fields of commerce.psp that hold a secret. Everything else in the record is not secret. */
export const PSP_SECRET_FIELDS = ['secretKey', 'webhookSecret'] as const;

type EncryptionConfig = { encryptionKey: string | null; totpSecretEncryptionKey: string | null };

export interface SealedPspSecret {
  /** iv:authTag:ciphertext, services/encryption.ts */
  encrypted: string;
  /** The last four characters, the only form of the secret any door shows. */
  hint: string;
}

export function isSealedPspSecret(v: unknown): v is SealedPspSecret {
  return !!v && typeof v === 'object' && typeof (v as SealedPspSecret).encrypted === 'string';
}

export function sealPspSecret(key: Buffer, plain: string): SealedPspSecret {
  return { encrypted: encrypt(plain, key), hint: plain.length >= 4 ? `…${plain.slice(-4)}` : '(set)' };
}

/**
 * The plain secret, for the one call that sends it to the provider. Empty when there is none, and
 * empty when a sealed value cannot be opened with this node's key (the key was rotated, or the
 * record came from another node): the caller then answers "not configured", which tells the seller
 * to set it again. The failure is logged by name, never by value.
 */
export function openPspSecret(config: EncryptionConfig, stored: unknown): string {
  if (typeof stored === 'string') return stored;
  if (!isSealedPspSecret(stored)) return '';
  const key = getEncryptionKey(config);
  if (!key) {
    logger.warn('psp-secrets: a sealed PSP secret is stored but this node has no encryption key');
    return '';
  }
  try {
    return decrypt(stored.encrypted, key);
  } catch (err) {
    logger.warn('psp-secrets: a sealed PSP secret could not be opened with this node key', { error: String(err) });
    return '';
  }
}

/** The last-four hint for a stored secret, or null when none is stored. */
export function pspSecretHint(stored: unknown): string | null {
  if (isSealedPspSecret(stored)) return typeof stored.hint === 'string' ? stored.hint : '(set)';
  if (typeof stored === 'string' && stored) return stored.length >= 4 ? `…${stored.slice(-4)}` : '(set)';
  return null;
}

/** The record with every plain-string secret field encrypted. `changed` says whether any was. */
export function sealPspRecord<T extends Record<string, unknown>>(key: Buffer, record: T): { record: T; changed: boolean } {
  const next: Record<string, unknown> = { ...record };
  let changed = false;
  for (const field of PSP_SECRET_FIELDS) {
    const v = next[field];
    if (typeof v === 'string' && v) {
      next[field] = sealPspSecret(key, v);
      changed = true;
    }
  }
  return { record: next as T, changed };
}

/**
 * Encrypt every commerce.psp record that still holds a plain secret. Runs at boot and is
 * idempotent: a sealed record is left as it is. On a node without an encryption key it does
 * nothing and says so, because there is nothing to encrypt with.
 */
export async function sealStoredPspRecords(storage: Storage, config: EncryptionConfig): Promise<number> {
  const key = getEncryptionKey(config);
  const { items } = await storage.listAllMemory({ prefix: PSP_RECORD_KEY, limit: 100_000, excludeVersionRows: true });
  const plain = items.filter(r => r.key === PSP_RECORD_KEY && r.value && typeof r.value === 'object'
    && PSP_SECRET_FIELDS.some(f => typeof (r.value as Record<string, unknown>)[f] === 'string'));
  if (plain.length === 0) return 0;
  if (!key) {
    logger.warn(`psp-secrets: ${plain.length} payment record(s) hold a plain secret and this node has no encryption key (AIMEAT_ENCRYPTION_KEY)`);
    return 0;
  }
  let sealed = 0;
  for (const rec of plain) {
    const { record, changed } = sealPspRecord(key, rec.value as Record<string, unknown>);
    if (!changed) continue;
    await storage.setMemory({ ...rec, value: record, version: rec.version + 1, updatedAt: new Date().toISOString() });
    sealed++;
  }
  return sealed;
}
