/**
 * @file provider-model.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Change the model one capability of an owner's own AI provider uses, checked against
 *   everything that decides whether the model can be used, in one place for the route
 *   (PUT /v1/ai/providers/:id/model) and the MCP tool (aimeat_ai_provider_model_set).
 *
 *   WHY NOT THE MEMORY API. The provider record (`ai.providers.<id>`) is under a reserved prefix
 *   (utils/reserved-keys.ts): a caller that could write it could point the owner's key at another
 *   address. This function changes only the model of one capability and writes through
 *   putOwnerAiProvider, so the record's checks (its shape, the provider type, the catalogue, the
 *   health of a changed model) are the ones the settings page goes through.
 *
 *   THE CHECKS, in this order, before anything is written:
 *   1. The operator's lock (ai.models_locked): the operator chooses the model, so a person's choice is
 *      refused (AI_MODELS_LOCKED), as for an agent's own model in routing.ts.
 *   2. The provider is the owner's own and its type serves the capability (NOT_FOUND, INVALID_PROVIDER).
 *   3. The catalogue: a model the catalogue knows and that lacks the capability is refused
 *      (catalogCheck, the same check the page's save makes).
 *   4. The model rules (policy-gate.ts loadPolicyDecision): the operator's list and the owner's
 *      policy, for each kind of caller that uses the provider (the owner, the chat, agents, apps). A
 *      model no caller may use is refused (AI_MODEL_NOT_ALLOWED) with the models that are allowed; a
 *      model some callers may not use is saved with a warning that names them, because those calls
 *      then run on the first allowed model instead.
 *
 *   WHO. The owner in person applies at once. An agent proposes, shows the owner the change (the
 *   current and the new model with their prices), and applies with the confirm token bound to exactly
 *   that change within ten minutes (the pattern of routing.ts and policy-store.ts).
 * @structure ProviderModelInput · ProviderModelActor · ProviderModelResult · modelRulesCheck() ·
 *   providerModelWarnings() · setProviderModel()
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial: the model of one capability, by the owner or by an agent's
 *     confirmed proposal (wish-ai-tarjoajan-malli-valitaan-listasta-ja-vaihdetaan-chatissa).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { AiCompletionError } from './errors.js';
import { providersForOwner, putOwnerAiProvider, catalogCheck, ownerKeyIds } from './provider-store.js';
import { TYPE_CAPABILITIES, providerView, type AiProvider, type ProviderCapabilityConfig } from './providers.js';
import { providerIdOf } from './provider-common.js';
import { modelsLocked } from './node-model-rules.js';
import { loadPolicyDecision } from './policy-gate.js';
import { isAllowed, blockingLayer, parseModelRef, refOf, type CallerClass } from './policy.js';
import { catalogModel } from './catalog/store.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../operator/confirm.js';
import { recordAiSettingsApplied } from './settings-trail.js';
import { isFixedType, type AiCapability } from './types.js';

const ACTION = 'ai_provider_model';
const CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
const CALLERS: readonly CallerClass[] = ['owner', 'chat', 'agent', 'app'];
const NEXT_MODELS = { description: 'The models you may use for this capability', method: 'GET', url: '/v1/ai/models?allowed=true' };

export interface ProviderModelInput {
  provider: string;
  capability: AiCapability;
  model: string;
}

export type ProviderModelActor = { kind: 'owner' } | { kind: 'agent'; principal: string; confirmToken?: string };

interface ModelFacts { model: string | null; name?: string; price?: { in_per_mtok?: number; out_per_mtok?: number }; status?: string }

export type ProviderModelResult =
  | { mode: 'proposal'; provider: string; capability: AiCapability; current: ModelFacts; proposed: ModelFacts; warnings: string[];
      confirm_token: string; expires_in_seconds: number; instructions: string }
  | { mode: 'applied'; provider: Record<string, unknown>; capability: AiCapability; previous: ModelFacts; model: ModelFacts; warnings: string[] };

/** The input as the route and the tool receive it; refuses what it cannot read. */
function readInput(raw: unknown): ProviderModelInput {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const provider = typeof o.provider === 'string' ? providerIdOf(o.provider) : null;
  if (!provider) problems.push('provider: the id of one of your own providers (aimeat_ai_providers, GET /v1/ai/providers).');
  const capability = (typeof o.capability === 'string' ? o.capability : 'text') as AiCapability;
  if (!CAPABILITIES.includes(capability)) problems.push(`capability: one of ${CAPABILITIES.join(', ')}.`);
  const model = typeof o.model === 'string' ? o.model.trim() : '';
  if (!model || model.length > 200) problems.push('model: a model id such as deepseek/deepseek-v4.1-flash, at most 200 characters.');
  if (problems.length) throw new AiCompletionError('INVALID_INPUT', 400, problems.join(' '), { problems });
  return { provider: provider!, capability, model };
}

/** A model with what the catalogue says about it, for the proposal and the answer. */
function factsOf(type: string, model: string | null | undefined): ModelFacts {
  if (!model) return { model: null };
  const m = catalogModel(type, model);
  if (!m) return { model };
  const p = m.price ?? {};
  return {
    model, name: m.name, status: m.status,
    ...(p.inPerMtok !== undefined || p.outPerMtok !== undefined
      ? { price: { ...(p.inPerMtok !== undefined ? { in_per_mtok: p.inPerMtok } : {}), ...(p.outPerMtok !== undefined ? { out_per_mtok: p.outPerMtok } : {}) } }
      : {}),
  };
}

/** The provider as PUT /v1/ai/providers/:id reads it, with one capability's model changed. */
function bodyWith(p: AiProvider, capability: AiCapability, model: string): Record<string, unknown> {
  const caps: Record<string, ProviderCapabilityConfig> = {};
  for (const [c, cfg] of Object.entries(p.capabilities) as [AiCapability, ProviderCapabilityConfig][]) if (cfg) caps[c] = { ...cfg };
  // A capability with a model joins the owner's pool, as the page's save does (use-providers.js saveCap).
  caps[capability] = { ...(caps[capability] ?? {}), enabled: true, model, pool: true } as ProviderCapabilityConfig;
  return {
    title: p.title, type: p.type,
    ...(p.type === 'local' || p.type === 'openai-compatible' ? { baseUrl: p.baseUrl } : {}),
    ...(p.extension ? { extension: p.extension } : {}),
    auth: { type: p.auth.type === 'none' ? 'none' : 'key' },
    capabilities: caps,
  };
}

const CALLER_WORDS: Record<CallerClass, string> = { owner: 'your own calls', chat: 'the chat', agent: 'agents', app: 'apps' };

export interface ModelRulesCheck {
  /** Set when no kind of caller may use the model: why (the first refusing layer) and what is allowed. */
  nobody: { message: string; ref: string; allowed: string[] } | null;
  /** One sentence per kind of caller that may not use it, when some may. */
  warnings: string[];
}

/**
 * The model rules (the operator's list and the owner's policy, policy-gate.ts) for one capability's
 * model, for each kind of caller that uses the provider. setProviderModel refuses `nobody`; the
 * page's save (PUT /v1/ai/providers/:id) shows it as a warning, as it shows the catalogue's.
 */
export async function modelRulesCheck(
  storage: Storage, config: AimeatConfig, ownerGhii: string, type: string, capability: AiCapability, model: string,
): Promise<ModelRulesCheck> {
  const ref = refOf(type, parseModelRef(model).id);
  const blocked: { caller: CallerClass; why: string; allowed: string[] }[] = [];
  for (const caller of CALLERS) {
    let decision;
    try {
      ({ decision } = await loadPolicyDecision(storage, config, ownerGhii, { capability, caller }));
    } catch (e) {
      // Layers with no model in common allow nothing, this model included.
      if (e instanceof AiCompletionError && e.code === 'AI_MODEL_POLICY_EMPTY') { blocked.push({ caller, why: 'the model rules have no model in common', allowed: [] }); continue; }
      throw e;
    }
    if (isAllowed(decision, ref)) continue;
    const layer = blockingLayer(decision, ref);
    blocked.push({ caller, why: layer ? `${layer.layer} rule, ${layer.source}` : 'model policy', allowed: decision.allowed === 'any' ? [] : decision.allowed });
  }
  if (blocked.length === CALLERS.length) {
    return {
      nobody: {
        ref, allowed: blocked[0].allowed,
        message: `capabilities.${capability}.model: ${ref} is not allowed for ${capability} (${blocked[0].why}). Allowed: ${blocked[0].allowed.join(', ') || 'none'}.`,
      },
      warnings: [],
    };
  }
  return {
    nobody: null,
    warnings: blocked.map(b => `capabilities.${capability}.model: ${ref} is not allowed for ${CALLER_WORDS[b.caller]} (${b.why}); those calls use the first allowed model instead.`),
  };
}

/**
 * The model rules' warnings for every enabled capability's model of a saved provider: what the page's
 * save (PUT /v1/ai/providers/:id) adds to the catalogue's warnings. A model nobody may use is a
 * warning there, not a refusal: the page saves a capability's fine-tuning with its model, and a model
 * the owner's policy later left out must not block that save.
 */
export async function providerModelWarnings(storage: Storage, config: AimeatConfig, ownerGhii: string, p: AiProvider): Promise<string[]> {
  if (!isFixedType(p.type)) return [];
  const out: string[] = [];
  for (const [c, cfg] of Object.entries(p.capabilities) as [AiCapability, ProviderCapabilityConfig][]) {
    if (!cfg?.enabled || !cfg.model) continue;
    const r = await modelRulesCheck(storage, config, ownerGhii, p.type, c, cfg.model);
    out.push(...(r.nobody ? [`${r.nobody.message} Calls use the first allowed model instead.`] : r.warnings));
  }
  return out;
}

/**
 * Change the model of one capability of an owner's own provider. The owner applies at once; an
 * agent gets a proposal first and applies it with the confirm token.
 */
export async function setProviderModel(
  storage: Storage, config: AimeatConfig, ownerGhii: string, raw: unknown, actor: ProviderModelActor,
): Promise<ProviderModelResult> {
  const input = readInput(raw);
  if (modelsLocked(config)) {
    throw new AiCompletionError('AI_MODELS_LOCKED', 403,
      'The operator of this node chooses the model, so a provider\'s model cannot be changed. Ask the operator to change it.',
      { next: { description: 'Read the model rules', method: 'GET', url: '/v1/ai/policy' } });
  }
  const { owner } = await providersForOwner(storage, config, ownerGhii);
  const p = owner.find(x => x.id === input.provider);
  if (!p) {
    throw new AiCompletionError('NOT_FOUND', 404, `You have no provider of your own with the id "${input.provider}". The node's own providers take no model from you.`,
      { next: { description: 'List your AI providers', method: 'GET', url: '/v1/ai/providers' } });
  }
  if (!TYPE_CAPABILITIES[p.type].includes(input.capability)) {
    throw new AiCompletionError('INVALID_PROVIDER', 400, `A ${p.type} provider does not serve ${input.capability}. It serves ${TYPE_CAPABILITIES[p.type].join(', ')}.`);
  }
  const model = parseModelRef(input.model).id;
  const body = bodyWith(p, input.capability, model);
  // The catalogue check the save makes, before a proposal is shown: a model that cannot serve the
  // capability is no proposal at all.
  const checked = catalogCheck({ ...p, capabilities: body.capabilities as AiProvider['capabilities'] });
  const ownProblems = checked.problems.filter(s => s.startsWith(`capabilities.${input.capability}.`));
  if (ownProblems.length) throw new AiCompletionError('INVALID_PROVIDER', 400, ownProblems.join(' '), { problems: ownProblems });
  const rules = await modelRulesCheck(storage, config, ownerGhii, p.type, input.capability, model);
  if (rules.nobody) {
    throw new AiCompletionError('AI_MODEL_NOT_ALLOWED', 403, `${rules.nobody.message} Choose one of the allowed models.`,
      { model: rules.nobody.ref, capability: input.capability, allowed: rules.nobody.allowed, next: NEXT_MODELS });
  }
  const warnings = [...checked.warnings.filter(s => s.startsWith(`capabilities.${input.capability}.`)), ...rules.warnings];
  const previous = factsOf(p.type, p.capabilities[input.capability]?.model);
  const next = factsOf(p.type, model);
  const bound = { provider: p.id, capability: input.capability, model };

  if (actor.kind === 'agent') {
    if (!actor.confirmToken) {
      return {
        mode: 'proposal', provider: p.id, capability: input.capability, current: previous, proposed: next, warnings,
        confirm_token: await mintConfirmToken(actor.principal, ACTION, bound),
        expires_in_seconds: 600,
        instructions: 'Show this change to the owner: the current and the new model, with their prices per million tokens. To apply EXACTLY this change, call again with the same provider, capability and model plus confirm_token.',
      };
    }
    try {
      await verifyConfirmToken(actor.confirmToken, actor.principal, ACTION, bound);
    } catch (e) {
      if (e instanceof ConfirmTokenError) throw new AiCompletionError(e.code, 403, e.message);
      throw e;
    }
  }
  const saved = await putOwnerAiProvider(storage, config, ownerGhii, p.id, body);
  // The owner confirmed in the chat, outside the node: the row is the person's record of who applied it.
  await recordAiSettingsApplied(storage, ownerGhii, actor.kind === 'agent' ? actor.principal : null, 'provider model');
  const hasKey = (await ownerKeyIds(storage, ownerGhii)).has(saved.id);
  return { mode: 'applied', provider: providerView(saved, hasKey), capability: input.capability, previous, model: next, warnings };
}
