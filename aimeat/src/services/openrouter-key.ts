/**
 * @file src/services/openrouter-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a provider says one of this node's own keys has actually spent.
 *
 *   WHY THIS EXISTS. Until now every money figure on this node was something the node had counted
 *   itself, and two of the operator's keys are spent where the node cannot count. The chat agent's
 *   key is handed to a child process as an environment variable (services/goose-acp.ts), so its
 *   turns never pass through the metering and appear in no total anywhere. The house key is metered
 *   per call, but only for the calls that reached the metering. An operator asking "what is this
 *   costing me" was being answered with a sum of what we happened to see.
 *
 *   OpenRouter answers the question directly for the key presenting it, so the node can stop
 *   guessing and report the biller's own number beside its own.
 *
 *   IT IS NEVER CALLED ON A PAGE LOAD. The read costs an outbound round trip, and the number moves
 *   slowly, so it happens when an operator asks for it and the answer is held for a minute. A page
 *   that reaches a third party every time it renders is a page that stops loading when that third
 *   party is slow.
 *
 *   THE KEY LEAVES THIS PROCESS, so: safeFetch (SSRF-validated, and re-validated on every redirect
 *   hop), `Authorization` named as sensitive so a redirect off the origin drops it, the host checked
 *   against the same `aiProviderAllowlist` that guards a completion, and a five-second ceiling. A
 *   failure is a reported reason, never a throw into a route: not knowing is an answer this page can
 *   print, and an admin page that 500s because a provider is down is worse than one that says so.
 * @structure
 *   - KeySpend — what came back, or why nothing did
 *   - readKeySpend(config, key, label) — one key, one answer, cached for a minute
 *   - clearKeySpendCache() — for tests
 * @usage
 *   import { readKeySpend } from './openrouter-key.js';
 *   const spend = await readKeySpend(config, config.openrouterInstanceKey, 'house');
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial: the Usage page stops being unable to see the operator's own bill.
 */
import type { AimeatConfig } from '../config.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/key';
const HOST = 'openrouter.ai';
const TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;

/**
 * What a provider says about one key.
 *
 * `ok: false` carries a `reason` a person can act on rather than an error code: "no key is set" and
 * "the provider did not answer" lead to different next moves, and the page prints whichever applies.
 */
export interface KeySpend {
  ok: boolean;
  /** Which of this node's keys was asked about: 'house' or 'chat'. */
  which: string;
  /** The provider's own name for the key, when it gave one. Never the key itself. */
  label?: string;
  /** Spent on this key, all time, in USD — the provider's number, not ours. */
  usage_usd?: number;
  /** The ceiling set on the key where there is one; null means uncapped. */
  limit_usd?: number | null;
  /** What is left of that ceiling; null when there is none. */
  limit_remaining_usd?: number | null;
  is_free_tier?: boolean;
  /** When this answer was fetched, so a surface can say how stale it is. */
  read_at?: string;
  /** Why there is no answer. Present only when `ok` is false. */
  reason?: string;
}

const cache = new Map<string, { at: number; value: KeySpend }>();

/** For tests: the next read goes to the provider rather than to the last minute's answer. */
export function clearKeySpendCache(): void {
  cache.clear();
}

/**
 * Ask the provider what this key has spent.
 *
 * `key` is a secret and is used as a cache key only through its last four characters plus `which`,
 * so nothing here puts a credential in a map that something else might log.
 */
export async function readKeySpend(
  config: AimeatConfig,
  key: string | undefined,
  which: string,
): Promise<KeySpend> {
  const trimmed = (key || '').trim();
  if (!trimmed) return { ok: false, which, reason: 'No key is set for this.' };

  // The same gate a completion passes before a decrypted key is sent anywhere. An empty allowlist
  // means "any host", which is the local-dev and self-hosted default.
  const allowlist = config.aiProviderAllowlist || [];
  if (allowlist.length > 0 && !allowlist.includes(HOST)) {
    return { ok: false, which, reason: `This node does not allow keys to be sent to ${HOST}.` };
  }

  const cacheKey = `${which}:${trimmed.slice(-4)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await safeFetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${trimmed}` },
      // A 302 off openrouter.ai must not carry the key with it.
      sensitiveHeaders: ['authorization'],
      signal: controller.signal,
    });
    if (!res.ok) {
      // 401 is the one worth naming: it means the key this node holds is not accepted any more,
      // which is a thing an operator must fix and would otherwise learn from a failed call.
      const reason = res.status === 401
        ? 'The provider does not accept this key any more.'
        : `The provider answered ${res.status}.`;
      const out: KeySpend = { ok: false, which, reason };
      cache.set(cacheKey, { at: Date.now(), value: out });
      return out;
    }
    const body = await res.json() as { data?: Record<string, unknown> };
    const d = body?.data ?? {};
    const numberOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    const out: KeySpend = {
      ok: true,
      which,
      ...(typeof d.label === 'string' ? { label: d.label } : {}),
      usage_usd: typeof d.usage === 'number' ? d.usage : 0,
      limit_usd: numberOrNull(d.limit),
      limit_remaining_usd: numberOrNull(d.limit_remaining),
      is_free_tier: d.is_free_tier === true,
      read_at: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: Date.now(), value: out });
    return out;
  } catch (err) {
    const aborted = controller.signal.aborted;
    logger.warn('openrouter-key: could not read what the key spent', { which, error: String(err) });
    const out: KeySpend = {
      ok: false,
      which,
      reason: aborted
        ? 'The provider did not answer within five seconds.'
        : 'Could not reach the provider.',
    };
    // A failure is cached too, briefly: a provider that is down should be asked once a minute, not
    // once per press of a button an operator will press repeatedly while it is down.
    cache.set(cacheKey, { at: Date.now(), value: out });
    return out;
  } finally {
    clearTimeout(timer);
  }
}
