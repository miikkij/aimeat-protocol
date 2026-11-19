/**
 * @file src/config/eudiw-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check of the `eudiw.enabled` setting. Until 2026-11-19 this file was a boot
 *   refusal; what it required has been built, and the refusal is gone.
 *
 *   THE GAP IT GUARDED (2026-09-01 to 2026-11-19). `services/sd-jwt.ts` verified the ISSUER's
 *   signature on a presented credential and checked nothing else: no holder binding (no key-binding
 *   JWT, so nothing tied the presentation to the wallet the credential was issued to) and no nonce
 *   (the authorization request's challenge, generated in `services/eudiw.ts`, was never read back).
 *   A presented credential was therefore REPLAYABLE by anyone who had seen one, and what it bought
 *   was an identity verification. So `AIMEAT_EUDIW_ENABLED=true` refused to start the node, and the
 *   runtime setting refused `true`.
 *
 *   WHY THE REFUSAL WENT. It named three conditions for its own deletion, and all three now hold:
 *     1. A Key Binding JWT (SD-JWT VC, draft-ietf-oauth-selective-disclosure-jwt §4.3) is required
 *        and verified against the credential's own `cnf.jwk`, with typ `kb+jwt`, an `iat` window and
 *        an `sd_hash` over the presented SD-JWT (`services/sd-jwt.ts`, requireKeyBinding).
 *     2. The KB-JWT's `nonce` is compared with the nonce on this node's own verification round, the
 *        round is spent by an atomic delete, and the nonce is spent once more through
 *        `services/assertion-spend.ts` (`services/eudiw.ts` verifyPresentation, `routes/verification.ts`).
 *     3. The KB-JWT's `aud` must equal `config.eudiwClientId`, the client id this node puts in its
 *        authorization request.
 *   The same change made every disclosure answer a digest in the issuer-signed payload, which the
 *   old code did not check either. The proofs are in `test/unit/eudiw-presentation.test.ts`.
 *
 *   WHAT STAYS. The setting's check is still the one place every write path of `eudiw.enabled`
 *   runs (PUT /v1/admin/config, a stored value and Consul at start), so it keeps its name and now
 *   accepts a boolean. A node with no trusted EUDIW issuer opens no wallet round
 *   (GET /v1/ghii/verify/eudiw/request answers 503 EUDIW_NO_TRUSTED_ISSUER); that check reads the
 *   database and lives in the route, not here.
 *
 * @structure eudiwSettingAllowed() · EUDIW_SETTING_REFUSAL
 * @usage eudiwSettingAllowed is the `eudiw.enabled` row's check in services/config/schema.ts
 * @version-history
 *   2026-11-19 — The boot refusal assertEudiwNotHalfBuilt() and its call in loadConfig() are removed,
 *     and eudiwSettingAllowed accepts `true`: holder binding, nonce and audience checks exist (see
 *     the description). The file stays for the setting check and for this record.
 *   2026-10-16 — eudiwSettingAllowed: the runtime setting refuses `true` at PUT /v1/admin/config and when
 *     a stored or Consul value is applied at start, so the switch cannot be turned on past the boot
 *     refusal (QA audit D6-01, F21b-01).
 *   v1.0.0 — 2026-09-01 — Initial. Named during the Agent v2 A2A review as a replay-adjacent path
 *     outside that work; closed as "cannot be enabled" rather than by implementing holder binding.
 */

/**
 * The check of the `eudiw.enabled` setting (services/config/schema.ts): a boolean. Every write path
 * of the setting runs the row's check, so this stays the one place its rule is stated.
 */
export function eudiwSettingAllowed(v: unknown): boolean {
  return typeof v === 'boolean';
}

/** What the operator is told when the setting is refused (services/config/apply.ts). */
export const EUDIW_SETTING_REFUSAL =
  'EU wallet identity verification is switched on or off with true or false. Nothing was changed.';
