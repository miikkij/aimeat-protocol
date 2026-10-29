/**
 * @file services/ai/node-key-balance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether this node's own OpenRouter key has money left, as OpenRouter keeps it.
 *
 *   A customer node (a Solo seat) gets the AI balance its owner bought as a key of its own whose
 *   limit, kept by OpenRouter, is the balance (aimeat-commercial's fleet service, 2026-10-29). The
 *   per-person allowance on such a node is set high on purpose, so the node's own accounting never
 *   says the money ran out: OpenRouter does, by answering 402 (`metadata.limit_source`
 *   `openrouter_key_limit`) once the limit is reached. A top-up raises the limit on OpenRouter while
 *   the node runs.
 *
 *   So the node learns the key is spent from that answer (markNodeKeySpent, called where a node-key
 *   call fails), and from then on asks OpenRouter (GET /key) at most once a minute whether the limit
 *   has been raised (nodeKeySpent). Until it has, nodeKeyStanding says the node's key may not pay,
 *   and the person gets the notice with their three choices before any call is made. Nothing asks
 *   OpenRouter while the key is not known to be spent, so a call costs no extra round trip.
 *
 *   The state is this process's: one node runs one process, and a restart forgets it, which costs
 *   one refused call before it is known again.
 * @structure NodeKeyBalance · markNodeKeySpent() · nodeKeySpent() · readNodeKeyBalance() ·
 *   allowanceShown() · resetNodeKeyBalanceForTests()
 * @usage
 *   if (keyScope === 'node' && isNoCreditFailure(err)) markNodeKeySpent();
 *   if (await nodeKeySpent(config)) { … refuse with the balance notice … }
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (UX review 2026-10-29, A1: the balance the owner bought ran out).
 */
import type { AimeatConfig } from '../../config.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { fixedBaseUrlOf } from './providers.js';

/** The key's money as OpenRouter keeps it, in US dollars. `limitUsd` null: the key has no limit. */
export interface NodeKeyBalance { limitUsd: number | null; usageUsd: number; remainingUsd: number | null; checkedAt: string }

/** How often a spent key is asked again whether its limit was raised. */
const SPENT_RECHECK_MS = 60_000;
/** How long an answer is reused for a page that shows the balance. */
const BALANCE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;

let spentSince: number | null = null;
let lastRecheck = 0;
let cached: { key: string; at: number; value: NodeKeyBalance } | null = null;

/** The node's key answered that its money is spent (errors.ts isNoCreditFailure, read by route-run.ts). */
export function markNodeKeySpent(): void {
  if (spentSince === null) logger.warn('[ai] the node\'s OpenRouter key has no money left; calls on it are refused until its limit is raised');
  spentSince ??= Date.now();
  lastRecheck = Date.now();
  cached = null;
}

/**
 * Whether the node's key is known to be spent. While it is, OpenRouter is asked at most once a
 * minute whether the limit was raised; a raised limit, or an answer that the key has no limit,
 * clears it. A failed question keeps the key spent: the next one is a minute away.
 */
export async function nodeKeySpent(config: AimeatConfig): Promise<boolean> {
  if (spentSince === null) return false;
  if (Date.now() - lastRecheck < SPENT_RECHECK_MS) return true;
  lastRecheck = Date.now();
  const balance = await readNodeKeyBalance(config, { fresh: true });
  if (balance && (balance.remainingUsd === null || balance.remainingUsd > 0)) {
    logger.info('[ai] the node\'s OpenRouter key has money again', { remainingUsd: balance.remainingUsd });
    spentSince = null;
    return false;
  }
  return true;
}

/** The node's key's money, from OpenRouter's GET /key; null when the node has no key or the question failed. */
export async function readNodeKeyBalance(config: AimeatConfig, opts: { fresh?: boolean } = {}): Promise<NodeKeyBalance | null> {
  const key = (config.openrouterInstanceKey ?? '').trim();
  if (!key) return null;
  if (!opts.fresh && cached && cached.key === key && Date.now() - cached.at < BALANCE_TTL_MS) return cached.value;
  try {
    const res = await safeFetch(`${fixedBaseUrlOf(config, 'openrouter')}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      sensitiveHeaders: ['authorization'],
    });
    if (!res.ok) {
      logger.warn(`[ai] OpenRouter did not tell the node's key balance (HTTP ${res.status})`);
      return null;
    }
    const data = ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const limitUsd = num(data.limit);
    const usageUsd = num(data.usage) ?? 0;
    const remainingUsd = limitUsd === null ? null : (num(data.limit_remaining) ?? Math.max(0, limitUsd - usageUsd));
    const value: NodeKeyBalance = { limitUsd, usageUsd, remainingUsd, checkedAt: new Date().toISOString() };
    cached = { key, at: Date.now(), value };
    if (remainingUsd !== null && remainingUsd <= 0) markNodeKeySpent();
    return value;
  } catch (err) {
    logger.warn('[ai] OpenRouter did not tell the node\'s key balance', { error: String(err) });
    return null;
  }
}

/** Below this share of the key's limit, the allowance a person is shown is low. */
const LOW_SHARE = 0.1;

/**
 * The AI allowance a person is shown: what is left of their allowance on this node, or of the
 * node's key's own limit when that is smaller. A customer node sets the allowance high on purpose
 * and keeps the real balance as the key's limit, so the allowance alone would show $1000 left on a
 * balance of $10. `low` is true below a tenth of the limit, for the warning before it runs out.
 */
export async function allowanceShown(config: AimeatConfig, allowanceRemainingUsd: number): Promise<{ remainingUsd: number; low: boolean }> {
  const balance = await readNodeKeyBalance(config);
  if (!balance || balance.limitUsd === null || balance.remainingUsd === null) return { remainingUsd: allowanceRemainingUsd, low: false };
  const remainingUsd = Math.max(0, Math.min(allowanceRemainingUsd, balance.remainingUsd));
  return { remainingUsd, low: balance.limitUsd > 0 && remainingUsd < balance.limitUsd * LOW_SHARE };
}

/** Forget what this process knows, for a test. */
export function resetNodeKeyBalanceForTests(): void {
  spentSince = null; lastRecheck = 0; cached = null;
}
