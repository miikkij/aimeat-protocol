/**
 * @file src/config-decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decision provider's settings (TARGET-080, AIMEAT.decide): TypeSafe's Jev, a model
 *   that returns typed answers with probabilities and writes no text. It sits BESIDE the text
 *   provider, never inside it, so none of these fields is read by the chat path or the model picker.
 *
 *   Its own file for the same reason config-ai-jobs.ts is one: config.ts is at the line ceiling, and
 *   everything here answers one question, how this node reaches a decision model.
 *
 *   THE MODEL IS PINNED. `jev-latest` moves when TypeSafe ships, and a threshold an owner tuned
 *   against one version can shift under the alias with no change on their side. The default is a
 *   versioned id, and the id that answered is written into every decision record.
 *
 *   THE LIMITS ARE CONFIGURATION, NOT CONSTANTS. TypeSafe states that its rate limits change without
 *   notice, and its own pages disagree on the context size, so every number an operator may need to
 *   move is here. The context default is the smaller of the two documented figures.
 * @structure DecideConfig · decideDefaults()
 * @usage
 *   import { decideDefaults } from './config-decide.js';
 *   const config = { ...decideDefaults(), ... };
 * @version-history
 *   v1.3.0 — 2026-09-24 — decideJeffKey, decideLayaKey, decideVonKey: the built-in local models'
 *     bearer keys, so the Config tab says whether each is set. laya's and von's are optional.
 *   v1.2.0 — 2026-09-23 — decideProviderEgress: the exact addresses of the operator's own local
 *     models, reachable without AIMEAT_ALLOW_PRIVATE_EGRESS.
 *   v1.1.0 — 2026-09-23 — Decision providers: the configured provider has an id and a kind, and the
 *     operator may add providers of their own, switch on the built-in examples and name the default.
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */

/**
 * Named here rather than picked from AimeatConfig, for the reason config-ai-jobs.ts gives: a type
 * import from config-types.ts would close a cycle. AiCapabilityConfig extends this interface, and the
 * spread in loadConfig is where the compiler checks the two agree.
 */
export interface DecideConfig {
  /** Operator switch for the whole node. Off answers every decide call with DECIDE_DISABLED. */
  decideEnabled: boolean;
  /**
   * The node's own TypeSafe key, spent for a person who has not brought one, from the same per-person
   * allowance as the node's OpenRouter key. Empty means everyone brings their own. It is sent to
   * `decideBaseUrl`'s host and nowhere else.
   */
  decideInstanceKey: string;
  /** The endpoint. One address, fixed by default: the node's key may only go here. */
  decideBaseUrl: string;
  /** Pinned, versioned model id. Never an alias by default. */
  decideModel: string;
  /** USD per million INPUT tokens. Output is free. Used to price a call into the ledger. */
  decidePricePerMtok: number;
  /** Estimated tokens allowed for one request (state plus every question). */
  decideMaxRequestTokens: number;
  /** Options one choice question may carry. TypeSafe documents 255 and measured about 240. */
  decideMaxChoiceOptions: number;
  /** Requests per minute this node sends, all owners together, on the node's key. */
  decideRequestsPerMinute: number;
  /** Parallel requests one bulk run may have open. A cookbook hit a limit at eight on a shared key. */
  decideConcurrency: number;
  /** How long an identical decision (same owner, model, scrubbed state and questions) is reused. 0 = never. */
  decideCacheHours: number;
  /** How many days a decision record is kept before the nightly prune removes it. */
  decideRetentionDays: number;
  /**
   * The id the provider above (`decideBaseUrl`, `decideModel`, the key chain) is known by. It is
   * written into every decision it answers. `typesafe` unless the operator points it elsewhere.
   */
  decideProviderId: string;
  /** Whether that provider runs elsewhere (`hosted`) or on this machine (`local`). */
  decideProviderKind: string;
  /**
   * More providers the operator runs, as a JSON array of provider records (services/decide/providers.ts).
   * Their auth is `none` or the NAME of an environment variable on this node, never a key.
   */
  decideProviders: string;
  /** Built-in example providers the operator switches on, comma separated: `laya,von,jeff`. */
  decideBuiltinProviders: string;
  /** The provider an owner who chose none gets. Empty means `decideProviderId`. */
  decideDefaultProvider: string;
  /**
   * The exact origins (`http://127.0.0.1:8801`, `http://laya:8000`) of the operator's own local
   * models, comma separated. The decision call, and nothing else, may reach them although they are
   * private, so a public node runs its models without AIMEAT_ALLOW_PRIVATE_EGRESS. Only the node's
   * providers use it; an owner's own address never does.
   */
  decideProviderEgress: string;
  /**
   * The bearer keys of the built-in local models, each the value its model was started with
   * (JEFF_API_KEYS, LAYA_API_KEY, VON_API_KEY in tools/systemone). jeff's is required. laya's and
   * von's are optional: empty, the call carries no key, for a model started without one. The
   * providers read the variables by name (services/decide/providers.ts envKeyOf); these fields are
   * how the Config tab says whether each is set.
   */
  decideJeffKey: string;
  decideLayaKey: string;
  decideVonKey: string;
}

/** The decision provider's settings, from the environment. */
export function decideDefaults(): DecideConfig {
  return {
    decideEnabled: process.env.AIMEAT_DECIDE_ENABLED !== 'false',
    decideInstanceKey: process.env.AIMEAT_TYPESAFE_INSTANCE_KEY ?? '',
    decideBaseUrl: process.env.AIMEAT_DECIDE_BASE_URL ?? 'https://api.typesafe.ai/v1/systemone',
    decideModel: process.env.AIMEAT_DECIDE_MODEL ?? 'jev-1.13.0',
    decidePricePerMtok: parseFloat(process.env.AIMEAT_DECIDE_PRICE_PER_MTOK ?? '0.042') || 0,
    decideMaxRequestTokens: parseInt(process.env.AIMEAT_DECIDE_MAX_REQUEST_TOKENS ?? '32000', 10),
    decideMaxChoiceOptions: parseInt(process.env.AIMEAT_DECIDE_MAX_CHOICE_OPTIONS ?? '240', 10),
    decideRequestsPerMinute: parseInt(process.env.AIMEAT_DECIDE_REQUESTS_PER_MINUTE ?? '1200', 10),
    decideConcurrency: parseInt(process.env.AIMEAT_DECIDE_CONCURRENCY ?? '4', 10),
    decideCacheHours: parseFloat(process.env.AIMEAT_DECIDE_CACHE_HOURS ?? '24') || 0,
    decideRetentionDays: parseInt(process.env.AIMEAT_DECIDE_RETENTION_DAYS ?? '365', 10),
    decideProviderId: process.env.AIMEAT_DECIDE_PROVIDER_ID ?? 'typesafe',
    decideProviderKind: process.env.AIMEAT_DECIDE_PROVIDER_KIND === 'local' ? 'local' : 'hosted',
    decideProviders: process.env.AIMEAT_DECIDE_PROVIDERS ?? '',
    decideBuiltinProviders: process.env.AIMEAT_DECIDE_BUILTIN_PROVIDERS ?? '',
    decideDefaultProvider: process.env.AIMEAT_DECIDE_DEFAULT_PROVIDER ?? '',
    decideProviderEgress: process.env.AIMEAT_DECIDE_PROVIDER_EGRESS ?? '',
    decideJeffKey: process.env.AIMEAT_DECIDE_JEFF_KEY ?? '',
    decideLayaKey: process.env.AIMEAT_DECIDE_LAYA_KEY ?? '',
    decideVonKey: process.env.AIMEAT_DECIDE_VON_KEY ?? '',
  };
}
