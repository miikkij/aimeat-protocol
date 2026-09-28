/**
 * @file route-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which providers may answer one call, in order, and why each of the others may not
 *   (docs/internal/llmproviderintegrations/11, sections 6 and 7). prepareAiCall (services/
 *   ai-completion.ts) runs this; the gateway tries the candidates (services/ai/route-run.ts).
 *
 *   THE CALL SAYS AT LEAST THE CAPABILITY. The less it says, the more the node chooses:
 *   - a model (`anthropic:claude-opus-5-5` or a bare id): only that model, on the owner's providers of
 *     its type in their default order. A fallback may only be the same model on another provider.
 *   - a provider (an id, or a type): that provider's model for the capability. No fallback: the
 *     caller named the provider.
 *   - the capability only: the agent's list, the owner's list, then the owner's providers marked for
 *     the pool (`extendToPool`), and only when the owner has none of those, the node's default.
 *
 *   EVERY CANDIDATE PASSES THE FILTERS BEFORE ANYTHING IS SPENT, in the order of plan 03 section 4:
 *   the capability is on, the requirements hold, the model policy allows the model, a key exists, the
 *   capability is tested (only for a candidate the node chose, and only the owner's providers: the
 *   operator answers for the node's), and a fallback does not take data off this machine when the
 *   first provider was local. A rejected candidate is kept with its reason, so the refusal names what
 *   to fix and an AI can fix it. A FAILING capability waits behind the working ones and is tried when
 *   nothing else is left: skipping is for going round a fault, never for refusing a call.
 *
 *   THE NODE'S DEFAULT IS THE LAST CANDIDATE, AND ONLY WHEN THE OWNER'S LIST IS EMPTY (plan 11,
 *   section 5). An owner whose own provider cannot answer is told why; the node's key does not
 *   quietly step in. That is also exactly what the node did before providers existed: a person with
 *   a key of their own never had the node's key spent for them.
 * @structure
 *   ChosenBy · AiCandidate · RejectedCandidate · RoutePlanInput · planRoute · refusalFor
 * @version-history
 *   v1.1.0 — 2026-09-28 — With the model catalogue (V4): a named model falls back to the same model at
 *     another type (catalog/equivalence.ts); poolOrder `cheapest` orders the pool by the catalogue's
 *     text price; the owner's maxCostPerCallUsd skips a candidate the catalogue prices above it.
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { AiCompletionError } from './errors.js';
import { chooseModel, freeModelAllowed, type LoadedPolicy, type PolicyCallContext } from './policy-gate.js';
import { parseModelRef } from './policy.js';
import {
  TYPE_CAPABILITIES, typeAllowed, providerTarget, NODE_OPENROUTER_ID, type AiProvider,
} from './providers.js';
import { readAgentProviderKey, readOwnerProviderKey } from './provider-store.js';
import { healthKey, seedHealth, skipReason, statusOf } from './health.js';
import { defaultsFor, type LoadedRouting, type RoutingRules } from './routing.js';
import { isFixedType, type AiCapability, type AiOp, type AiTarget } from './types.js';
import { UNSET_MODEL } from './unset-model.js';
import { catalogModel } from './catalog/store.js';
import { textPricePerMtok } from './catalog/price.js';
import { canonicalModelKey, equivalentModels } from './catalog/equivalence.js';

export type ChosenBy = 'call-model' | 'call-provider' | 'app-prefer' | 'agent-default' | 'owner-default' | 'pool' | 'node-default';

export interface AiCandidate {
  provider: AiProvider;
  model: string;
  target: AiTarget;
  keyScope: 'agent' | 'own' | 'node';
  chosenBy: ChosenBy;
  policyChoseModel: boolean;
  /** Node key only: what is left of the owner's allowance. */
  allowanceRemainingUsd?: number;
  /** The allowance was spent and the free model answers instead of a refusal. */
  degradedToFree?: boolean;
}

export type RejectReason =
  | 'problem' | 'type-not-allowed' | 'capability-off' | 'requires-local' | 'host-not-allowed' | 'no-model'
  | 'policy' | 'no-key' | 'node-key-host' | 'allowance-spent' | 'untested' | 'failing' | 'leaves-machine' | 'too-costly';

export interface RejectedCandidate {
  provider: string;
  model?: string;
  reason: RejectReason;
  message: string;
  /** The refusal this reason is, when it is one on its own (a policy refusal, a spent allowance). */
  error?: AiCompletionError;
}

export interface RoutePlanInput {
  storage: Storage;
  config: AimeatConfig;
  gaii: string;
  op: AiOp;
  capability: AiCapability;
  providers: { node: AiProvider[]; owner: AiProvider[] };
  routing: LoadedRouting;
  rules: RoutingRules;
  policy: LoadedPolicy;
  policyCtx: Omit<PolicyCallContext, 'providerType'>;
  /** The model the caller named. */
  requested?: string;
  /** The provider the caller named: an id, or a type. */
  namedProvider?: string;
  /** The caller's own word on fallback; the rules decide when it says nothing. */
  fallback?: boolean;
  requires?: { local?: boolean };
  agent?: string;
  /**
   * The model the owner's legacy setting and the node's defaults give this capability: what a
   * migrated provider and the node's own OpenRouter provider use when a call names none, which is
   * what every call used before providers existed (ai-model-defaults.ts).
   */
  legacyModel: (capability: AiCapability) => string | undefined;
  /** The node's allowance for this owner, read at most once. */
  nodeAllowance: () => Promise<{ remainingUsd: number }>;
  /** What the call will use, for the owner's price ceiling: the prompt's tokens (a quarter of its
   *  length) and the answer's cap. Absent, a text call is estimated at 1024 tokens each way. */
  estimate?: { promptTokens?: number; maxTokens?: number };
}

/** The capabilities whose price is per token, so the pool can be ordered by it. */
const TOKEN_PRICED: readonly AiCapability[] = ['text', 'vision', 'files'];
const DEFAULT_ESTIMATE_TOKENS = 1024;

/** What one call would cost on this model by the catalogue, or undefined when it has no price. */
function estimateCallUsd(type: string, model: string, capability: AiCapability, est?: RoutePlanInput['estimate']): number | undefined {
  const m = catalogModel(type, model);
  if (!m) return undefined;
  if (capability === 'image') return m.price.perImage;
  if (!TOKEN_PRICED.includes(capability) || (m.price.inPerMtok === undefined && m.price.outPerMtok === undefined)) return undefined;
  const inTok = est?.promptTokens ?? DEFAULT_ESTIMATE_TOKENS;
  const outTok = est?.maxTokens ?? DEFAULT_ESTIMATE_TOKENS;
  return (inTok * (m.price.inPerMtok ?? 0) + outTok * (m.price.outPerMtok ?? 0)) / 1e6;
}

export interface RoutePlan {
  candidates: AiCandidate[];
  rejected: RejectedCandidate[];
  chosenBy: ChosenBy;
  allowFallback: boolean;
  /** True when the owner's own list (defaults and pool) named anything for this capability. */
  ownerListed: boolean;
}

const nodeScope = (p: AiProvider, gaii: string): string => p.source === 'owner' ? gaii : 'node';

function serves(p: AiProvider, cap: AiCapability): boolean {
  return !!p.capabilities[cap]?.enabled && TYPE_CAPABILITIES[p.type].includes(cap);
}

/** In the owner's pool: marked for it, or the migrated provider, which was the owner's only one. */
function inPool(p: AiProvider, cap: AiCapability): boolean {
  return serves(p, cap) && (p.capabilities[cap]!.pool || !!p.legacy);
}

/** The model a provider uses for a capability when the call names none. */
function modelOf(p: AiProvider, cap: AiCapability, input: RoutePlanInput): string | undefined {
  if (p.legacy || p.id === NODE_OPENROUTER_ID) return input.legacyModel(cap) ?? p.capabilities[cap]?.model;
  return p.capabilities[cap]?.model;
}

/** One entry of the raw order: the provider, who chose it, and for a same-model fallback on another
 *  type the model's reference there (`openrouter:anthropic/claude-opus-5.5`). */
type RawEntry = [AiProvider, ChosenBy, string?];

/** The ordered list before any filter. */
function rawOrder(input: RoutePlanInput): { list: RawEntry[]; chosenBy: ChosenBy; ownerListed: boolean } {
  const { providers, capability } = input;
  const all = [...providers.owner, ...providers.node];
  const byId = new Map(all.map(p => [p.id, p]));
  const seen = new Set<string>();
  const out: RawEntry[] = [];
  const push = (p: AiProvider | undefined, by: ChosenBy, ref?: string) => { if (p && !seen.has(p.id)) { seen.add(p.id); out.push(ref ? [p, by, ref] : [p, by]); } };

  if (input.namedProvider) {
    const named = byId.get(input.namedProvider)
      ?? providers.owner.find(p => p.type === input.namedProvider) ?? providers.node.find(p => p.type === input.namedProvider);
    if (!named) {
      throw new AiCompletionError('AI_PROVIDER_NOT_CONFIGURED', 400,
        `No provider '${input.namedProvider}' is set up for you. Providers you can use: ${all.map(p => p.id).join(', ') || 'none yet'}.`,
        { provider: input.namedProvider, next: { description: 'List your AI providers', method: 'GET', url: '/v1/ai/providers' } });
    }
    push(named, 'call-provider');
    return { list: out, chosenBy: 'call-provider', ownerListed: true };
  }

  const d = defaultsFor(capability, input.routing);
  const ordered: Array<[AiProvider, ChosenBy]> = [];
  for (const id of d.agent) { const p = byId.get(id); if (p) ordered.push([p, 'agent-default']); }
  for (const id of d.owner) { const p = byId.get(id); if (p) ordered.push([p, 'owner-default']); }
  if (input.rules.extendToPool) {
    const pool = providers.owner.filter(p => inPool(p, capability));
    // `cheapest` orders the pool by the catalogue's text price (unpriced last); `priority` and
    // `fastest` keep the owner's order, since the node measures no latency to order by yet.
    if (input.rules.poolOrder === 'cheapest' && TOKEN_PRICED.includes(capability)) {
      const priceOf = (p: AiProvider) => { const m = modelOf(p, capability, input); return m ? textPricePerMtok(p.type, m) ?? Infinity : Infinity; };
      pool.sort((a, b) => priceOf(a) - priceOf(b));
    }
    for (const p of pool) ordered.push([p, 'pool']);
  }
  const ownerListed = ordered.length > 0;

  const typed = input.requested ? parseModelRef(input.requested).type : undefined;
  if (input.requested) {
    // A named model: that model's type, on the owner's providers in their order, then the node's.
    const ofType = (p: AiProvider) => !typed || p.type === typed;
    for (const [p] of ordered) if (ofType(p)) push(p, 'call-model');
    for (const p of providers.owner) if (ofType(p) && serves(p, capability)) push(p, 'call-model');
    if (!out.length || typed) for (const p of providers.node) if (ofType(p) && serves(p, capability)) push(p, 'call-model');
    // Then the same model at another type, as the catalogue matches it (catalog/equivalence.ts): the
    // only fallback a named model has (plan 11, section 6).
    if (out.length && typed) {
      for (const m of equivalentModels(typed, parseModelRef(input.requested).id)) {
        for (const p of all) if (p.type === m.type && serves(p, capability)) push(p, 'call-model', `${m.type}:${m.id}`);
      }
    }
    if (!out.length && typed) {
      throw new AiCompletionError('AI_PROVIDER_NOT_CONFIGURED', 400,
        `The model "${input.requested}" names a provider you have not set up: you have no ${typed} provider. `
        + `Add one, or name a model of a provider you have (${all.map(p => `${p.id} (${p.type})`).join(', ') || 'none yet'}).`,
        { model: input.requested, provider: typed, next: { description: 'List your AI providers', method: 'GET', url: '/v1/ai/providers' } });
    }
    return { list: out, chosenBy: 'call-model', ownerListed: true };
  }

  for (const [p, by] of ordered) push(p, by);
  if (!ownerListed) {
    for (const p of providers.node) if (serves(p, capability) && modelOf(p, capability, input)) push(p, 'node-default');
  }
  return { list: out, chosenBy: out[0]?.[1] ?? 'node-default', ownerListed };
}

/** Plan the call: the candidates in order and every rejection with its reason. */
export async function planRoute(input: RoutePlanInput): Promise<RoutePlan> {
  const { storage, config, gaii, capability, rules } = input;
  const { list, chosenBy, ownerListed } = rawOrder(input);
  const allowFallback = rules.fallback && input.fallback !== false && chosenBy !== 'call-provider';
  const wanted = allowFallback ? rules.maxAttempts : 1;
  const candidates: AiCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const reject = (p: AiProvider, reason: RejectReason, message: string, extra: Partial<RejectedCandidate> = {}) =>
    rejected.push({ provider: p.id, reason, message, ...extra });
  let allowance: { remainingUsd: number } | null = null;
  const deferred: Array<{ candidate: AiCandidate; message: string }> = [];

  for (const [p, by, sameModelRef] of list) {
    if (candidates.length >= wanted) break;
    const requested = sameModelRef ?? input.requested;
    if (p.problem) { reject(p, 'problem', p.problem); continue; }
    if (!typeAllowed(config, p.type)) { reject(p, 'type-not-allowed', `This node does not allow ${p.type} providers.`); continue; }
    if (!serves(p, capability)) { reject(p, 'capability-off', `${p.title} does not serve ${capability}.`); continue; }
    if (input.requires?.local && p.leaves) { reject(p, 'requires-local', `${p.title} is not on this machine.`); continue; }
    if (!isFixedType(p.type) && config.aiProviderAllowlist.length && !config.aiProviderAllowlist.includes(new URL(p.baseUrl).hostname.toLowerCase())) {
      reject(p, 'host-not-allowed', `AI provider host "${new URL(p.baseUrl).hostname}" is not in this node's allowlist. Ask the operator to allow it.`);
      continue;
    }

    // ── the model, under the owner's policy ──
    const fallbackModel = requested ? undefined : modelOf(p, capability, input);
    if (!requested && !fallbackModel) {
      reject(p, 'no-model', `${p.title} has no model set for ${capability}.`);
      continue;
    }
    let chosen: { model: string; policyChoseModel: boolean } | null;
    try {
      chosen = chooseModel(input.policy, { ...input.policyCtx, providerType: p.type }, requested, fallbackModel);
    } catch (e) {
      // A model the CALLER named and the policy refuses is the answer to the call, not a reason to
      // try the next provider: the caller asked for that model. The same model under another type's
      // name is only a fallback, so its refusal is a rejection like any other.
      if (input.requested && !sameModelRef && e instanceof AiCompletionError && e.code === 'AI_MODEL_NOT_ALLOWED') throw e;
      if (e instanceof AiCompletionError) { reject(p, 'policy', e.message, { error: e }); continue; }
      throw e;
    }
    if (!chosen) { reject(p, 'no-model', `${p.title} has no model set for ${capability}.`); continue; }
    // A named model falls back only to the same model: every candidate after the first carries it,
    // by the catalogue's key for one model across types (catalog/equivalence.ts).
    if (input.requested && candidates.length && canonicalModelKey(chosen.model) !== canonicalModelKey(candidates[0].model)) continue;

    // ── the price ceiling (the owner's rule), from the catalogue; an unpriced model passes ──
    if (rules.maxCostPerCallUsd !== null) {
      const est = estimateCallUsd(p.type, chosen.model, capability, input.estimate);
      if (est !== undefined && est > rules.maxCostPerCallUsd) {
        reject(p, 'too-costly', `${p.title}'s ${chosen.model} would cost about $${est.toFixed(4)} for this call, over your ceiling of $${rules.maxCostPerCallUsd}.`);
        continue;
      }
    }

    // ── the key that pays ──
    let key: string | undefined;
    let keyScope: AiCandidate['keyScope'] = 'own';
    let allowanceRemainingUsd: number | undefined;
    let degradedToFree = false;
    let model = chosen.model;
    const agentKey = input.agent ? await readAgentProviderKey(storage, config, gaii, input.agent, p) : null;
    if (agentKey) { key = agentKey; keyScope = 'agent'; }
    else if (p.auth.type === 'node') {
      key = (config.openrouterInstanceKey ?? '').trim() || undefined;
      keyScope = 'node';
      allowance ??= await input.nodeAllowance();
      allowanceRemainingUsd = allowance.remainingUsd;
      // A spent allowance on the node's key, as prepareAiCall decided it before providers existed:
      // no free model makes a picture or a transcript, so those are refused; a text call that named
      // no model gets the free model when the owner's policy allows it, and is refused otherwise
      // (plan 05, section 4); a text call that named its model runs as named, because the node never
      // re-chooses a model a caller named (ai-completion.ts, 2026-08-16).
      if (allowance.remainingUsd <= 0 && (input.op !== 'text' || !input.requested)) {
        const free = config.modelFreeFallback;
        if (input.op === 'text' && free && freeModelAllowed(input.policy, free, p.type)) {
          model = free; degradedToFree = true;
        } else {
          const message = input.op === 'text' && free
            ? 'Your allowance on this node is used up, and your model policy does not allow the free model. Add your own key or more allowance.'
            : 'Your allowance on this node is used up. Add more, or set your own OpenRouter key in Settings.';
          reject(p, 'allowance-spent', message, { error: new AiCompletionError('QUOTA_EXHAUSTED', 402, message) });
          continue;
        }
      }
    } else if (p.auth.type === 'env') {
      key = (process.env[p.auth.env ?? ''] ?? '').trim() || undefined;
      if (!key && !p.auth.optional) { reject(p, 'no-key', `The operator named ${p.auth.env} as the key for '${p.id}', and it is not set.`); continue; }
      if (key) keyScope = 'node';
    } else if (p.auth.type === 'key') {
      key = (await readOwnerProviderKey(storage, config, gaii, p.id)) ?? undefined;
      if (!key) {
        const nodeHost = p.legacy?.provider === 'openrouter' && p.type !== 'openrouter' && !!(config.openrouterInstanceKey ?? '').trim();
        if (nodeHost) {
          const message = 'This node\'s shared AI key is sent only to OpenRouter. To use another address, add your own API key in your AI settings.';
          reject(p, 'node-key-host', message, { error: new AiCompletionError('NODE_KEY_HOST', 403, message) });
        } else {
          const message = p.type === 'openrouter'
            ? 'No OpenRouter API key configured. Set one in Settings.'
            : `No API key is set for your provider '${p.title}'. Set it on the AI settings page.`;
          reject(p, 'no-key', message, { error: new AiCompletionError('NO_API_KEY', 400, message) });
        }
        continue;
      }
    }

    // ── tested and healthy ──
    const hk = healthKey(nodeScope(p, gaii), p.id, capability);
    if (p.source === 'owner') seedHealth(hk, p.health.byCapability[capability]);
    const nodeChose = by !== 'call-model' && by !== 'call-provider';
    const status = statusOf(hk) ?? p.health.byCapability[capability]?.status ?? 'untested';
    if (rules.onlyTested && nodeChose && p.source === 'owner' && status === 'untested') {
      reject(p, 'untested', `${p.title}'s ${capability} has not been tested. Test it on the AI settings page, or name it in the call.`);
      continue;
    }
    // ── data does not leave this machine on a fallback from a local provider ──
    if (candidates.length && !candidates[0].provider.leaves && p.leaves && !rules.fallbackMayLeaveMachine) {
      reject(p, 'leaves-machine', `${p.title} is outside this machine, and your rules keep a fallback from a local provider on it.`);
      continue;
    }

    const candidate: AiCandidate = {
      provider: p, model, target: providerTarget(p, config, key), keyScope, chosenBy: by,
      policyChoseModel: chosen.policyChoseModel && !degradedToFree,
      ...(allowanceRemainingUsd !== undefined ? { allowanceRemainingUsd } : {}),
      ...(degradedToFree ? { degradedToFree } : {}),
    };
    // A call that names the provider (the owner's own test among them) reaches it whatever its health:
    // the caller asked for that one, and a test is how a refused key is found fixed. Otherwise a
    // failing capability waits behind the working ones.
    const skip = by === 'call-provider' ? null : skipReason(hk);
    if (skip) { deferred.push({ candidate, message: `${p.title}'s ${capability} is skipped: ${skip}.` }); continue; }
    candidates.push(candidate);
  }
  // SKIPPING IS FOR GOING ROUND, never for refusing. The health state exists so that a call moves past
  // a failing provider to one that works; with nothing to move to, skipping would only turn a passing
  // fault into a refusal for five minutes, so the failing one is tried: it is the probe the wait was
  // for. A provider with a refused key fails again and says so, which is the refusal the owner needs.
  if (candidates.length === 0 && deferred.length) candidates.push(...deferred.slice(0, wanted).map(d => d.candidate));
  else for (const d of deferred) reject(d.candidate.provider, 'failing', d.message);
  return { candidates, rejected, chosenBy: candidates[0]?.chosenBy ?? chosenBy, allowFallback, ownerListed };
}

/**
 * The refusal when no candidate is left. The first rejected candidate is the one the owner meant,
 * so its reason is the answer; the refusals the node gave before providers existed keep their code
 * and wording, so no caller and no test sees a change for the same situation.
 */
export function refusalFor(plan: RoutePlan, op: AiOp, capability: AiCapability, legacyModel: string | undefined): AiCompletionError {
  const first = plan.rejected[0];
  if (!first) {
    // Nothing set up at all: the node has no provider for this and the owner has none either.
    if (UNSET_MODEL[op] && !legacyModel) return new AiCompletionError(UNSET_MODEL[op]!.code, 400, UNSET_MODEL[op]!.message);
    return new AiCompletionError('NO_API_KEY', 400, 'No OpenRouter API key configured. Set one in Settings.');
  }
  if (first.reason === 'no-model' && UNSET_MODEL[op]) return new AiCompletionError(UNSET_MODEL[op]!.code, 400, UNSET_MODEL[op]!.message);
  if (first.error) return first.error;
  if (first.reason === 'host-not-allowed') return new AiCompletionError('PROVIDER_NOT_ALLOWED', 403, first.message);
  if (first.reason === 'type-not-allowed') return new AiCompletionError('AI_PROVIDER_TYPE_NOT_ALLOWED', 403, first.message);
  return new AiCompletionError('AI_CAPABILITY_UNAVAILABLE', 400,
    `No provider can answer this ${capability} call now. ${plan.rejected.map(r => r.message).join(' ')}`,
    {
      capability,
      rejected: plan.rejected.map(r => ({ provider: r.provider, reason: r.reason, message: r.message })),
      fix: 'Set up or test a provider for this capability, or name a provider or model in the call.',
      next: { description: 'List your AI providers', method: 'GET', url: '/v1/ai/providers' },
    });
}
