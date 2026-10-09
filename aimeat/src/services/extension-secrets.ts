/**
 * @file extension-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Secret-config wiring for the Extension system (S-C / §18). Extension config
 *   fields marked `type: 'secret'` in a manifest (extension-level `config:` or per-instance
 *   `instances.config_per_instance`) are encrypted at rest with AES-256-GCM (the node master
 *   key via services/encryption.ts) — mirroring the OpenRouter API-key pattern — and decrypted
 *   only just before being handed to the sandbox VM. A secret value is stored as
 *   `{ encrypted: 'v2:iv:tag:ct' }`; API responses show a mask sentinel, never ciphertext or
 *   plaintext.
 *
 *   BOUND TO ITS FIELD. The node key is one key for every owner, and the sandbox is the one place
 *   the node decrypts a value and hands the plaintext to code somebody else wrote. Until 2026-10-09 a
 *   ciphertext copied from anywhere (an owner's AI key record, read through a route that forgot to
 *   mask it) and planted in a secret field through a config path that forgot to strip it was opened
 *   here for the planter's script. Every value is now encrypted with its place as AES-GCM additional
 *   data (`ext-config:<extension>:<field>` or `ext-instance:<extension>:<instance>:<field>`,
 *   encryption.ts encryptBound), and this module opens only a value bound to the field it is read
 *   from. A ciphertext from anywhere else fails the tag check and reads as unset, whatever path
 *   carried it in. The door-level strip stays as a second line.
 *
 *   OLD VALUES. Values written before the binding are the unbound form. bindLegacyExtensionSecrets()
 *   rewrites them at boot, once, on positive evidence (they open with the node key); after it a value
 *   in the unbound form is never opened here and is dropped on the next write.
 * @structure
 *   - computeManifestSecretKeys(manifestConfig) — secret field names from a `config:` descriptor map
 *   - getExtSecretKeys(ext) / getInstanceSecretKeys(ext) — secret keys for a stored record
 *   - SecretBinding / secretContext — where a value lives, as the AES-GCM context
 *   - stripClientEncryptedValues — drops a submitted ciphertext at any depth of a config field
 *   - encryptSecretFields / decryptSecretFields / maskSecretFields / preserveMaskedSecrets
 *   - prepareSecretConfigForWrite — carry forward, then encrypt
 *   - bindLegacyExtensionSecrets — the one-time rewrite of unbound values at boot
 * @usage routes/extensions (install/update, instance create/update, action exec, GET mask),
 *   services/extension-system-run.ts and extension-lifecycle.ts (decrypt before a run)
 * @version-history
 *   v1.3.0 — 2026-10-09 — Values are bound to their extension and field (SecretBinding, required on
 *                         every encrypt and decrypt); an already-encrypted value survives a write
 *                         only when it opens under the field's own binding; the strip looks inside a
 *                         field (a manifest descriptor's `default`); bindLegacyExtensionSecrets
 *                         rewrites the old form at boot. Secrets audit 2026-10-09, finding 1.1.
 *   v1.2.0 — 2026-09-13 — An unset secret reads as ABSENT: decryptSecretFields and maskSecretFields
 *                         drop a stored descriptor object, the mask string, an empty value and an
 *                         undecryptable one, and prepareSecretConfigForWrite no longer stores the
 *                         mask or a descriptor on a first install. The sandbox had been handed a
 *                         truthy object or the mask, and extensions sent either as a credential.
 *   v1.1.0 — 2026-08-10 — stripClientEncryptedValues: a value arriving already wrapped in
 *                         { encrypted } is dropped at the door. Only this node mints those, and
 *                         encryptSecretFields passes an already-encrypted value straight through.
 *   v1.0.0 — 2026-06-24 — Initial: encrypted secret config fields for extensions (Secretary P5 S-C)
 */

import { decrypt, encryptBound, decryptBound, isBoundCiphertext } from './encryption.js';
import type { ExtensionRecord, Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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
 * Where a secret config value lives: the extension's own config, or one instance of it. The value is
 * encrypted and decrypted with this place as context, so it opens nowhere else.
 */
export interface SecretBinding { extension: string; instance?: string }

/** The AES-GCM context of one field. */
export function secretContext(bind: SecretBinding, field: string): string {
  return bind.instance !== undefined
    ? `ext-instance:${bind.extension}:${bind.instance}:${field}`
    : `ext-config:${bind.extension}:${field}`;
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

/** True when an encrypted wrapper sits anywhere inside `v` (a descriptor's `default`, an array). */
function carriesEncryptedValue(v: unknown, depth = 0): boolean {
  if (isEncryptedValue(v)) return true;
  if (!v || typeof v !== 'object' || depth > 8) return false;
  return Object.values(v as Record<string, unknown>).some(x => carriesEncryptedValue(x, depth + 1));
}

/**
 * Drop any field whose submitted value is, or contains, the `{ encrypted: … }` shape.
 *
 * Only this node produces those, and only from a plaintext value it just encrypted with its own
 * key. A submitted one is either meaningless or a ciphertext taken from somewhere it should not have
 * been. The check looks inside the field: a manifest declares `{ type: 'secret', default: … }`, and
 * the flatten stores the `default`, so a wrapper one level down was a wrapper stored (secrets audit
 * 2026-10-09). The binding in encryptSecretFields refuses such a value anyway; this tells the author.
 *
 * Applied at the door, to what the CLIENT sent, before any merge with stored values.
 */
export function stripClientEncryptedValues(
  configObj: Record<string, unknown> | undefined,
): { config: Record<string, unknown> | undefined; stripped: string[] } {
  if (!configObj) return { config: configObj, stripped: [] };
  const stripped: string[] = [];
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(configObj)) {
    if (carriesEncryptedValue(v)) { stripped.push(k); continue; }
    kept[k] = v;
  }
  return { config: kept, stripped };
}

/** The plaintext of a stored value bound to `context`, or null when it is not one. */
function openBound(v: EncryptedValue, key: Buffer | null, context: string): string | null {
  if (!key || !isBoundCiphertext(v.encrypted)) return null;
  try {
    return decryptBound(v.encrypted, key, context);
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- a failed tag check IS the answer: the value is not bound to this field, and the caller treats it as unset
    return null;
  }
}

/**
 * Encrypt the secret-typed fields of a config object. Each plaintext string secret becomes
 * `{ encrypted: 'v2:iv:tag:ct' }` bound to its field. An already-encrypted value is kept only when
 * it opens under this field's own binding (a stored secret carried forward); any other wrapper is
 * dropped, so no write path can store a ciphertext that belongs somewhere else. Empty values, the
 * mask sentinel and non-strings pass through unchanged. Returns `null` if a plaintext secret value is
 * present but no encryption key is configured (caller should 503) — secrets are never stored
 * plaintext.
 */
export function encryptSecretFields(
  configObj: Record<string, unknown>,
  secretKeys: string[],
  key: Buffer | null,
  bind: SecretBinding,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...configObj };
  for (const k of secretKeys) {
    const v = out[k];
    if (v === undefined || v === null || v === '' || v === SECRET_MASK) continue;
    if (isEncryptedValue(v)) {
      if (openBound(v, key, secretContext(bind, k)) === null) delete out[k];
      continue;
    }
    if (typeof v !== 'string') continue;        // only string secrets supported
    if (!key) return null;                       // needs encryption but no node key
    out[k] = { encrypted: encryptBound(v, key, secretContext(bind, k)) };
  }
  return out;
}

/**
 * A secret field that holds no VALUE: nothing, an empty string, the mask sentinel, or anything that
 * is neither a string nor an encrypted wrapper. The last case is the manifest descriptor
 * `{ type: 'secret', description }`, which the manifest flatten stored in place of a missing default
 * until 2026-09-13, so records written before then still carry it.
 */
function isUnsetSecret(v: unknown): boolean {
  if (isEncryptedValue(v)) return false;
  return typeof v !== 'string' || v === '' || v === SECRET_MASK;
}

/**
 * Decrypt secret-typed fields back to plaintext strings for use inside the sandbox VM, and
 * strip the internal __secretKeys marker.
 *
 * AN UNSET SECRET IS ABSENT. A field with no value, a stored descriptor object, the mask string, an
 * encrypted value on a node with no key to open it, and an encrypted value not bound to this field
 * are deleted, so `ctx.config.apiKey` is `undefined` and `if (ctx.config.apiKey)` means what it says.
 */
export function decryptSecretFields(
  configObj: Record<string, unknown> | undefined,
  secretKeys: string[],
  key: Buffer | null,
  bind: SecretBinding,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(configObj ?? {}) };
  delete out[SECRET_KEYS_FIELD];
  for (const k of secretKeys) {
    const v = out[k];
    if (isEncryptedValue(v)) {
      const plain = openBound(v, key, secretContext(bind, k));
      if (plain) out[k] = plain;
      else delete out[k];
    } else if (isUnsetSecret(v)) {
      delete out[k];
    }
  }
  return out;
}

/**
 * Replace encrypted secret values with the mask sentinel for safe display in API responses,
 * and strip the internal __secretKeys marker. Set secrets become SECRET_MASK; unset stay absent,
 * including a stored descriptor object or a stored mask string, which would otherwise show as a
 * value (or as the mask, claiming a secret is set when none is).
 */
export function maskSecretFields(
  configObj: Record<string, unknown> | undefined,
  secretKeys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(configObj ?? {}) };
  delete out[SECRET_KEYS_FIELD];
  for (const k of secretKeys) {
    if (isEncryptedValue(out[k])) out[k] = SECRET_MASK;
    else if (k in out && isUnsetSecret(out[k])) delete out[k];
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
  bind: SecretBinding,
): Record<string, unknown> | null {
  const secretKeys = getExtSecretKeys({ config: incoming });
  if (!secretKeys.length) return incoming;
  // Always, not only on an update: on a first install there is nothing to carry forward, and the
  // same pass is what drops a submitted mask or descriptor instead of storing it as the value.
  const merged = preserveMaskedSecrets(incoming, existing, secretKeys);
  return encryptSecretFields(merged, secretKeys, key, bind);
}

/**
 * Carry forward existing encrypted secret values when the incoming config has no value for them:
 * omitted, empty, the mask sentinel, or a descriptor object with no default. A masked UI or a
 * manifest that declares the field without repeating its value therefore never wipes a stored secret. With
 * nothing stored to carry, the field is dropped rather than stored as the mask or the descriptor.
 */
export function preserveMaskedSecrets(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  secretKeys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const prev = existing ?? {};
  for (const k of secretKeys) {
    // An explicit null is left as it was sent: on an instance PATCH it is the one way a stored
    // secret has ever been cleared, and the read side treats it as unset either way.
    if (out[k] !== null && isUnsetSecret(out[k])) {
      if (isEncryptedValue(prev[k])) out[k] = prev[k];
      else delete out[k];
    }
  }
  return out;
}

/**
 * Rewrite one config's unbound secret values in the bound form. A value that opens with the node key
 * is re-encrypted for its field; one that does not open is left as it is (it reads as unset either
 * way). Returns the new config, or null when nothing changed.
 */
export function rebindLegacySecretFields(
  configObj: Record<string, unknown> | undefined,
  secretKeys: string[],
  key: Buffer,
  bind: SecretBinding,
): Record<string, unknown> | null {
  if (!configObj || !secretKeys.length) return null;
  let changed = false;
  const out: Record<string, unknown> = { ...configObj };
  for (const k of secretKeys) {
    const v = out[k];
    if (!isEncryptedValue(v) || isBoundCiphertext(v.encrypted)) continue;
    let plain: string;
    // eslint-disable-next-line aimeat/no-silent-catch -- a value that does not open is left as it is by design (it reads as unset either way); only positive evidence is rewritten
    try { plain = decrypt(v.encrypted, key); } catch { continue; }
    out[k] = { encrypted: encryptBound(plain, key, secretContext(bind, k)) };
    changed = true;
  }
  return changed ? out : null;
}

/**
 * Boot step: every extension's and instance's secret values written before 2026-10-09 are rewritten
 * bound to their field. Idempotent (a bound value is skipped), acts only on a value that opens, and
 * never throws: a failure is logged and the node boots.
 */
export async function bindLegacyExtensionSecrets(storage: Storage, key: Buffer | null): Promise<{ extensions: number; instances: number }> {
  const done = { extensions: 0, instances: 0 };
  if (!key) return done;
  try {
    const all = await storage.listExtensions({ lean: true });
    for (const ext of all) {
      const extKeys = getExtSecretKeys(ext);
      const rebound = rebindLegacySecretFields(ext.config, extKeys, key, { extension: ext.name });
      if (rebound) { await storage.updateExtension(ext.name, { config: rebound }); done.extensions++; }
      const instKeys = getInstanceSecretKeys(ext);
      if (!instKeys.length) continue;
      for (const inst of await storage.listExtensionInstances(ext.name)) {
        const r = rebindLegacySecretFields(inst.config, instKeys, key, { extension: ext.name, instance: inst.id });
        if (r) { await storage.updateExtensionInstance(ext.name, inst.id, { config: r }); done.instances++; }
      }
    }
    if (done.extensions || done.instances) {
      logger.info(`[extension-secrets] bound ${done.extensions} extension config(s) and ${done.instances} instance config(s) to their fields`);
    }
  } catch (err) {
    logger.warn(`[extension-secrets] binding the old secret values failed; they read as unset until the next boot: ${String((err as Error).message ?? err)}`);
  }
  return done;
}
