/**
 * @file reserved-keys.ts
 * @description Reserved owner-namespace memory-key prefixes that the SERVER reads and TRUSTS for
 *   behavior, plus the write gate that stops a scoped H-2 app-grant principal (role 'app') from
 *   poisoning them. An app-grant token's `sub` is the OWNER's GHII, so its `memory:write` lands in the
 *   owner's own namespace — the same namespace the server reads for: the AI-provider URL a decrypted
 *   key is sent to (`openrouter.*`), the daily AI-spend cap (`ai-usage.*`), and the public directory /
 *   matchmaking inputs (`profile.*`). A granted app must never write these; the owner manages them via
 *   the dedicated owner-only routes (`/v1/openrouter/settings`, `/v1/ghii`). Mirrors the ecosystem
 *   path's `ecoMayWriteKey` (services/ecosystem-access.ts). See
 *   docs/coding-guidelines/security-development-dna.md invariant #2.
 * @structure RESERVED_OWNER_KEY_PREFIXES · isReservedServerKey(key) · appMayWriteKey(roles, key)
 * @usage import { appMayWriteKey } from '../utils/reserved-keys.js';
 * @version-history
 *   v1.0.0 — 2026-07-10 — Created to close the app-grant reserved-key write hole (the C-2 class:
 *     OpenRouter key exfiltration via openrouter.settings.baseUrl, ai-usage budget-cap reset, and
 *     profile/directory poisoning — all via a granted app's memory:write into the owner namespace).
 */

/** Owner-namespace key prefixes the server reads and trusts for behavior — never app-writable. */
export const RESERVED_OWNER_KEY_PREFIXES = ['openrouter.', 'ai-usage.', 'profile.'] as const;

/** True iff `key` falls under a reserved, server-trusted owner-namespace prefix. */
export function isReservedServerKey(key: string): boolean {
  return RESERVED_OWNER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * May a principal with these `roles` write `key`? Denies ONLY a role-'app' (H-2 app grant) principal
 * writing a reserved server-trusted key — because an app grant resolves to the OWNER's GHII namespace,
 * unlike an agent/ecosystem principal which writes to its own GAII/`eco:` namespace. All non-'app'
 * principals (owner, agent, ecosystem) are unaffected.
 */
export function appMayWriteKey(roles: string[], key: string): boolean {
  if (!roles.includes('app')) return true;
  return !isReservedServerKey(key);
}
