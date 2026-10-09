/**
 * @file src/utils/redact-credentials.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place that decides what a credential looks like in text and in a field
 *   name, for every code path that writes text it did not author: the node log (utils/logger.ts),
 *   a provider's refusal shown to a caller (services/ai/errors.ts), an upstream error kept for the
 *   operator (Stripe, the e-invoicing operator, the fault report). A leaf module: it imports nothing,
 *   so the logger can use it without a cycle.
 *
 *   Two strengths. redactCredentialText replaces only text with a credential's shape (a Bearer, a
 *   name=value pair, a vendor key prefix, a JWT, the node's AES-GCM ciphertext, a credential query
 *   parameter) and leaves ids, digests and UUIDs readable, which the log needs. redactKeyShaped adds
 *   the blunt rule (any run of 32+ token characters), for text shown to a caller, where an id lost
 *   to the rule costs nothing.
 * @structure redactCredentialText · redactKeyShaped · isCredentialFieldName · redactCredentials ·
 *   carriesCredentialField · redactCredentialField
 * @version-history
 *   v1.0.0 — 2026-10-09 — Moved here from services/ai/errors.ts (redactKeyShaped) and widened for the
 *     logger: vendor prefixes with underscores (sk_live_, whsec_, rk_), the node's own token prefixes,
 *     JWTs, AES-GCM ciphertext, credential query parameters, and a recursive, cycle-safe field
 *     walk (secrets audit 2026-10-09, 07-side-channels d1 and d5).
 */

const REDACTED = '[redacted]';

/** Field names (lowercase, without - and _) whose value is a credential whatever it holds. */
const CREDENTIAL_NAMES = new Set([
  'token', 'password', 'passwd', 'pwd', 'secret', 'authorization', 'proxyauthorization', 'cookie',
  'setcookie', 'privatekey', 'encryptionkey', 'apikey', 'xapikey', 'accesstoken', 'refreshtoken',
  'idtoken', 'clientsecret', 'passphrase', 'credential', 'credentials', 'bearer', 'secretkey',
  'signingkey', 'hmackey', 'masterkey', 'backupcodes', 'otpauthurl', 'totpsecret',
]);
/** Endings that make a field name a credential: scimToken, webhookSecret, adminPassword, x-api-key. */
const CREDENTIAL_SUFFIXES = ['token', 'secret', 'password', 'passphrase', 'apikey', 'privatekey', 'secretkey', 'authorization', 'cookie'];

/**
 * Replace text with a credential's shape with `[redacted]`, and leave ids, digests and UUIDs alone.
 * Used on every string the node log writes.
 */
export function redactCredentialText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|webhook[_-]?secret|private[_-]?key|token|secret|password|passphrase|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, `$1$2${REDACTED}`)
    .replace(/([?&](?:code|key|sig|signature|state|ticket)=)[^&\s#"']+/gi, `$1${REDACTED}`)
    .replace(/\b(?:sk|pk|rk|ak|xai|gsk)-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/g, REDACTED)
    .replace(/\b(?:whsec|rk|sk)_[A-Za-z0-9]{12,}/g, REDACTED)
    .replace(/\baimeat_[a-z]+_[A-Za-z0-9_-]{12,}/g, REDACTED)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED)
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED)
    .replace(/\b(?:v2:)?[0-9a-f]{24}:[0-9a-f]{32}(?::[0-9a-f]*)?/gi, REDACTED);
}

/**
 * Replace anything shaped like a credential with `[redacted]`, including any run of 32 or more token
 * characters. For text shown to a caller: a provider's error body can echo the request, a header or
 * the key it refused.
 */
export function redactKeyShaped(text: string): string {
  return redactCredentialText(text).replace(/[A-Za-z0-9_-]{32,}/g, REDACTED);
}

/** True when a field of this name holds a credential: any case, with or without - and _. */
export function isCredentialFieldName(name: string): boolean {
  const n = name.toLowerCase().replace(/[-_]/g, '');
  if (CREDENTIAL_NAMES.has(n)) return true;
  return CREDENTIAL_SUFFIXES.some((s) => n.endsWith(s));
}

/** The marker a credential field's value becomes. The log has carried this text since 2025. */
export const MASKED_FIELD = '***REDACTED***';
/** How deep redactCredentials walks; a deeper object is replaced, never written unread. */
const MAX_DEPTH = 8;
/** How deep carriesCredentialField reads a response before it gives up and answers true. */
const SCAN_DEPTH = 16;

function isPlainObject(v: object): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function walk(v: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof v === 'string') return redactCredentialText(v);
  if (v === null || typeof v !== 'object') return v;
  if (ancestors.has(v)) return '[Circular]';
  if (!Array.isArray(v) && !isPlainObject(v)) return v;
  if (depth >= MAX_DEPTH) return '[depth limit]';
  ancestors.add(v);
  let out: unknown;
  if (Array.isArray(v)) {
    out = v.map((x) => walk(x, depth + 1, ancestors));
  } else {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = maskOrWalk(k, val, depth, ancestors);
    out = o;
  }
  ancestors.delete(v);
  return out;
}

function maskOrWalk(key: string, val: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  // A flag or a count under a credential name (hasToken: true, token: 0) says nothing secret.
  if (isCredentialFieldName(key) && val !== null && val !== undefined && typeof val !== 'boolean' && typeof val !== 'number') {
    return MASKED_FIELD;
  }
  return walk(val, depth + 1, ancestors);
}

/**
 * A copy of `value` with every credential field masked and every string passed through
 * redactCredentialText, at any depth up to MAX_DEPTH, safe on cycles. Plain objects and arrays are
 * copied, never changed in place, so an object the caller still holds (req.headers) keeps its values.
 * Other class instances pass as they are.
 */
export function redactCredentials(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}

/**
 * True when `value` holds a credential field with a value in it (a string, an array, an object) at
 * any depth up to SCAN_DEPTH, or when it is too large to read through in `maxNodes` steps: an answer
 * that cannot be read is treated as carrying one. Used where keeping a copy of a response is the
 * risk (middleware/idempotency.ts).
 */
export function carriesCredentialField(value: unknown, maxNodes = 5000): boolean {
  let budget = maxNodes;
  const visit = (v: unknown, depth: number): boolean => {
    if (v === null || typeof v !== 'object') return false;
    if (--budget < 0 || depth >= SCAN_DEPTH) return true;
    const entries = Array.isArray(v) ? v.map((x) => ['', x] as const) : Object.entries(v);
    for (const [k, val] of entries) {
      if (k && isCredentialFieldName(k) && val !== null && val !== undefined && val !== ''
        && typeof val !== 'boolean' && typeof val !== 'number') return true;
      if (visit(val, depth + 1)) return true;
    }
    return false;
  };
  return visit(value, 0);
}

/** The same rule applied to one named field: masked when the name is a credential's, walked otherwise. */
export function redactCredentialField(key: string, value: unknown): unknown {
  return maskOrWalk(key, value, 0, new WeakSet());
}
