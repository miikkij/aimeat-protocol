/**
 * @file policy-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model policy applied to one call, for prepareAiCall (services/ai-completion.ts):
 *   load the layers, refuse when they leave nothing, and choose the model (docs/internal/
 *   llmproviderintegrations/05, section 4).
 *
 *   - The caller NAMED a model the policy does not allow: 403 AI_MODEL_NOT_ALLOWED, naming the
 *     layer that refused and the models that are allowed. Swapping the model quietly would be wrong:
 *     the caller asked for that one, and an AI reading the refusal can correct its call at once.
 *   - The owner's own choice (a role) is not allowed, or nobody chose: the node takes the first
 *     allowed model the owner's provider reaches, and the answer says so (`policyChoseModel`).
 *   - The layers have no model in common: 403 AI_MODEL_POLICY_EMPTY, naming both lists. That
 *     conflict is a person's to resolve, not the node's.
 * @structure
 *   - PolicyCallContext — who is calling, for what, on which provider
 *   - loadPolicyDecision() — the decision for one call, refusing an empty intersection
 *   - chooseModel() — the model under that decision
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V2 of the System 2 plan).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AiAdapterType, AiCapability } from './types.js';
import { AiCompletionError } from './errors.js';
import {
  effectivePolicy, isAllowed, blockingLayer, firstAllowed, parseModelRef, refOf,
  type CallerClass, type PolicyDecision, type RecommendedModels,
} from './policy.js';
import { readOwnerAiPolicy, appModelsOf, recommendedModelsOf } from './policy-store.js';

export interface PolicyCallContext {
  capability: AiCapability;
  caller: CallerClass;
  agent?: string;
  /** The app the node identified from an app grant. */
  verifiedApp?: string;
  /** The app the caller says it is. Binds that app's OWN list only (05, section 7). */
  appId?: string;
  /** The type of the owner's provider: every reference the call makes resolves against it in V2. */
  providerType: AiAdapterType;
}

export interface LoadedPolicy {
  decision: PolicyDecision;
  recommended: RecommendedModels;
}

/** Where an AI refused by the policy looks next. */
const POLICY_NEXT = { description: 'Read the models your policy allows', method: 'GET', url: '/v1/ai/policy' };

/** The decision for one call. Throws AI_MODEL_POLICY_EMPTY when the layers leave no model at all. */
export async function loadPolicyDecision(
  storage: Storage, config: AimeatConfig, gaii: string, ctx: PolicyCallContext,
): Promise<LoadedPolicy> {
  const recommended = recommendedModelsOf(config);
  const [owner, appModels] = await Promise.all([
    readOwnerAiPolicy(storage, gaii),
    appModelsOf(storage, gaii, ctx.verifiedApp ?? ctx.appId),
  ]);
  const decision = effectivePolicy(recommended, owner, {
    capability: ctx.capability, caller: ctx.caller,
    ...(ctx.agent ? { agent: ctx.agent } : {}),
    ...(ctx.verifiedApp ? { verifiedApp: ctx.verifiedApp } : {}),
    ...(appModels ? { appModels } : {}),
  });
  if (decision.allowed !== 'any' && decision.allowed.length === 0) {
    throw new AiCompletionError('AI_MODEL_POLICY_EMPTY', 403,
      `The model rules for this call have no model in common: ${decision.layers.map(l => `${l.source} allows ${l.allow.join(', ') || 'nothing'}`).join('; ')}. `
      + 'A person has to widen one of them: the owner\'s policy, or the app\'s own list in its aimeat-ai meta.',
      { capability: ctx.capability, layers: decision.layers, next: POLICY_NEXT });
  }
  return { decision, recommended };
}

/** A model id or reference resolved against the owner's provider type; null when it names another. */
function onProvider(value: string, type: AiAdapterType): { id: string; ref: string } | null {
  const p = parseModelRef(value);
  if (p.type && p.type !== type) return null;
  return { id: p.id, ref: refOf(type, p.id) };
}

/**
 * The model this call uses under the policy.
 *
 * `requested` is the model the caller named; `fallback` is what the node would use without a
 * policy (the owner's role, the node's default, or for text the free router). Returns null only when
 * nothing is requested, there is no fallback and the policy names no model either: the caller then
 * refuses as it always has (NO_IMAGE_MODEL, NO_STT_MODEL).
 */
export function chooseModel(
  loaded: LoadedPolicy, ctx: PolicyCallContext, requested: string | undefined, fallback: string | undefined,
): { model: string; policyChoseModel: boolean } | null {
  const { decision, recommended } = loaded;

  if (requested) {
    const own = onProvider(requested, ctx.providerType);
    if (!own) {
      throw new AiCompletionError('AI_PROVIDER_NOT_CONFIGURED', 400,
        `The model "${requested}" names a provider you have not set up; your AI provider is ${ctx.providerType}. `
        + `Name a model of that provider, as ${ctx.providerType}:<model id> or the bare id.`,
        { model: requested, provider: ctx.providerType });
    }
    if (!isAllowed(decision, own.ref)) {
      const layer = blockingLayer(decision, own.ref);
      const allowed = decision.allowed === 'any' ? [] : decision.allowed;
      throw new AiCompletionError('AI_MODEL_NOT_ALLOWED', 403,
        `The model ${own.ref} is not allowed here (${layer ? `${layer.layer} rule, ${layer.source}` : 'model policy'}). `
        + `Allowed for ${ctx.capability}: ${allowed.join(', ')}. Call again with one of them, or without a model to let the node choose.`,
        { model: own.ref, capability: ctx.capability, layer: layer?.layer, source: layer?.source, allowed, next: POLICY_NEXT });
    }
    return { model: own.id, policyChoseModel: false };
  }

  if (fallback) {
    const own = onProvider(fallback, ctx.providerType);
    if (own && isAllowed(decision, own.ref)) return { model: own.id, policyChoseModel: false };
  }
  if (decision.allowed === 'any') {
    return fallback ? { model: onProvider(fallback, ctx.providerType)?.id ?? fallback, policyChoseModel: false } : null;
  }

  const pick = firstAllowed(decision, ctx.capability, recommended, [ctx.providerType]);
  if (pick) return { model: parseModelRef(pick).id, policyChoseModel: true };
  throw new AiCompletionError('AI_MODEL_NOT_ALLOWED', 403,
    `No model your rules allow for ${ctx.capability} is reachable on your ${ctx.providerType} provider. `
    + `Allowed: ${decision.allowed.join(', ')}.`,
    { capability: ctx.capability, allowed: decision.allowed, provider: ctx.providerType, next: POLICY_NEXT });
}

/** Whether the free fallback model may answer under this decision. */
export function freeModelAllowed(loaded: LoadedPolicy, freeModel: string, type: AiAdapterType): boolean {
  const own = onProvider(freeModel, type);
  return !!own && isAllowed(loaded.decision, own.ref);
}
