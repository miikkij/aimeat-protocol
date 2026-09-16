/**
 * @file src/services/secret-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two memory records that hold a credential, and what every generic memory door
 *   shows of them.
 *
 *   `openrouter.apikey` holds a person's own AI key (encrypted, routes/openrouter.ts) and
 *   `commerce.psp` holds a seller's Stripe key and webhook secret (encrypted,
 *   commerce/psp-secrets.ts). The server reads both directly from storage at the one call that needs
 *   them. Every generic memory door (list, search, read, export, bundle, the librarian, the MCP
 *   memory tools, the operator's memory screen) returned them whole, so an app grant with
 *   memory:read, an agent with owner_scope, or an operator could take the ciphertext, and a legacy
 *   row in plain text. Those doors now show `{ configured: true }` in place of a secret, with the
 *   last four characters where the record keeps a hint.
 *
 *   THE WRITE HALF. A door that shows a redacted value must not accept one back: an owner saving the
 *   record from a generic editor would overwrite the key with `{ configured: true }`. The generic
 *   memory write doors refuse these two keys for every principal; the owner changes them through
 *   /v1/openrouter/settings and /v1/commerce/payout/stripe, and an agent through the commerce tools.
 * @structure SECRET_RECORD_KEYS · isSecretRecordKey · shownMemoryValue · secretRecordWriteRefusal
 * @usage value: shownMemoryValue(record.key, record.value)
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial.
 */
import { PSP_RECORD_KEY, PSP_SECRET_FIELDS, pspSecretHint } from '../commerce/psp-secrets.js';

export const OPENROUTER_KEY_RECORD = 'openrouter.apikey';

/** The memory keys whose value holds a credential. Matched exactly: a key is an address. */
export const SECRET_RECORD_KEYS: ReadonlySet<string> = new Set([OPENROUTER_KEY_RECORD, PSP_RECORD_KEY]);

export function isSecretRecordKey(key: unknown): boolean {
  return typeof key === 'string' && SECRET_RECORD_KEYS.has(key);
}

/** The value a generic door may show. Every other key passes through untouched. */
export function shownMemoryValue(key: string, value: unknown): unknown {
  if (!isSecretRecordKey(key) || value === null || value === undefined) return value;
  if (key === OPENROUTER_KEY_RECORD) return { configured: true };
  if (typeof value !== 'object' || Array.isArray(value)) return { configured: true };
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of PSP_SECRET_FIELDS) {
    if (out[field] === undefined) continue;
    const hint = pspSecretHint(out[field]);
    out[field] = hint ? { configured: true, hint } : { configured: false };
  }
  return out;
}

/** The refusal a generic write door gives for these keys, with the door to use instead. */
export function secretRecordWriteRefusal(key: string): { code: string; message: string } {
  const door = key === OPENROUTER_KEY_RECORD
    ? 'PUT /v1/openrouter/settings (the AI settings page)'
    : 'PUT /v1/commerce/payout/stripe (Wallet, Selling and payments) or aimeat_commerce_psp_set';
  return {
    code: 'SECRET_RECORD',
    message: `"${key}" holds a credential, so it is not written through the general memory doors. Use ${door}.`,
  };
}
