/**
 * @file extension-secrets.ts
 * @description Secret-config wiring for the Extension system (S-C / §18). Extension config
 *   fields marked `type: 'secret'` in a manifest (extension-level `config:` or per-instance
 *   `instances.config_per_instance`) are encrypted at rest with AES-256-GCM (the node master
 *   key via services/encryption.ts) — mirroring the OpenRouter API-key pattern — and decrypted
 *   only just before being handed to the sandbox VM. A secret value is stored as
 *   `{ encrypted: 'iv:tag:ct' }`; API responses show a mask sentinel, never ciphertext or
 *   plaintext.
 * @structure
 *   - computeManifestSecretKeys(manifestConfig) — secret field names from a `config:` descriptor map
 *   - getExtSecretKeys(ext) / getInstanceSecretKeys(ext) — secret keys for a stored record
 *   - encryptSecretFields / decryptSecretFields / maskSecretFields / preserveMaskedSecrets
 * @usage routes/extensions.ts (install/update, instance create/update, action exec, GET mask),
 *   services/scheduler.ts (decrypt before a scheduled action runs)
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial: encrypted secret config fields for extensions (Secretary P5 S-C)
 */

import { encrypt, decrypt } from './encryption.js';
import type { ExtensionRecord } from '../storage/interface.js';

/** Shown in API responses for a secret that is set — never the ciphertext or plaintext. */
export const SECRET_MASK = '••••••••';

/** Internal marker stashed in ExtensionRecord.config listing the extension-level secret field names. */
export const SECRET_KEYS_FIELD = '__secretKeys';

type EncryptedValue = { encrypted: string };

/** True when a value is a stored `{ encrypted: '<iv:tag:ct>' }` wrapper. */
export function isEncryptedValue(v: unknown): v is EncryptedValue {
  return !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).encrypted === 'string';
}

/**
 * Secret field names declared in a manifest `config:` block — descriptors of the form
 * `{ KEY: { type: 'secret', ... } }`. (The generator UI mirrors `type: 'secret'`.)
 */
export function computeManifestSecretKeys(manifestConfig: Record<string, unknown> | undefined): string[] {
  if (!manifestConfig || typeof manifestConfig !== 'object') return [];
  return Object.entries(manifestConfig)
    .filter(([, v]) => v && typeof v === 'object' && (v as Record<string, unknown>).type === 'secret')
    .map(([k]) => k);
}

/** Extension-level secret keys for a stored record (computed at build time into config.__secretKeys). */
export function getExtSecretKeys(ext: Pick<ExtensionRecord, 'config'>): string[] {
  const v = ext.config?.[SECRET_KEYS_FIELD];
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
}

/** Per-instance secret keys for a stored record (derived from the instances JSON-Schema properties). */
export function getInstanceSecretKeys(ext: Pick<ExtensionRecord, 'instances'>): string[] {
  const props = (ext.instances?.configSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props || typeof props !== 'object') return [];
  return Object.entries(props)
    .filter(([, p]) => p && typeof p === 'object' && (p as Record<string, unknown>).type === 'secret')
    .map(([k]) => k);
}

/**
 * Encrypt the secret-typed fields of a config object. Each plaintext string secret becomes
 * `{ encrypted: 'iv:tag:ct' }`. Values that are already encrypted, empty, the mask sentinel,
 * or not strings are passed through unchanged. Returns `null` if a plaintext secret value is
 * present but no encryption key is configured (caller should 503) — secrets are never stored
 * plaintext.
 */
export function encryptSecretFields(
  configObj: Record<string, unknown>,
  secretKeys: string[],
  key: Buffer | null,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...configObj };
  for (const k of secretKeys) {
    const v = out[k];
    if (v === undefined || v === null || v === '' || v === SECRET_MASK) continue;
    if (isEncryptedValue(v)) continue;          // already encrypted — leave as-is
    if (typeof v !== 'string') continue;        // only string secrets supported
    if (!key) return null;                       // needs encryption but no node key
    out[k] = { encrypted: encrypt(v, key) };
  }
  return out;
}

/**
 * Decrypt secret-typed fields back to plaintext strings for use inside the sandbox VM, and
 * strip the internal __secretKeys marker. Best-effort: if no key is configured, encrypted
 * values are blanked rather than leaked as ciphertext into the VM.
 */
export function decryptSecretFields(
  configObj: Record<string, unknown> | undefined,
  secretKeys: string[],
  key: Buffer | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(configObj ?? {}) };
  delete out[SECRET_KEYS_FIELD];
  for (const k of secretKeys) {
    const v = out[k];
    if (isEncryptedValue(v)) out[k] = key ? decrypt(v.encrypted, key) : '';
  }
  return out;
}

/**
 * Replace encrypted secret values with the mask sentinel for safe display in API responses,
 * and strip the internal __secretKeys marker. Set secrets become SECRET_MASK; unset stay absent.
 */
export function maskSecretFields(
  configObj: Record<string, unknown> | undefined,
  secretKeys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(configObj ?? {}) };
  delete out[SECRET_KEYS_FIELD];
  for (const k of secretKeys) {
    if (isEncryptedValue(out[k])) out[k] = SECRET_MASK;
  }
  return out;
}

/**
 * Prepare a freshly built record's config for storage: carry forward the encrypted secrets an
 * incoming manifest omitted, then encrypt the plaintext ones. Returns `null` when a secret needs
 * encrypting and the node has no key, which the caller must refuse on — a secret is never stored
 * in the clear. Shared by the REST install/update routes and the MCP install tool; they did this
 * separately once, and the MCP side simply did not do it at all.
 */
export function prepareSecretConfigForWrite(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  key: Buffer | null,
): Record<string, unknown> | null {
  const secretKeys = getExtSecretKeys({ config: incoming });
  if (!secretKeys.length) return incoming;
  const merged = existing ? preserveMaskedSecrets(incoming, existing, secretKeys) : incoming;
  return encryptSecretFields(merged, secretKeys, key);
}

/**
 * On an update, carry forward existing encrypted secret values when the incoming config omits
 * them or submits the mask sentinel — so a masked UI never wipes a stored secret.
 */
export function preserveMaskedSecrets(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  secretKeys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const prev = existing ?? {};
  for (const k of secretKeys) {
    const v = out[k];
    if (v === undefined || v === '' || v === SECRET_MASK) {
      if (isEncryptedValue(prev[k])) out[k] = prev[k];
      else delete out[k];
    }
  }
  return out;
}
