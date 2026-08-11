/**
 * @file reserved-keys.ts
 * @description Reserved owner-namespace memory-key prefixes that the SERVER reads and TRUSTS for
 *   behavior, plus the write gate that stops a scoped H-2 app-grant principal (role 'app') from
 *   poisoning them. An app-grant token's `sub` is the OWNER's GHII, so its `memory:write` lands in the
 *   owner's own namespace — the same namespace the server reads for: the AI-provider URL a decrypted
 *   key is sent to (`openrouter.*`), the daily AI-spend cap (`ai-usage.*`), the public directory /
 *   matchmaking inputs (`profile.*`), who may read another owner's whole finance area
 *   (`finance.*`), and the seller's payout address and PSP secret (`commerce.*`). A granted app must
 *   never write these; the owner manages them via the dedicated owner-only routes
 *   (`/v1/openrouter/settings`, `/v1/ghii`, `/v1/finance/accountants`, `/v1/commerce/payout/*`), and
 *   an agent through the named commerce tools. Mirrors the ecosystem path's `ecoMayWriteKey`
 *   (services/ecosystem-access.ts). See
 *   docs/coding-guidelines/security-development-dna.md invariant #2.
 * @structure RESERVED_OWNER_KEY_PREFIXES · isReservedServerKey(key) ·
 *   appMayWriteKey(roles, key, delegatedOwnerWrite?, reservedAllowed?)
 * @usage import { appMayWriteKey } from '../utils/reserved-keys.js';
 * @version-history
 *   v1.3.0 — 2026-08-11 — `finance.` and `commerce.` join the list (August 2026 audit H-6, H-23).
 *     Both became server-trusted after the list was written and neither was added.
 *     `finance.accountants` is the CROSS-OWNER authorization list for the whole finance area:
 *     services/finance/accountant-access.ts hands another owner the invoices, vouchers, VAT report,
 *     P&L and the CSV / Finvoice exports on the strength of that record's contents alone, so an app
 *     that appended itself read the books. `commerce.psp` holds the seller's payout address, Stripe
 *     secret and webhook secret, read as fact by commerce/x402.ts and
 *     commerce/sellable-resolvers.ts.
 *     The prefixes are deliberately BROAD rather than the two exact keys: `commerce.order.*`,
 *     `commerce.hold.*`, `commerce.payable.*` and `commerce.benefit.*` are the money ledger the
 *     books read back as fact, and a forged entry there is the same class of lie as a forged payout
 *     address. Nothing legitimate writes either prefix through the memory API — the owner routes
 *     and the settlement code call storage directly, and the agent-facing door is the commerce MCP
 *     tools, which go through services/memory-write.ts and are gated on `commerce:psp` /
 *     `commerce:sell` instead.
 *   v1.1.0 — 2026-08-08 — The gate keys off the TARGET namespace, not only the role: an agent with
 *     `memory:write-as-owner` reaches the same keys an app grant does, and would otherwise have
 *     bypassed a guard written for that exact attack.
 *   v1.2.0 — 2026-08-08 — `reservedAllowed`: the owner may hand even the reserved keys to one named
 *     agent (`memory:write-reserved`), for an agent that administers the account. Deliberately NOT
 *     in the '*' bundle: '*' is one click in the UI and nobody picking it is deciding that an agent
 *     may redirect a decrypted AI key.
 *   v1.0.0 — 2026-07-10 — Created to close the app-grant reserved-key write hole (the C-2 class:
 *     OpenRouter key exfiltration via openrouter.settings.baseUrl, ai-usage budget-cap reset, and
 *     profile/directory poisoning — all via a granted app's memory:write into the owner namespace).
 */

/**
 * Owner-namespace key prefixes the server reads and trusts for behavior — never app-writable.
 *
 * The test for membership is not "is this sensitive" but **"does the server change what it DOES
 * because of what it finds here"**: the URL a decrypted AI key is posted to, the spend cap it
 * checks before billing, the directory entry it publishes, the list it consults before showing one
 * owner's books to another, the address it pays out to. User data the server only hands back
 * belongs nowhere near this list, because every prefix here costs a granted app a capability.
 *
 * Adding one is a behaviour change for principals that already exist. Measure it first: a prefix
 * refuses role 'app' and delegated owner writes on every memory door, so anything that legitimately
 * writes it through the memory API stops. The safe shapes are an owner-only route or a server-side
 * write that never passes through this gate, which is what the openrouter, finance and commerce
 * keys all use.
 */
export const RESERVED_OWNER_KEY_PREFIXES = [
  'openrouter.', 'ai-usage.', 'profile.', 'finance.', 'commerce.',
] as const;

/** True iff `key` falls under a reserved, server-trusted owner-namespace prefix. */
export function isReservedServerKey(key: string): boolean {
  return RESERVED_OWNER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * May a principal with these `roles` write `key`?
 *
 * The real question is NOT "which role is this" but **"does this write land in the owner's GHII
 * namespace"** — that is where the server reads the keys it trusts. Role 'app' always does, which is
 * why the original gate could key off the role alone.
 *
 * `delegatedOwnerWrite` exists because role 'app' stopped being the only way in: an agent holding
 * `memory:write-as-owner` and asking for it explicitly also writes there. Without this parameter that
 * agent would walk straight through a gate built for exactly this attack — writing
 * `openrouter.settings.baseUrl` to redirect a decrypted AI key, resetting `ai-usage.*` to clear the
 * spend cap, poisoning `profile.*`, adding itself to `finance.accountants` to read another owner's
 * books, or pointing `commerce.psp` at its own payout address. Same namespace, same danger, so the
 * same refusal.
 *
 * **It means DELEGATED, not "the namespace happens to be the owner's".** The account holder writing
 * their own keys is the whole point of those keys; passing `true` for an owner session locks the
 * owner out of their own record, which is what happened the first time this parameter was added and
 * what test/e2e-app-grants.ts ("guard is app-scoped") exists to catch.
 */
export function appMayWriteKey(
  roles: string[], key: string, delegatedOwnerWrite = false, reservedAllowed = false,
): boolean {
  const isOwnerSession = roles.includes('owner') && !roles.includes('agent') && !roles.includes('ecosystem');
  if (isOwnerSession) return true;
  if (!roles.includes('app') && !delegatedOwnerWrite) return true;
  // The owner can hand even these over, deliberately and per agent — see WRITE_RESERVED_SCOPE in
  // routes/memory/owner-target.ts for why that grant is NOT part of the '*' bundle.
  if (reservedAllowed) return true;
  return !isReservedServerKey(key);
}
