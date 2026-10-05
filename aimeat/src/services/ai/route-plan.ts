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
 *   - a role (services/ai/roles.ts): the role's providers for the capability, in its order, each with
 *     the role's model or its own. Nothing else after them: the owner chose exactly these.
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
 *   v1.7.0 — 2026-10-05 — The node's key asks nodeKeyStanding (ai-allowance.ts): once it may not pay,
 *     a call that names its model is refused like any other, instead of running on the node's key
 *     with no limit but the caller's own budget (secaudit 2026-10, AI-1).
 *   v1.6.0 — 2026-10-02 — A rejected candidate carries the provider's title, so the person's sentence
 *     can name it; the refusal's AI-facing fix is `agentFix`, and `fix` is the person's
 *     (ai-fix-words.ts, added where prepareAiCall refuses).
 *   v1.5.0 — 2026-09-28 — `minContext`: a model the catalogue says reads less than an app's role needs
 *     is passed over (reason 'too-small'), the call side of roles-fit.ts.
 *   v1.4.0 — 2026-09-28 — A role's order (`roleOrder`, chosenBy 'role'): the owner's explicit choice, so
 *     its untested providers are not skipped, as a named provider is not.
 *   v1.3.0 — 2026-09-28 — An extension provider (V6): its target carries the runner of its `ai.<op>`
 *     actions, and the address allowlist does not apply (its manifest's hosts do, in the runner).
 *   v1.2.0 — 2026-09-28 — Capabilities for apps and agents (V5): the app's prefer.* orders the owner's
 *     candidates (byAppPreference, chosenBy 'app-prefer'); an embedding falls back only to the same
 *     model, and speech only when speechVoiceMayChange; files only on a model that reads them, or on
 *     OpenRouter with a PDF engine.
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
import { extensionRunner } from './extension-provider.js';

export type ChosenBy = 'call-model' | 'call-provider' | 'role' | 'app-prefer' | 'agent-default' | 'owner-default' | 'pool' | 'node-default';

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

/** What ai-allowance.ts nodeKeyStanding answers: may the node's key pay one more call, and if not, why. */
export interface NodeKeyAnswer {
  remainingUsd: number;
  mayPay: boolean;
  reason?: string;
  message?: string;
}

export type RejectReason =
  | 'problem' | 'type-not-allowed' | 'capability-off' | 'requires-local' | 'host-not-allowed' | 'no-model'
  | 'policy' | 'no-key' | 'node-key-host' | 'allowance-spent' | 'untested' | 'failing' | 'leaves-machine' | 'too-costly'
  | 'too-small';

export interface RejectedCandidate {
  provider: string;
  /** The provider's name as the owner gave it, for a sentence that names it. */
  title?: string;
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
  /** Whether the node's key may pay for this owner (ai-allowance.ts nodeKeyStanding), read at most once.
   *  The shape is written out here: importing it would close a cycle through ai-completion.ts. */
  nodeAllowance: () => Promise<NodeKeyAnswer>;
  /** What the call will use, for the owner's price ceiling: the prompt's tokens (a quarter of its
   *  length) and the answer's cap. Absent, a text call is estimated at 1024 tokens each way. */
  estimate?: { promptTokens?: number; maxTokens?: number };
  /** The app's order of preference for this capability, from `prefer.<capability>` in its meta:
   *  provider types and model references. It orders the owner's candidates and adds none. */
  appPrefer?: string[];
  /**
   * The call's role's order for this capability (services/ai/roles.ts): the owner's providers, each
   * with the model the role gives it or its own. It replaces the defaults and the pool; nothing else is
   * tried after it, since the owner chose exactly these for the role.
   */
  roleOrder?: Array<{ provider: string; model?: string }>;
  /** The least context an app's role says it needs (`role.<name>.context=`): a model the catalogue
   *  says reads less is passed over. A model the catalogue does not know is not. */
  minContext?: number;
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

  if (input.roleOrder && !input.requested) {
    // A role: its providers in its order, each with the role's model for it (carried like a same-model
    // reference, so the policy judges it and a refusal moves to the next place). A provider the owner
    // no longer has is left out; a list with none left refuses in planRoute.
    for (const e of input.roleOrder) {
      const p = byId.get(e.provider);
      if (p) push(p, 'role', e.model);
    }
    return { list: out, chosenBy: 'role', ownerListed: true };
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
  const list = input.appPrefer?.length ? byAppPreference(out, input.appPrefer) : out;
  return { list, chosenBy: list[0]?.[1] ?? 'node-default', ownerListed };
}

/**
 * The owner's candidates in the app's order of preference (plan 11, section 9): each preferred type
 * or model reference in turn takes the candidates of that type, and every other candidate follows in
 * the owner's order. A preferred model reference is the model that candidate uses. Nothing is added
 * and nothing is left out, so a preference the owner cannot meet never refuses a call.
 */
function byAppPreference(list: RawEntry[], prefer: string[]): RawEntry[] {
  const out: RawEntry[] = [];
  const taken = new Set<string>();
  for (const pref of prefer) {
    const ref = pref.includes(':') ? parseModelRef(pref) : null;
    const type = ref?.type ?? pref;
    for (const [p] of list) {
      if (taken.has(p.id) || p.type !== type) continue;
      taken.add(p.id);
      out.push(ref ? [p, 'app-prefer', pref] : [p, 'app-prefer']);
    }
  }
  for (const entry of list) if (!taken.has(entry[0].id)) out.push(entry);
  return out;
}

/** Plan the call: the candidates in order and every rejection with its reason. */
export async function planRoute(input: RoutePlanInput): Promise<RoutePlan> {
  const { storage, config, gaii, capability, rules } = input;
  const { list, chosenBy, ownerListed } = rawOrder(input);
  // Speech moves to another provider only when the owner allows another voice (plan 11, section 7).
  const allowFallback = rules.fallback && input.fallback !== false && chosenBy !== 'call-provider'
    && (capability !== 'speech' || rules.speechVoiceMayChange);
  const wanted = allowFallback ? rules.maxAttempts : 1;
  const candidates: AiCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const reject = (p: AiProvider, reason: RejectReason, message: string, extra: Partial<RejectedCandidate> = {}) =>
    rejected.push({ provider: p.id, title: p.title, reason, message, ...extra });
  let allowance: NodeKeyAnswer | null = null;
  const deferred: Array<{ candidate: AiCandidate; message: string }> = [];

  for (const [p, by, sameModelRef] of list) {
    if (candidates.length >= wanted) break;
    const requested = sameModelRef ?? input.requested;
    if (p.problem) { reject(p, 'problem', p.problem); continue; }
    if (!typeAllowed(config, p.type)) { reject(p, 'type-not-allowed', `This node does not allow ${p.type} providers.`); continue; }
    if (!serves(p, capability)) { reject(p, 'capability-off', `${p.title} does not serve ${capability}.`); continue; }
    if (input.requires?.local && p.leaves) { reject(p, 'requires-local', `${p.title} is not on this machine.`); continue; }
    // An extension provider has no address: its manifest's hosts meet the allowlist in its runner.
    if (!isFixedType(p.type) && p.type !== 'extension' && config.aiProviderAllowlist.length && !config.aiProviderAllowlist.includes(new URL(p.baseUrl).hostname.toLowerCase())) {
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
    // by the catalogue's key for one model across types (catalog/equivalence.ts). So does an
    // embedding, always: another model's vectors cannot be compared with the first one's (plan 11,
    // section 7).
    if ((input.requested || capability === 'embed') && candidates.length && canonicalModelKey(chosen.model) !== canonicalModelKey(candidates[0].model)) continue;
    // Files: only a model that reads them itself, unless OpenRouter converts the PDF for it with the
    // engine the owner chose (plan 11, section 3b). The node converts nothing. A model the catalogue
    // does not know is given the benefit of the doubt, as the owner turned the capability on.
    if (capability === 'files' && catalogModel(p.type, chosen.model)?.caps.fileIn === false) {
      const parser = p.capabilities.files?.parser;
      if (!(p.type === 'openrouter' && parser && parser !== 'native')) {
        reject(p, 'capability-off', `${p.title}'s ${chosen.model} does not read files itself. Choose a model that does, or for OpenRouter a PDF engine.`);
        continue;
      }
    }

    // ── the context an app's role needs, from the catalogue; a model it does not know passes ──
    if (input.minContext) {
      const context = catalogModel(p.type, chosen.model)?.limits?.context;
      if (context !== undefined && context < input.minContext) {
        reject(p, 'too-small', `${p.title}'s ${chosen.model} reads at most ${context} tokens, and this role needs ${input.minContext}.`);
        continue;
      }
    }

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
      // When the node's key may not pay any more (ai-allowance.ts nodeKeyStanding: a spent allowance
      // in 'refuse' mode, or a daily limit reached in 'limits' mode): a text call that named no
      // model gets the free model when the owner's policy allows it, a call that named the free model
      // runs, and every other call is refused, the ones that name their model included. Until
      // 2026-10-05 a text call that named its model ran as named and kept spending the node's key
      // (secaudit 2026-10, AI-1); not re-choosing a model a caller named is kept, by refusing instead.
      if (!allowance.mayPay) {
        const free = config.modelFreeFallback;
        const freeAllowed = input.op === 'text' && !!free && freeModelAllowed(input.policy, free, p.type);
        if (freeAllowed && !input.requested) {
          model = free; degradedToFree = true;
        } else if (!(freeAllowed && model === free)) {
          const message = input.op === 'text' && free && !input.requested && !freeAllowed
            ? `${allowance.message ?? 'Your allowance on this node is used up.'} Your model policy does not allow the free model either.`
            : (allowance.message ?? 'Your allowance on this node is used up. Add more, or set your own key in your AI settings.');
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
    // A role's providers are the owner's own explicit choice, like a named one.
    const nodeChose = by !== 'call-model' && by !== 'call-provider' && by !== 'role';
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
      provider: p, model, keyScope, chosenBy: by,
      // An extension provider's target carries the runner bound to the owner and the key (V6).
      target: p.type === 'extension'
        ? { ...providerTarget(p, config, key), runExtension: extensionRunner(storage, config, gaii, p, key) }
        : providerTarget(p, config, key),
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
      rejected: plan.rejected.map(r => ({ provider: r.provider, ...(r.title ? { title: r.title } : {}), reason: r.reason, message: r.message })),
      agentFix: 'Set up or test a provider for this capability, or name a provider or model in the call.',
      next: { description: 'List your AI providers', method: 'GET', url: '/v1/ai/providers' },
    });
}
