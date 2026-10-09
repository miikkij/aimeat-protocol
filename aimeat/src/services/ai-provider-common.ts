/**
 * @file src/services/ai-provider-common.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The checks a provider record passes on both of the node's AI systems: System 1, the
 *   decision model (services/decide/providers.ts), and System 2, the ordinary model call
 *   (services/ai/providers.ts). The two systems stay separate code because they call different APIs;
 *   what they share is the vocabulary and these checks, so a provider id, the word `local` and the
 *   operator's egress list mean one thing on both.
 *
 *   A PURE MOVE out of services/decide/providers.ts v1.3.0 (System 2 plan, V3). The reasons each
 *   function is the way it is moved with it; System 1's behaviour does not change, and e2e-ai-decide
 *   proves it.
 * @structure
 *   isObj · isLoopbackHost · PROVIDER_ID_RE · PROVIDER_ID_PROBLEM · providerIdOf ·
 *   PROVIDER_KEY_ENV_PREFIX · PROVIDER_KEY_ENV_RULE · isProviderKeyEnvName · egressOriginsOf
 * @usage
 *   const id = providerIdOf(req.params.id);
 *   const origins = egressOriginsOf(config.decideProviderEgress, 'decide', 'AIMEAT_DECIDE_PROVIDER_EGRESS');
 * @version-history
 *   v1.1.0 — 2026-10-09 — isProviderKeyEnvName: an operator's provider may name only a provider key
 *     variable as its key, on both systems (secrets audit 2026-10-09, S1).
 *   v1.0.0 — 2026-09-28 — Initial: moved from services/decide/providers.ts, unchanged.
 */
import { logger } from '../utils/logger.js';
import { isLinkLocalHost } from '../utils/url-validator.js';
import { keyEnvProblem } from './crew-llm-guard.js';

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** This machine, for the one word that decides whether the data leaves it. */
export const isLoopbackHost = (host: string): boolean => host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);

export const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const PROVIDER_ID_PROBLEM = "id: lower-case letters, digits and '-', 2 to 63 characters.";

/**
 * A provider id as every endpoint reads it: trimmed, then held to PROVIDER_ID_RE, or null. ONE
 * reading for the record, the taken-id guard, the key it is stored under and delete (invariant 13):
 * the guard once read the path id as sent while the record held it trimmed, so " typesafe" passed the
 * guard and was stored as an owner provider under the node's own id, where delete never found it.
 */
export function providerIdOf(raw: unknown): string | null {
  const id = typeof raw === 'string' ? raw.trim() : '';
  return PROVIDER_ID_RE.test(id) ? id : null;
}

/**
 * WHICH VARIABLE AN OPERATOR'S PROVIDER MAY SEND AS ITS KEY. A provider record with
 * `auth: { type: 'env', env: NAME }` sends the value of NAME as the bearer to the provider's address.
 * The name used to be any upper-case word, so a record could name DATABASE_URL or
 * AIMEAT_ENCRYPTION_KEY and send it anywhere; the first-run setup route could write such a record
 * into .env (secrets audit 2026-10-09, node configuration S1). An ALLOW-LIST, as for a crew's key
 * (services/crew-llm-guard.ts, Jouni 2026-10-02): a deny-list of today's secrets misses the next one.
 *
 * A key variable is one of three things: a name under the node's own prefix AIMEAT_AI_KEY_ (the
 * documented place for an operator's provider key), a vendor-style name ending in _API_KEY that does
 * not start with AIMEAT_ (the crew rule, keyEnvProblem), or one of the decision-model keys the
 * built-in providers already name (services/decide/providers.ts BUILTIN_PROVIDERS).
 */
export const PROVIDER_KEY_ENV_PREFIX = 'AIMEAT_AI_KEY_';
const PROVIDER_KEY_ENV_NAMES: readonly string[] = ['AIMEAT_DECIDE_LAYA_KEY', 'AIMEAT_DECIDE_VON_KEY', 'AIMEAT_DECIDE_JEFF_KEY'];
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const PROVIDER_KEY_ENV_RULE = `auth.env names a provider key variable: ${PROVIDER_KEY_ENV_PREFIX}<NAME>, `
  + `a name ending in _API_KEY that does not start with AIMEAT_ (for example ANTHROPIC_API_KEY), or one of ${PROVIDER_KEY_ENV_NAMES.join(', ')}. `
  + 'A variable of the node itself, such as DATABASE_URL or AIMEAT_ENCRYPTION_KEY, is never a provider key.';

/** True when an operator's provider may send the value of `name` as its key. */
export function isProviderKeyEnvName(name: unknown): name is string {
  if (typeof name !== 'string' || !ENV_NAME_RE.test(name)) return false;
  if (name.startsWith(PROVIDER_KEY_ENV_PREFIX) && name.length > PROVIDER_KEY_ENV_PREFIX.length) return true;
  return PROVIDER_KEY_ENV_NAMES.includes(name) || keyEnvProblem(name) === null;
}

/**
 * An operator's egress list, as origins. An entry that is not an http(s) address, carries a path or
 * credentials, or names a link-local address is left out and logged, so a typo cannot widen the list.
 * `tag` and `variable` name the system and the setting in that log line.
 */
export function egressOriginsOf(list: string | undefined, tag: string, variable: string): string[] {
  const out: string[] = [];
  for (const entry of (list ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const u = URL.canParse(entry) ? new URL(entry) : null;
    const ok = u && (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password
      && (u.pathname === '/' || u.pathname === '') && !u.search && !isLinkLocalHost(u.hostname);
    if (!ok) {
      logger.error(`[${tag}] an ${variable} entry was refused`, {
        entry, fix: 'scheme, host and port only, e.g. http://127.0.0.1:8801 or http://laya:8000; never a link-local address',
      });
      continue;
    }
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  return out;
}
