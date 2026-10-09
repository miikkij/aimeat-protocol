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
 *
 *   A WORKSPACE SHARE RECORD (`organism.<id>.w.<ws>.meta.share`) is an ordinary record that carries
 *   one secret field: the scrypt hash of the share password. The share routes read it from storage
 *   and never show it (routes/organisms/shared.ts), but the generic doors returned it to the creator's
 *   agents and to any app holding memory:read. They now show `has_password` in its place. The record
 *   stays writable through the generic doors: a write without the hash leaves a password share that
 *   no password opens, which is closed, not open.
 * @structure SECRET_RECORD_KEYS · isSecretRecordKey · isWorkspaceShareKey · shownMemoryValue ·
 *   secretRecordBinRefusal · secretRecordWriteRefusal
 * @usage value: shownMemoryValue(record.key, record.value)
 * @version-history
 *   v1.5.0 — 2026-10-09 — secretRecordBinRefusal: the generic delete and restore refuse these keys for
 *     every principal and name the record's own route (secrets audit 2026-10-09, item 10).
 *   v1.4.0 — 2026-10-09 — The workspace share record's `passwordHash` is shown as `has_password`
 *     (secrets audit 2026-10-09, finding 1.7).
 *   v1.3.0 — 2026-09-28 — System 2's provider keys: `ai.apikey.provider.<id>` and
 *     `ai.apikey.agent.<agent>.<id>`, matched by the `ai.apikey.` prefix.
 *   v1.2.0 — 2026-09-23 — The key of an owner's own decision provider (`decide.apikey.provider.<id>`).
 *   v1.1.0 — 2026-09-20 — `decide.apikey` joins the list (it had been readable as ciphertext through
 *     the generic doors since 2026-09-19), and so do the per-agent key records of both models,
 *     matched by prefix because the agent's name is the tail of the key.
 *   v1.0.0 — 2026-09-16 — Initial.
 */
import { PSP_RECORD_KEY, PSP_SECRET_FIELDS, pspSecretHint } from '../commerce/psp-secrets.js';

export const OPENROUTER_KEY_RECORD = 'openrouter.apikey';

/** The owner's own TypeSafe key (services/decide/settings.ts). Named here, not imported, so this
 *  module stays a leaf the memory doors can import without pulling the decide service in. */
export const DECIDE_KEY_RECORD_KEY = 'decide.apikey';

/** System 2's AI provider keys, named here so this module stays a leaf. */
export const AI_KEY_PREFIX = 'ai.apikey.';

/** The memory keys whose value holds a credential. Matched exactly: a key is an address. */
export const SECRET_RECORD_KEYS: ReadonlySet<string> = new Set([OPENROUTER_KEY_RECORD, DECIDE_KEY_RECORD_KEY, PSP_RECORD_KEY]);

/**
 * A key per agent, for both models: `openrouter.apikey.agent.<name>` and `decide.apikey.agent.<name>`
 * (services/agent-ai-keys.ts). The agent's name is the tail, so these two are matched by prefix.
 */
export const AGENT_KEY_PREFIXES: readonly string[] = [
  `${OPENROUTER_KEY_RECORD}.agent.`, `${DECIDE_KEY_RECORD_KEY}.agent.`,
  // The key of an owner's own decision provider (services/decide/providers.ts): its id is the tail.
  `${DECIDE_KEY_RECORD_KEY}.provider.`,
  // System 2's provider keys (services/ai/provider-store.ts): the owner's `ai.apikey.provider.<id>`
  // and an agent's `ai.apikey.agent.<agent>.<id>`. One prefix covers both.
  AI_KEY_PREFIX,
];

export function isSecretRecordKey(key: unknown): boolean {
  return typeof key === 'string' && (SECRET_RECORD_KEYS.has(key) || AGENT_KEY_PREFIXES.some(p => key.startsWith(p)));
}

/** A workspace's public-share record (routes/organisms/workspace-ops.ts writes it). */
const WORKSPACE_SHARE_KEY_RE = /^organism\.[^.]+\.w\.[^.]+\.meta\.share$/;

export function isWorkspaceShareKey(key: unknown): boolean {
  return typeof key === 'string' && WORKSPACE_SHARE_KEY_RE.test(key);
}

/** The value a generic door may show. Every other key passes through untouched. */
export function shownMemoryValue(key: string, value: unknown): unknown {
  if (isWorkspaceShareKey(key) && value && typeof value === 'object' && !Array.isArray(value)
    && 'passwordHash' in (value as Record<string, unknown>)) {
    const { passwordHash, ...rest } = value as Record<string, unknown>;
    return { ...rest, has_password: typeof passwordHash === 'string' && passwordHash.length > 0 };
  }
  if (!isSecretRecordKey(key) || value === null || value === undefined) return value;
  if (key !== PSP_RECORD_KEY) return { configured: true };
  if (typeof value !== 'object' || Array.isArray(value)) return { configured: true };
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const field of PSP_SECRET_FIELDS) {
    if (out[field] === undefined) continue;
    const hint = pspSecretHint(out[field]);
    out[field] = hint ? { configured: true, hint } : { configured: false };
  }
  return out;
}

/**
 * The refusal the generic delete and restore give for these keys (services/memory-bin.ts), with the
 * record's own route. Delete names the route that removes the credential; restore names the route
 * that stores it, because an old credential is never put back from the bin: the owner stores the one
 * they mean to use. Every principal is refused here, the owner in person included; the owner acts on
 * the record's own route.
 */
export function secretRecordBinRefusal(key: string, act: 'delete' | 'restore'): { code: string; message: string } {
  if (act === 'restore') {
    const write = secretRecordWriteRefusal(key).message.replace(/^.*Use /, '');
    return {
      code: 'SECRET_RECORD',
      message: `"${key}" holds a credential, so it is not put back through the memory bin. Store the credential again with ${write}`,
    };
  }
  const door = key.startsWith(`${DECIDE_KEY_RECORD_KEY}.provider.`)
    ? 'DELETE /v1/ai/decide/providers/{id} (the owner in person)'
    : key.startsWith(`${AI_KEY_PREFIX}provider.`)
    ? 'DELETE /v1/ai/providers/{id}/key (the AI settings page, the owner in person)'
    : AGENT_KEY_PREFIXES.some(p => key.startsWith(p))
    ? 'DELETE /v1/agents/{name}/ai-keys/{model} (the agent\'s page)'
    : key === OPENROUTER_KEY_RECORD
      ? 'DELETE /v1/openrouter/settings (the AI settings page)'
      : key === DECIDE_KEY_RECORD_KEY
        ? 'DELETE /v1/ai/decide/settings/key (the AI settings page, Decision model)'
        : 'DELETE /v1/commerce/payout/stripe (Wallet, Selling and payments)';
  return {
    code: 'SECRET_RECORD',
    message: `"${key}" holds a credential, so it is not removed through the general memory doors. Use ${door}.`,
  };
}

/** The refusal a generic write door gives for these keys, with the door to use instead. */
export function secretRecordWriteRefusal(key: string): { code: string; message: string } {
  const door = key.startsWith(`${DECIDE_KEY_RECORD_KEY}.provider.`)
    ? 'PUT /v1/ai/decide/providers/{id} (the owner in person)'
    : key.startsWith(`${AI_KEY_PREFIX}provider.`)
    ? 'PUT /v1/ai/providers/{id}/key (the AI settings page, the owner in person)'
    : key.startsWith(`${AI_KEY_PREFIX}agent.`)
    ? 'PUT /v1/agents/{name}/ai-keys with a provider (the agent\'s page)'
    : AGENT_KEY_PREFIXES.some(p => key.startsWith(p))
    ? 'PUT /v1/agents/{name}/ai-keys (the agent\'s page)'
    : key === OPENROUTER_KEY_RECORD
      ? 'PUT /v1/openrouter/settings (the AI settings page)'
      : key === DECIDE_KEY_RECORD_KEY
        ? 'PUT /v1/ai/decide/settings (the AI settings page, Decision model)'
        : 'PUT /v1/commerce/payout/stripe (Wallet, Selling and payments) or aimeat_commerce_psp_set';
  return {
    code: 'SECRET_RECORD',
    message: `"${key}" holds a credential, so it is not written through the general memory doors. Use ${door}.`,
  };
}
