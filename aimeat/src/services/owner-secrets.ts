/**
 * @file src/services/owner-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's secrets vault, as ONE implementation. Every door — the three REST
 *   routes, the three MCP tools on the node surface, the three on the connector, the CLI dispatch —
 *   calls these functions, so the name rule, the envelope, the 4 kB ceiling and the refusal words
 *   are written once. A tool that reached `storage.setSecret` itself would be a second
 *   implementation of a credential store, which is the one place this codebase has already paid
 *   three times for having two (aimeat_memory_write: schema locks, write target, provenance).
 *
 *   THE SHAPE OF THE PROMISE. A value goes in and never comes out. `list` returns names and times;
 *   no route, tool or export returns a value or a ciphertext. The only reader on the node is
 *   `resolveSecretForHeaders` below, called from `ctx.fetch` in services/extension-ctx.ts AFTER the
 *   sandbox has handed over its request — so a script can SEND a credential and cannot LEARN one.
 *   That is what makes it safe for an AI to write the script and for a stranger to open the page it
 *   renders.
 *
 *   REFUSE BEFORE YOU WRITE. The name is validated, the size is measured and the encryption key is
 *   resolved before `storage.setSecret` is called. A node with no key configured answers 503 and
 *   stores nothing; it never falls back to plaintext, which is the same rule
 *   encryptSecretFields has followed since June.
 *
 *   THE FALLBACK IS THE EXTENSION'S OWN CONFIG, and it comes second. An extension may declare a
 *   `secrets` config field (living-hooks does: one encrypted JSON map, set by whoever installed the
 *   extension). Before this vault existed that was the only place a secret could live, so it stays
 *   readable — but the person's own vault wins, because a credential belonging to the human should
 *   never be shadowed by one the operator set for everyone.
 *
 * @structure
 *   - SECRET_NAME_RE / SECRET_MAX_BYTES / USED_BY_WINDOW_DAYS — the rules, as values
 *   - SecretSummary / listOwnerSecrets / putOwnerSecret / deleteOwnerSecret — the vault's doors
 *   - secretPlaceholderNames / resolveHeaderSecrets — the pure header resolver, unit-tested alone
 *   - resolveSecretForHeaders — the one impure step: vault, then extension config, then refuse
 * @usage
 *   const r = await putOwnerSecret(storage, config, ownerGhii, name, value);
 *   if (!r.ok) res.status(r.status).json(error(config.nodeId, r.code, r.message));
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial. The owner's secrets vault.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { SecretRecord } from '../storage/types/secrets.js';
import { encrypt, decrypt, getEncryptionKey } from './encryption.js';
import { logger } from '../utils/logger.js';

/**
 * A secret name is an ADDRESS, not a label: it is typed into a header inside a document
 * (`{{secret:STRIPE_KEY}}`), so it has to survive being written by hand, be case-exact, and carry
 * no character that means something in a header value. Letters, digits, underscore and hyphen, up
 * to 64.
 */
export const SECRET_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 4 kB, measured in UTF-8 bytes rather than characters. Bigger than any API key or bearer token and
 * big enough for a PEM private key; small enough that the vault cannot become a document store,
 * which it must not, because nothing here can read a value back to check what it became.
 */
export const SECRET_MAX_BYTES = 4096;

/** How far back `usedBy` reports. An extension that has not touched a secret in a month is not
 *  evidence that deleting it is safe, but it is the honest answer to "who is using this now". */
export const USED_BY_WINDOW_DAYS = 30;

/** What a caller may know about a secret: that it exists, since when, and who has been using it. */
export interface SecretSummary {
  name: string;
  setAt: string;
  updatedAt: string;
  /** Extension names that resolved this secret within the last 30 days, most recent first. */
  usedBy: string[];
}

/** A refusal the caller turns into an HTTP status or a tool error, with the words already written. */
export interface SecretRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** The extension names that used this secret inside the window, most recent first. */
function recentUsers(record: SecretRecord, now: number): string[] {
  const cutoff = now - USED_BY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Object.entries(record.usedBy ?? {})
    .map(([name, at]) => ({ name, at: Date.parse(at) }))
    .filter(e => Number.isFinite(e.at) && e.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .map(e => e.name);
}

export function toSummary(record: SecretRecord, now = Date.now()): SecretSummary {
  return {
    name: record.name,
    setAt: record.setAt,
    updatedAt: record.updatedAt,
    usedBy: recentUsers(record, now),
  };
}

/** Every secret this owner holds — names and times, never a value. */
export async function listOwnerSecrets(storage: Storage, ownerGhii: string): Promise<SecretSummary[]> {
  const now = Date.now();
  const records = await storage.listSecrets(ownerGhii);
  return records.map(r => toSummary(r, now));
}

/**
 * Set or replace one secret. Replacing is this same call: a vault with a separate "rotate" door is
 * a vault where somebody eventually forgets which one to use.
 *
 * Every refusal happens before the write, and the refusal text never echoes the VALUE — only the
 * name, which the caller already typed.
 */
export async function putOwnerSecret(
  storage: Storage,
  config: AimeatConfig,
  ownerGhii: string,
  name: unknown,
  value: unknown,
): Promise<{ ok: true; data: SecretSummary } | SecretRefusal> {
  if (typeof name !== 'string' || !SECRET_NAME_RE.test(name)) {
    return {
      ok: false, status: 400, code: 'INVALID_SECRET_NAME',
      message: 'A secret name is letters, digits, underscore and hyphen, 1 to 64 characters. '
        + 'It is written into a header as {{secret:NAME}}, so it has to survive being typed by hand.',
    };
  }
  if (typeof value !== 'string' || value === '') {
    return {
      ok: false, status: 400, code: 'INVALID_SECRET_VALUE',
      message: `value is required and must be a non-empty string. To remove ${name}, use DELETE instead.`,
    };
  }
  const size = utf8Bytes(value);
  if (size > SECRET_MAX_BYTES) {
    return {
      ok: false, status: 400, code: 'SECRET_TOO_LARGE',
      message: `That value is ${size} bytes and the ceiling is ${SECRET_MAX_BYTES}. The vault holds keys and `
        + 'passwords, not documents: nothing here can read a value back to tell you what it became.',
    };
  }
  // REFUSE BEFORE YOU WRITE. Resolve the key first: a node with none must answer, not store.
  const key = getEncryptionKey(config);
  if (!key) {
    return {
      ok: false, status: 503, code: 'SECRET_STORE_UNAVAILABLE',
      message: 'This node has no encryption key configured, so a secret cannot be stored at rest. '
        + 'Set AIMEAT_ENCRYPTION_KEY (32 bytes, 64 hex characters) and try again. Nothing was written.',
    };
  }

  const now = new Date().toISOString();
  const stored = await storage.setSecret({
    ownerGaii: ownerGhii,
    name,
    ciphertext: encrypt(value, key),
    setAt: now,
    updatedAt: now,
    usedBy: {},
  });
  return { ok: true, data: toSummary(stored) };
}

/** Remove one. `false` when this owner holds no secret of that name — never another owner's. */
export async function deleteOwnerSecret(
  storage: Storage,
  ownerGhii: string,
  name: unknown,
): Promise<{ ok: true } | SecretRefusal> {
  if (typeof name !== 'string' || !SECRET_NAME_RE.test(name)) {
    return {
      ok: false, status: 400, code: 'INVALID_SECRET_NAME',
      message: 'A secret name is letters, digits, underscore and hyphen, 1 to 64 characters.',
    };
  }
  const gone = await storage.deleteSecret(ownerGhii, name);
  if (!gone) {
    // 404 rather than 403, and deliberately the SAME answer another owner's name would get: a
    // distinct "that exists but is not yours" would turn this route into a way to ask whether a
    // stranger holds a secret called STRIPE_KEY. The vault is per owner, so "not yours" and "not
    // there" are the same fact from outside.
    return {
      ok: false, status: 404, code: 'SECRET_NOT_FOUND',
      message: `You hold no secret called ${name}.`,
    };
  }
  return { ok: true };
}

// ── The header resolver ───────────────────────────────────────────────────────────────────────

/**
 * `{{secret:NAME}}`, as it appears inside a header value.
 *
 * The scanner's name class is WIDER than SECRET_NAME_RE — it allows a dot — and that is deliberate.
 * The vault refuses a dotted name, but living-hooks' own secret map (an encrypted JSON object in
 * the extension config) never did, so a document written before this vault existed may name
 * `service.key`. A scanner that refused to SEE that name would resolve the placeholder to nothing
 * and send a header with a literal `{{secret:service.key}}` in it. Seeing it and looking it up in
 * the fallback is the behaviour that does not break anybody.
 */
const SECRET_PLACEHOLDER_G = /\{\{secret:([A-Za-z0-9_.-]{1,64})\}\}/g;

/** Every distinct secret name named in these header VALUES, in first-seen order. Header NAMES are
 *  never scanned: a placeholder in a header name would build a header nobody declared. */
export function secretPlaceholderNames(headers: Record<string, string> | undefined): string[] {
  const found: string[] = [];
  for (const value of Object.values(headers ?? {})) {
    if (typeof value !== 'string') continue;
    for (const m of value.matchAll(SECRET_PLACEHOLDER_G)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
  }
  return found;
}

/**
 * Substitute the resolved values into the header values. Pure, so the substitution rule is provable
 * without a database: the impure half (where a value comes from) is `resolveSecretForHeaders`.
 *
 * A name with no value refuses rather than substituting an empty string. Half a credential is worse
 * than none: the far end answers 401, the owner reads it as "the service is down", and the header
 * that was meant to be secret went out anyway with the word `Bearer` and nothing after it.
 */
export function resolveHeaderSecrets(
  headers: Record<string, string> | undefined,
  lookup: (name: string) => string | undefined,
): { ok: true; headers: Record<string, string> } | { ok: false; missing: string } {
  const out: Record<string, string> = {};
  let missing: string | null = null;
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value !== 'string') { out[key] = value; continue; }
    out[key] = value.replace(SECRET_PLACEHOLDER_G, (_whole, name: string) => {
      const v = lookup(name);
      if (typeof v !== 'string' || v === '') { if (!missing) missing = name; return ''; }
      return v;
    });
  }
  return missing ? { ok: false, missing } : { ok: true, headers: out };
}

/**
 * The extension's own secret map, from a `secrets` config field. One encrypted STRING holding JSON,
 * because the node encrypts string config values and nothing else — so a map of secrets travels as
 * one. A value that will not parse yields an empty map, and the placeholder that wanted it then
 * refuses by name, which says "that secret is not set" rather than sending the word `undefined`.
 */
export function extensionConfigSecrets(extConfig: Record<string, unknown> | undefined): Record<string, string> {
  const raw = extConfig?.secrets;
  if (raw === null || raw === undefined || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    // A map that will not parse is an unset secret, and the placeholder that wanted it refuses BY
    // NAME one step below. Throwing here would turn one malformed config field into a failure with
    // no name in it, which is the harder thing to fix of the two.
    // eslint-disable-next-line aimeat/no-silent-catch -- see above: the refusal happens by name below.
    return {};
  }
}

/** What a refused resolution says, and where the caller can go to fix it. */
export function secretUnknownMessage(headerName: string, secretName: string): string {
  return `The header "${headerName}" asks for the secret ${secretName}, which this account has not set. `
    + 'Store it once on the Access page under Secrets, or with aimeat_secret_set, and it is filled in '
    + 'on the way out without ever being written into the document that names it.';
}

/**
 * Resolve every `{{secret:NAME}}` in these header values: the CALLER's owner vault first, the
 * extension's own config second, a refusal third.
 *
 * Reads nothing when no placeholder is present, so an ordinary fetch costs no query.
 *
 * `usedBy` is stamped per extension for every name that came from the VAULT — a name resolved from
 * the extension config is not a vault row and has nothing to stamp. The stamp is fire-and-forget on
 * purpose: a slow write must not delay somebody's outbound call, and a failed one costs a line on a
 * list rather than a credential.
 */
export async function resolveSecretForHeaders(deps: {
  storage: Storage;
  config: AimeatConfig;
  /** The owner GHII behind whichever principal is calling. */
  ownerGhii: string;
  /** The extension's manifest config, secrets already decrypted by the road that built the context. */
  extConfig: Record<string, unknown> | undefined;
  /** Which extension is asking, for the usedBy stamp. */
  extName: string;
  headers: Record<string, string> | undefined;
}): Promise<{ ok: true; headers: Record<string, string> } | { ok: false; headerName: string; secretName: string }> {
  const { storage, config, ownerGhii, extConfig, extName, headers } = deps;
  const names = secretPlaceholderNames(headers);
  if (!names.length) return { ok: true, headers: headers ?? {} };

  const key = getEncryptionKey(config);
  const fallback = extensionConfigSecrets(extConfig);
  const resolved = new Map<string, string>();
  const fromVault: string[] = [];

  for (const name of names) {
    // The person's own vault wins over the operator's shared map: a credential belonging to the
    // human must never be shadowed by one somebody else set for everyone on the node.
    const record = await storage.getSecret(ownerGhii, name);
    if (record && key) {
      try {
        const plain = decrypt(record.ciphertext, key);
        if (plain) { resolved.set(name, plain); fromVault.push(name); continue; }
      } catch (err) {
        // A row this node's key cannot open is an unset secret from here: the key was rotated, or
        // the row arrived from another node. Fall through to the extension config and then refuse
        // BY NAME, which tells the owner which secret to set again — a thrown decrypt error would
        // say only that something went wrong. The NAME is logged and the value cannot be.
        logger.warn('secrets: a stored value could not be opened with this node key', {
          name, owner: ownerGhii, error: String(err),
        });
      }
    }
    const alt = fallback[name];
    if (typeof alt === 'string' && alt !== '') resolved.set(name, alt);
  }

  const substituted = resolveHeaderSecrets(headers, name => resolved.get(name));
  if (!substituted.ok) {
    // Name the HEADER as well as the secret: an owner reading this is looking at a document with
    // several headers in it, and "which one" is half the answer.
    const missing = substituted.missing;
    const headerName = Object.entries(headers ?? {})
      .find(([, v]) => typeof v === 'string' && v.includes(`{{secret:${missing}}}`))?.[0] ?? '';
    return { ok: false, headerName, secretName: missing };
  }

  // Fire-and-forget: the call must not wait on bookkeeping, and a lost stamp costs a line on a list.
  if (fromVault.length) {
    const at = new Date().toISOString();
    for (const name of fromVault) {
      void storage.noteSecretUse(ownerGhii, name, extName, at).catch(err => {
        logger.warn('secrets: the use stamp did not land', { name, extension: extName, error: String(err) });
      });
    }
  }
  return { ok: true, headers: substituted.headers };
}
