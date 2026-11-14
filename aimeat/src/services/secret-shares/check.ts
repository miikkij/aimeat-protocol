/**
 * @file src/services/secret-shares/check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The check a deposit gets when the node knows the service a secret belongs to: one call
 *   to that service's own account endpoint, with the secret, to learn whether it works, which
 *   account it opens and what the account reports (plan, usage, limit). Both parties then see the same
 *   account tag, which answers "are we on the same account" without either seeing the other's key.
 *
 *   THE HOST IS NEVER CHOSEN BY A USER. A recipe names a fixed https host and path, bundled in this
 *   file. A recipe a person or an agent could write would let a request's maker send the depositor's
 *   key to an address of the maker's choosing the moment it is deposited. A new service is a new
 *   entry here, in a reviewed commit.
 *
 *   Only text secrets under open or sealed protection are checked: the node cannot read an e2e one.
 *   A failed or slow check never blocks the deposit; it is recorded as not ok.
 * @structure RECIPES · recipeFor · runCheck · accountTag
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { createHash } from 'node:crypto';
import type { SecretShareCheck } from '../../storage/types/secret-shares.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readJson } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';

interface Recipe {
  service: string;
  /** Matches the share's name, upper-cased: a word a person would put in it. */
  nameHint: RegExp;
  /** Matches the secret itself: a prefix the service prints on its keys. */
  keyHint?: RegExp;
  url: string;
  headers: (secret: string) => Record<string, string>;
  /** The account id in the answer, hashed into a short tag. */
  account?: (body: Record<string, unknown>) => unknown;
  /** Readable facts from the answer. Strings only; never the secret. */
  facts?: (body: Record<string, unknown>) => Record<string, string>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const str = (v: unknown): string | undefined => (typeof v === 'number' || typeof v === 'string' ? String(v) : undefined);
const dateOf = (unix: unknown): string | undefined => (typeof unix === 'number' ? new Date(unix * 1000).toISOString().slice(0, 10) : undefined);
const clean = (m: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));

export const RECIPES: readonly Recipe[] = [
  {
    service: 'elevenlabs', nameHint: /ELEVEN\s*LABS|ELEVENLABS|XI[-_]API/, keyHint: /^sk_[0-9a-f]{40,}$/,
    url: 'https://api.elevenlabs.io/v1/user',
    headers: s => ({ 'xi-api-key': s }),
    account: b => b.user_id,
    facts: b => {
      const sub = obj(b.subscription);
      return clean({
        tier: str(sub.tier), characters_used: str(sub.character_count), characters_limit: str(sub.character_limit),
        resets_on: dateOf(sub.next_character_count_reset_unix),
      });
    },
  },
  {
    service: 'openrouter', nameHint: /OPEN\s*ROUTER/, keyHint: /^sk-or-/,
    url: 'https://openrouter.ai/api/v1/key',
    headers: s => ({ authorization: `Bearer ${s}` }),
    account: b => obj(b.data).label,
    facts: b => { const d = obj(b.data); return clean({ usage: str(d.usage), limit: str(d.limit), limit_remaining: str(d.limit_remaining), free_tier: str(d.is_free_tier) }); },
  },
  {
    service: 'anthropic', nameHint: /ANTHROPIC|CLAUDE/, keyHint: /^sk-ant-/,
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: s => ({ 'x-api-key': s, 'anthropic-version': '2023-06-01' }),
  },
  {
    service: 'openai', nameHint: /OPEN\s*AI/, keyHint: /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/,
    url: 'https://api.openai.com/v1/models',
    headers: s => ({ authorization: `Bearer ${s}` }),
  },
  {
    service: 'stripe', nameHint: /STRIPE/, keyHint: /^(sk|rk)_(live|test)_/,
    url: 'https://api.stripe.com/v1/account',
    headers: s => ({ authorization: `Bearer ${s}` }),
    account: b => b.id,
    facts: b => clean({ country: str(b.country), charges_enabled: str(b.charges_enabled) }),
  },
  {
    service: 'github', nameHint: /GITHUB|\bGH\b/, keyHint: /^(ghp_|github_pat_|gho_)/,
    url: 'https://api.github.com/user',
    headers: s => ({ authorization: `Bearer ${s}`, 'user-agent': 'aimeat-node', accept: 'application/vnd.github+json' }),
    account: b => b.id,
  },
];

/** The recipe for a share: the service the maker named, then a word in its name, then the key's prefix. */
export function recipeFor(opts: { service?: string | null; name: string; secret: string }): Recipe | null {
  if (opts.service) return RECIPES.find(r => r.service === opts.service) ?? null;
  const upper = opts.name.toUpperCase();
  return RECIPES.find(r => r.nameHint.test(upper))
    ?? RECIPES.find(r => !!r.keyHint && r.keyHint.test(opts.secret.trim()))
    ?? null;
}

/** The last 4 hex characters of SHA-256 of the service's account id, as `…a3f9`. */
export function accountTag(service: string, id: unknown): string | undefined {
  if (id === undefined || id === null || id === '') return undefined;
  return `…${createHash('sha256').update(`${service}:${String(id)}`).digest('hex').slice(-4)}`;
}

/** Run the recipe's call. Never throws; a call that fails or times out is recorded as not ok. */
export async function runCheck(recipe: Recipe, secret: string, timeoutMs = 6000): Promise<SecretShareCheck> {
  const at = new Date().toISOString();
  const value = secret.trim();
  if (!value || /[\r\n]/.test(value)) return { service: recipe.service, ok: false, status: 0, at };
  try {
    const host = new URL(recipe.url).host;
    const res = await safeFetch(recipe.url, {
      method: 'GET', headers: recipe.headers(value), signal: AbortSignal.timeout(timeoutMs),
      allowHosts: [host], maxRedirects: 0, sensitiveHeaders: Object.keys(recipe.headers('x')),
    });
    if (!res.ok) return { service: recipe.service, ok: false, status: res.status, at };
    // An account answer is a few kilobytes; 256 kB is the ceiling, and a larger one reads as no facts.
    const body = obj(await readJson(res, 256 * 1024).catch((err: unknown) => {
      // The key worked (2xx); an answer too large or not JSON only costs the facts, so it is logged.
      logger.warn('secret share: the check answer could not be read', { service: recipe.service, error: String(err) });
      return {};
    }));
    const account = recipe.account ? accountTag(recipe.service, recipe.account(body)) : undefined;
    const facts = recipe.facts ? recipe.facts(body) : undefined;
    return { service: recipe.service, ok: true, status: res.status, at, ...(account ? { account } : {}), ...(facts && Object.keys(facts).length ? { facts } : {}) };
  } catch (err) {
    logger.warn('secret share: the check call did not answer', { service: recipe.service, error: String(err) });
    return { service: recipe.service, ok: false, status: 0, at };
  }
}
