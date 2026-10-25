/**
 * @file src/services/config-rate-limit-sync.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rate-limit settings (`rate_limits.*`, config keys rlGlobal … rlAuthChallenge) are
 *   numbers on the config, and the request limiters read the tiers of `config.rateLimits`. This
 *   copies each number into its tier's `max`. It ran only at boot (config-overrides.ts), so a rate
 *   limit saved on the Config endpoint, or changed by the Consul watch, was stored and reported as
 *   applied while every limiter kept its old number until a restart (measured 2026-10-11: the boards
 *   limit saved as 1 per second, twelve requests at once all answered 200). Every writer of a
 *   setting calls it now, and middleware/rate-limit.ts reads the tier on each request.
 *
 *   It imports nothing: the config is read by its shape, because config.ts reaches config-schema.ts
 *   and importing the config type here would close an import cycle (config-schema-morsels.ts says
 *   the same).
 * @structure RATE_LIMIT_KEYS · syncRateLimitTiers(config)
 * @usage syncRateLimitTiers(config);   // after any write of a config field
 * @version-history
 *   v1.1.0 — 2026-10-25 — rlRegistrationInvites and rlOpenrouter, which got Config-tab rows.
 *   v1.0.0 — 2026-10-11 — Moved from config-overrides.ts (the list and the loop) so the live write
 *     paths can call it.
 */

/** Each rate-limit setting (its config key) and the limiter tier of `config.rateLimits` it sets. */
export const RATE_LIMIT_KEYS: ReadonlyArray<{ key: string; tier: string }> = [
  { key: 'rlGlobal', tier: 'global' },
  { key: 'rlAuth', tier: 'auth' },
  { key: 'rlWork', tier: 'work' },
  { key: 'rlMemory', tier: 'memory' },
  { key: 'rlBoards', tier: 'boards' },
  { key: 'rlOwners', tier: 'owners' },
  { key: 'rlGhii', tier: 'ghii' },
  { key: 'rlFlags', tier: 'flags' },
  { key: 'rlAppeals', tier: 'appeals' },
  { key: 'rlAdminSetup', tier: 'adminSetup' },
  { key: 'rlFederation', tier: 'federation' },
  { key: 'rlCatalogue', tier: 'catalogue' },
  { key: 'rlAuthChallenge', tier: 'authChallenge' },
  { key: 'rlRegistrationInvites', tier: 'registrationInvites' },
  { key: 'rlOpenrouter', tier: 'openrouter' },
];

/**
 * Copy every rate-limit setting into its tier. The tier objects stay the same, so a limiter built
 * from one sees the new number. A config with no tiers (a test fixture) has nothing to copy into.
 */
export function syncRateLimitTiers(config: object): void {
  const fields = config as Record<string, unknown>;
  const tiers = fields.rateLimits as Record<string, { max?: number } | undefined> | undefined;
  if (!tiers) return;
  for (const { key, tier } of RATE_LIMIT_KEYS) {
    const val = fields[key];
    const target = tiers[tier];
    if (target && typeof val === 'number' && val >= 1) target.max = val;
  }
}
