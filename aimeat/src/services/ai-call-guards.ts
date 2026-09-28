/**
 * @file ai-call-guards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The checks an AI call passes before anything is spent, and the fallback cost
 *   estimate: the provider host allowlist, the owner's app allowlist, the owner's key, the daily
 *   budget and the per-app cap. A pure move out of ai-completion.ts (max-file-lines), which
 *   re-exports every name, so no importer changes.
 * @structure estimateCostUsd · assertProviderAllowed · assertAppAllowed · decryptOwnerKey · assertWithinBudget ·
 *   readCallRole
 * @version-history
 *   v1.1.0 — 2026-09-28 — readCallRole: the one check of a call's `role` field (AI roles), shared by the routes.
 *   v1.0.0 — 2026-09-28 — Moved from ai-completion.ts, unchanged.
 */
import type { AimeatConfig } from '../config.js';
import { decrypt, getEncryptionKey } from './encryption.js';
import type { ProviderType } from './openrouter.js';
import { AiCompletionError } from './ai/errors.js';
import { appSpentToday, appQuotaFor, appAllowlisted } from './ai-app-id.js';
import type { UsageRecord } from './ai-usage-record.js';
import { getDailyBudgetUsd } from './ai-daily-budget.js';

/**
 * Rough cost estimate when the provider didn't report one (LM Studio, custom).
 * The user's OpenRouter dashboard is authoritative — budgets exist to prevent
 * runaways, not to bill.
 */
const FALLBACK_PROMPT_COST_PER_TOKEN = 0.000005;
const FALLBACK_COMPLETION_COST_PER_TOKEN = 0.000015;

/** The fallback when the provider does not report a cost. Exported so the chat proxy uses the same
 *  arithmetic rather than a second guess at what a turn was worth. */
export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return promptTokens * FALLBACK_PROMPT_COST_PER_TOKEN
    + completionTokens * FALLBACK_COMPLETION_COST_PER_TOKEN;
}

/**
 * Provider host allowlist — the guard that stands between a decrypted AI key and wherever an
 * owner- (or app-) supplied baseUrl points.
 *
 * On a public multi-tenant node `config.aiProviderAllowlist` restricts which HOST the key may be
 * sent to, so a poisoned baseUrl cannot exfiltrate it. Empty = any host (local dev, self-hosted
 * models). Exported because EVERY path that decrypts a key must run it, and one shared function is
 * how that invariant stays true as paths are added. See docs/coding-guidelines/security-development-dna.md.
 */
export function assertProviderAllowed(config: AimeatConfig, baseUrl: string): void {
  if (config.aiProviderAllowlist.length === 0) return;
  let providerHost: string;
  try { providerHost = new URL(baseUrl).hostname.toLowerCase(); }
  catch { throw new AiCompletionError('INVALID_BASE_URL', 400, `Invalid AI provider baseUrl: ${baseUrl}`); }
  if (!config.aiProviderAllowlist.includes(providerHost)) {
    throw new AiCompletionError('PROVIDER_NOT_ALLOWED', 403,
      `AI provider host "${providerHost}" is not in this node's allowlist. Ask the operator to allow it.`);
  }
}

/** The owner's per-app allowlist (only meaningful once they configured one). */
export function assertAppAllowed(prefs: Record<string, unknown>, appId?: string, ownerGhii?: string): void {
  const allowlist = Array.isArray(prefs.app_allowlist) ? (prefs.app_allowlist as string[]) : null;
  if (!allowlist) return;
  // Under any of the app's names (services/ai-app-id.ts): an entry saved as `app.html` still allows `app`.
  if (appId && !appAllowlisted(allowlist, appId, ownerGhii)) {
    throw new AiCompletionError('APP_NOT_ALLOWED', 403,
      `App "${appId}" is not in your AI allowlist. Enable it from Settings.`);
  }
  if (!appId) {
    throw new AiCompletionError('APP_ID_REQUIRED', 403,
      'app_id is required because you have configured an AI app allowlist.');
  }
}

/** Decrypt the owner's stored provider key. Undefined is legitimate for a keyless self-hosted
 *  provider; OpenRouter without a key is not, and says so. */
export function decryptOwnerKey(
  config: AimeatConfig, apiKeyRecordValue: unknown, provider: ProviderType,
): string | undefined {
  const encrypted = (apiKeyRecordValue as { encrypted?: string } | undefined)?.encrypted;
  if (encrypted) {
    const encKey = getEncryptionKey(config);
    if (!encKey) {
      throw new AiCompletionError('ENCRYPTION_NOT_CONFIGURED', 503,
        'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
    }
    return decrypt(encrypted, encKey);
  }
  if (provider === 'openrouter') {
    throw new AiCompletionError('NO_API_KEY', 400, 'No OpenRouter API key configured. Set one in Settings.');
  }
  return undefined;
}

/**
 * Daily budget + per-app cap. Both are pre-call checks against what has ALREADY been spent, so a
 * single call can overshoot the budget by its own cost; the cap stops the next one. Returns the
 * resolved daily budget so the caller can report it.
 */
export function assertWithinBudget(
  usage: UsageRecord, prefs: Record<string, unknown>, appId?: string, ownerGhii?: string,
): number {
  const dailyBudget = getDailyBudgetUsd(prefs);
  if (usage.total_cost_usd >= dailyBudget) {
    throw new AiCompletionError('QUOTA_EXHAUSTED', 402,
      `Daily AI budget hit ($${usage.total_cost_usd.toFixed(4)} / $${dailyBudget}). Raise it in Settings or wait until midnight UTC.`);
  }
  if (appId) {
    // Per-app cap. By DEFAULT an app may spend the whole daily budget the owner set (the "AI apps
    // daily budget") — there is no separate hidden per-app default. An explicit app_quotas.<app>
    // override throttles that one app below the budget when the owner wants it.
    // One app, one cap, whatever name a door recorded it under (services/ai-app-id.ts).
    const appQuota = appQuotaFor(prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined, appId, ownerGhii, dailyBudget);
    const appSpent = appSpentToday(usage.per_app, appId, ownerGhii);
    if (appSpent >= appQuota) {
      throw new AiCompletionError('APP_QUOTA_EXHAUSTED', 402,
        `Daily AI quota for "${appId}" hit ($${appSpent.toFixed(4)} / $${appQuota}). Raise it in Settings.`);
    }
  }
  return dailyBudget;
}

/** The longest AI role name a call may give: an app's `<name>` or an owner's role id, with room. */
export const CALL_ROLE_MAX_CHARS = 300;

/**
 * The `role` a call names (services/ai/roles.ts), read from a request body: absent, or a string of 1
 * to 300 characters. Anything else is refused with INVALID_BODY before the call is planned, so a
 * number or an empty string is never taken for "no role". Whether the role exists is prepareAiCall's
 * question, answered with AI_ROLE_UNKNOWN, AI_ROLE_NOT_DECLARED or AI_ROLE_NOT_BOUND.
 */
export function readCallRole(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > CALL_ROLE_MAX_CHARS) {
    throw new AiCompletionError('INVALID_BODY', 400,
      `role must be a string of 1 to ${CALL_ROLE_MAX_CHARS} characters: one of your AI roles (GET /v1/ai/roles), or for an app a role it declares.`);
  }
  return value;
}
