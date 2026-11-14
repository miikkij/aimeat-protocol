/**
 * @file src/services/key-reencrypt/sources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every place the node stores a value sealed with its data key, and how the re-encrypt
 *   job (job.ts) seals each one again with the current key.
 *
 *   THE LIST. Memory records under eight key prefixes (the payment provider record, the AI and
 *   decision provider keys, the file store credentials, the stored mail, a first sign-in's password
 *   waiting for a verified address), and eleven table columns
 *   (connected accounts and their app secrets, MCP server credentials and transport values, a
 *   person's MCP sign-in, a company's SMTP password, the secrets vault, two-step sign-in secrets,
 *   sealed Config rows, extension and instance configs, and the node key's database copy), plus the
 *   binding rows of an extension's shared secrets, which are named by an HMAC under the data key.
 *   test/unit/key-reencrypt-sources.test.ts holds the list to the code: a file that calls the data
 *   key's seal functions and is not named in SEALED_BY below fails it, so a new place cannot be left
 *   out of a rotation unnoticed.
 *
 *   NOT IN THE LIST, on purpose. A one-time sign-in round in VerificationNonce (a connection's or an
 *   MCP server's OAuth verifier, a two-step setup ticket) lives 10 to 15 minutes and opens with either
 *   key while it lives. An app's watermark is sealed into the copy a person downloads, so it is not
 *   stored here at all: reading the watermark of a copy made before the rotation needs the old key,
 *   which the runbook says to keep with the backups (docs/operations/key-rotation.md).
 *
 *   ORDER. The legacy OpenRouter key record comes before the provider key records, because reading
 *   the providers copies the legacy record's ciphertext into a provider record (services/ai/
 *   provider-store.ts syncLegacyProvider): moved in this order, a copy made later is already current.
 * @structure SourceCtx · RowPlan · ReencryptSource · REENCRYPT_SOURCES · SEALED_BY
 * @usage for (const s of REENCRYPT_SOURCES) { const rows = await storage.listSealedColumn(s.column, { prefix: s.prefix, ... }); }
 * @version-history
 *   v1.0.1 — 2026-11-05 — The held first sign-in password (key-credentials.ts, decision 14a) is a
 *     source, so the old key's count reaches 0 only when it too is resealed (decisions 4a and 14a).
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { SealedColumn, SealedColumnRow } from '../../storage/repositories/sealed-column.repository.js';
import { decryptBound, keyRingOf } from '../encryption.js';
import { secretContext, isEncryptedValue } from '../extension/secrets.js';
import { contextFor as transportContext } from '../mcp-client/transport-secrets.js';
import { credentialContext as nodeStoreContext, NODE_STORES_KEY } from '../file-store/node-file-stores.js';
import { credentialContext as ownerStoreContext, OWNER_STORE_PREFIX } from '../file-store/owner-file-store.js';
import { contextOf as mailContext } from '../email-outbox.js';
import { HELD_KEY_PREFIX, NS_HELD, heldContext } from '../key-credentials.js';
import { contextOf as settingContext, SEALED_SETTING_PREFIX } from '../config/at-rest.js';
import { extensionConfigSecrets, sharedBindingName, sharedBindingOwner } from '../owner-secrets.js';
import { nodeKeyRowSealedWith, nodeKeySecretsNow, openNodePrivateKey } from '../../storage/node-key-at-rest.js';
import { count, emptyTally, resealString, resealTree, type Tally } from './reseal.js';
import { logger } from '../../utils/logger.js';

export interface SourceCtx { storage: Storage; config: AimeatConfig; key: Buffer }

/** What one row or record needs: the new value when something moved, and what was found. */
export interface RowPlan { next?: unknown; tally: Tally }

export interface ReencryptSource {
  /** The name the job's status shows. */
  id: string;
  column: SealedColumn;
  /** For a memory source: the key prefix. */
  prefix?: string;
  /** A memory record of this source: its new value, or null when the record is not one of its own. */
  planRecord?(rec: MemoryRecord, ctx: SourceCtx): RowPlan | null;
  /** A table row: its new column value. */
  planRow?(row: SealedColumnRow, ctx: SourceCtx): RowPlan;
  /** A row the job does not write through swapSealedColumn: it does the work and answers the tally. */
  custom?(row: SealedColumnRow, ctx: SourceCtx): Promise<Tally>;
}

const systemOwner = (nodeId: string): string => `system@${nodeId}`;

/** A whole value walked for unbound sealed strings (no place in it has a context). */
function unboundTree(value: unknown, key: Buffer): RowPlan {
  const tally = emptyTally();
  const r = resealTree(value, key, () => null, tally);
  return r.changed ? { next: r.value, tally } : { tally };
}

/** One column that holds a single unbound sealed string. */
function unboundString(value: unknown, key: Buffer): RowPlan {
  const tally = emptyTally();
  const r = resealString(value, key, null);
  count(tally, r);
  return r.kind === 'moved' ? { next: r.next, tally } : { tally };
}

/** A memory source whose records hold unbound values only. */
function unboundMemory(id: string, prefix: string, exactKey?: string): ReencryptSource {
  return {
    id, column: 'memory', prefix,
    planRecord: (rec, ctx) => (exactKey && rec.key !== exactKey ? null : unboundTree(rec.value, ctx.key)),
  };
}

/** An extension or instance config: each top-level `{ encrypted }` field, bound to that field. */
function planConfig(config: unknown, key: Buffer, bind: { extension: string; instance?: string }): RowPlan {
  const tally = emptyTally();
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { tally };
  let next: Record<string, unknown> | null = null;
  for (const [field, v] of Object.entries(config as Record<string, unknown>)) {
    if (!isEncryptedValue(v)) continue;
    const r = resealString(v.encrypted, key, secretContext(bind, field));
    count(tally, r);
    if (r.kind === 'moved') {
      next ??= { ...(config as Record<string, unknown>) };
      next[field] = { ...v, encrypted: r.next };
    }
  }
  return next ? { next, tally } : { tally };
}

export const REENCRYPT_SOURCES: readonly ReencryptSource[] = [
  // ── memory records ──
  unboundMemory('payment provider secrets', 'commerce.psp', 'commerce.psp'),
  unboundMemory('OpenRouter keys', 'openrouter.apikey'),
  unboundMemory('decision provider keys', 'decide.apikey'),
  unboundMemory('AI provider keys', 'ai.apikey.'),
  {
    id: 'node file stores', column: 'memory', prefix: NODE_STORES_KEY,
    planRecord: (rec, ctx) => {
      if (rec.key !== NODE_STORES_KEY || rec.ownerGaii !== systemOwner(ctx.config.nodeId)) return null;
      const tally = emptyTally();
      const r = resealTree(rec.value, ctx.key, path => (path[0] === 'stores' && path[2] === 'credential' ? nodeStoreContext(ctx.config.nodeId) : null), tally);
      return r.changed ? { next: r.value, tally } : { tally };
    },
  },
  {
    id: 'personal file stores', column: 'memory', prefix: OWNER_STORE_PREFIX,
    planRecord: (rec, ctx) => {
      if (rec.ownerGaii !== systemOwner(ctx.config.nodeId)) return null;
      const account = rec.key.slice(OWNER_STORE_PREFIX.length);
      const tally = emptyTally();
      // The second form keeps each store's credential in `stores[i]`, the first form at the top.
      const r = resealTree(rec.value, ctx.key, path => (path[path.length - 1] === 'credential' ? ownerStoreContext(account, ctx.config.nodeId) : null), tally);
      return r.changed ? { next: r.value, tally } : { tally };
    },
  },
  {
    // A first sign-in's password, held until the account verifies its address (key-credentials.ts).
    id: 'sign-in details waiting for a verified address', column: 'memory', prefix: HELD_KEY_PREFIX,
    planRecord: (rec, ctx) => {
      if (rec.ownerGaii !== NS_HELD) return null;
      const ghii = rec.key.slice(HELD_KEY_PREFIX.length);
      const invitationId = (rec.value as { invitationId?: unknown } | null)?.invitationId;
      const tally = emptyTally();
      const r = resealTree(rec.value, ctx.key, path => (path.length === 1 && path[0] === 'sealed' && typeof invitationId === 'string' ? heldContext(ghii, invitationId) : null), tally);
      return r.changed ? { next: r.value, tally } : { tally };
    },
  },
  {
    id: 'mail waiting to be sent', column: 'memory', prefix: 'outbox.mail.',
    planRecord: (rec, ctx) => {
      if (rec.ownerGaii !== systemOwner(ctx.config.nodeId)) return null;
      const id = rec.key.slice('outbox.mail.'.length);
      const tally = emptyTally();
      const r = resealTree(rec.value, ctx.key, path => (path[path.length - 1] === 'sealed' ? mailContext(id) : null), tally);
      return r.changed ? { next: r.value, tally } : { tally };
    },
  },

  // ── table columns ──
  { id: 'connected accounts', column: 'connection.credential', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  { id: 'connected account apps', column: 'provider-client.client-secret', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  { id: 'MCP server credentials', column: 'mcp-server.credential', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  {
    id: 'MCP server headers and environment', column: 'mcp-server.transport',
    planRow: (row, ctx) => {
      const tally = emptyTally();
      const serverId = row.id[0];
      const r = resealTree(row.value, ctx.key, path => {
        if (path.length !== 2 || typeof path[1] !== 'string') return null;
        if (path[0] === 'env') return transportContext(serverId, 'env', path[1]);
        if (path[0] === 'headers') return transportContext(serverId, 'header', path[1]);
        return null;
      }, tally);
      return r.changed ? { next: r.value, tally } : { tally };
    },
  },
  { id: 'personal MCP sign-ins', column: 'mcp-user-credential.credential', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  { id: 'company SMTP passwords', column: 'company-smtp.password', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  { id: 'secrets vault', column: 'secret.ciphertext', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  { id: 'two-step sign-in secrets', column: 'ghii.totp-secret', planRow: (row, ctx) => unboundString(row.value, ctx.key) },
  {
    id: 'secret Config settings', column: 'system-setting.value',
    planRow: (row, ctx) => {
      const tally = emptyTally();
      const [rowKey] = row.id;
      if (!rowKey.startsWith('config:') || typeof row.value !== 'string' || !row.value.startsWith(SEALED_SETTING_PREFIX)) return { tally };
      const r = resealString(row.value.slice(SEALED_SETTING_PREFIX.length), ctx.key, settingContext(rowKey.slice('config:'.length)));
      count(tally, r);
      return r.kind === 'moved' ? { next: SEALED_SETTING_PREFIX + r.next, tally } : { tally };
    },
  },
  { id: 'extension settings', column: 'extension.config', planRow: (row, ctx) => planConfig(row.value, ctx.key, { extension: row.id[0] }) },
  { id: 'extension instance settings', column: 'extension-instance.config', planRow: (row, ctx) => planConfig(row.value, ctx.key, { extension: row.id[0], instance: row.id[1] }) },
  {
    // The binding row of a shared value is named by an HMAC under the data key (owner-secrets.ts
    // sharedBindingName). A row named under the other key is copied under the current key's name,
    // with its hosts and who bound them, so the binding survives the old key's removal. The old row
    // is left where it is.
    id: 'shared secret bindings', column: 'extension.config',
    custom: async (row, ctx) => {
      const tally = emptyTally();
      const extension = row.id[0];
      const shared = sharedMapOf(row.value, ctx.key, extension);
      const others = [...keyRingOf(ctx.key).keys.values()].filter(k => !k.equals(ctx.key));
      if (!shared || !others.length) return tally;
      const owner = sharedBindingOwner(extension);
      for (const [name, value] of Object.entries(shared)) {
        if (typeof value !== 'string' || !value) continue;
        const now = sharedBindingName(name, value, ctx.key, ctx.config.nodeId);
        if (await ctx.storage.getSecret(owner, now)) { tally.current++; continue; }
        for (const k of others) {
          const old = await ctx.storage.getSecret(owner, sharedBindingName(name, value, k, ctx.config.nodeId));
          if (!old) continue;
          await ctx.storage.createSecretIfAbsent({ ...old, name: now });
          tally.moved++;
          break;
        }
      }
      return tally;
    },
  },
  {
    // The node key's database copy, when no passphrase seals it (storage/node-key-at-rest.ts `nk1:e:`).
    // Written again through setNodeKey, which seals with the current data key, and read back.
    id: 'node key database copy', column: 'node-key.private-key',
    custom: async (row, ctx) => {
      const tally = emptyTally();
      const [publicKey] = row.id;
      const stored = typeof row.value === 'string' ? row.value : '';
      const secrets = nodeKeySecretsNow();
      const was = nodeKeyRowSealedWith(stored, publicKey, secrets);
      if (was === 'current') tally.current++;
      else if (was === 'unreadable') tally.unreadable++;
      else if (was === 'older') {
        await ctx.storage.setNodeKey(publicKey, openNodePrivateKey(stored, publicKey, secrets));
        const back = (await ctx.storage.listSealedColumn('node-key.private-key', { limit: 10 })).find(r => r.id[0] === publicKey);
        if (back && typeof back.value === 'string' && nodeKeyRowSealedWith(back.value, publicKey, secrets) === 'current') tally.moved++;
        else tally.unreadable++;
      }
      return tally;
    },
  },
];

/** The shared secret map of an extension config, opened, or null when there is none or it does not open. */
function sharedMapOf(config: unknown, key: Buffer, extension: string): Record<string, string> | null {
  if (!config || typeof config !== 'object') return null;
  const raw = (config as Record<string, unknown>).secrets;
  if (isEncryptedValue(raw)) {
    try {
      return extensionConfigSecrets({ secrets: decryptBound(raw.encrypted, key, secretContext({ extension }, 'secrets')) });
    } catch (err) {
      // Counted as unreadable by the extension settings source; here it carries no binding forward.
      // The fact is logged, not the error, whose text could carry part of the sealed value.
      logger.warn('key re-encrypt: an extension\'s shared secret map does not open; its bindings are not carried', { extension, failed: (err as Error)?.name ?? 'Error' });
      return null;
    }
  }
  const map = extensionConfigSecrets(config as Record<string, unknown>);
  return Object.keys(map).length ? map : null;
}

/**
 * The files that seal a value with the data key (encrypt, encryptBound, or a wrapper of theirs), and
 * the source above that reseals what each stores, or the reason it has none. Held to the code by
 * test/unit/key-reencrypt-sources.test.ts.
 */
export const SEALED_BY: Readonly<Record<string, string>> = {
  'src/commerce/psp-secrets.ts': 'payment provider secrets',
  'src/routes/openrouter.ts': 'OpenRouter keys',
  'src/services/agent/ai-keys.ts': 'OpenRouter keys, decision provider keys',
  'src/services/ai/provider-store.ts': 'AI provider keys',
  'src/services/decide/providers.ts': 'decision provider keys',
  'src/services/decide/settings.ts': 'decision provider keys',
  'src/services/file-store/node-file-stores.ts': 'node file stores',
  'src/services/file-store/owner-file-store.ts': 'personal file stores',
  'src/services/email-outbox.ts': 'mail waiting to be sent',
  'src/services/key-credentials.ts': 'sign-in details waiting for a verified address',
  'src/services/connections/credential.ts': 'connected accounts, connected account apps',
  'src/services/mcp-client/credential.ts': 'MCP server credentials, personal MCP sign-ins',
  'src/services/mcp-client/transport-secrets.ts': 'MCP server headers and environment',
  'src/services/company/company-smtp.ts': 'company SMTP passwords',
  'src/services/owner-secrets.ts': 'secrets vault',
  'src/services/totp.ts': 'two-step sign-in secrets',
  'src/services/config/at-rest.ts': 'secret Config settings',
  'src/services/extension/secrets.ts': 'extension settings, extension instance settings',
  'src/services/oauth-round-secrets.ts': 'none: a sign-in round lives 10 to 15 minutes and opens with either key while it lives',
  'src/utils/app-protect.ts': 'none: the watermark is sealed into the copy a person downloads, not stored here',
};
