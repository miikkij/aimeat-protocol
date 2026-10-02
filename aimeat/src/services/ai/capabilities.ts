/**
 * @file capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What this caller can do with AI on this node, per capability, and what to do about
 *   each one that is off (System 2 plan, docs/internal/llmproviderintegrations/07 section 2 and 13
 *   section 2). The answer of GET /v1/ai/capabilities, aimeat_ai_capabilities and
 *   AIMEAT.ai.capabilities(): the first thing an AI reads before it plans an app or an automation.
 *
 *   THE SAME DECISION A CALL WOULD MAKE. Each capability is planned with prepareAiCall, the gate every
 *   call runs, for this caller (owner, agent or app) and nothing is spent: a capability is `on` when
 *   a call would find a candidate now, and its refusal becomes `reason` and `fix`. A second copy of the
 *   routing rules here would drift from the real one the first time either changed.
 *
 *   REASONS. The plan names six (NO_MODEL, NO_PROVIDER_SUPPORTS, NO_KEY, POLICY_EMPTY,
 *   BUDGET_EXHAUSTED, RETIRED_MODEL). Two more situations are real, so they have their own names
 *   rather than a wrong one of the six: UNTESTED (the owner's rules use only tested providers) and
 *   APP_NOT_ALLOWED (the owner's app allowlist). Anything else is UNAVAILABLE with the refusal's code
 *   beside it. A failing provider is never the reason a capability is off: with nothing else to try,
 *   the routing tries it (route-plan.ts), so the capability is on and a call finds out.
 * @structure CAPABILITY_ORDER · CapabilityState · aiCapabilitiesView()
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 *   v1.0.1 — 2026-09-28 — The embed howTo says embeddings are rare and the person's decision.
 *   v1.1.0 — 2026-09-28 — `roles`: an app's declared AI roles, each bound or not with the fix; the
 *     owner's roles for the owner and their agents (services/ai/roles.ts).
 *   v1.2.0 — 2026-09-29 — content_classifier: the Content Classifier's state and fix (TARGET-082 V3).
 *   v1.3.0 — 2026-10-02 — `own_key` for the owner and their agents: what the owner's own key pays for
 *     on this node and what it never reaches (services/own-key-coverage.ts).
 *   v1.1.1 — 2026-09-28 — The settings read in aiCapabilitiesView's Promise.all is wrapped in an async
 *     function: a storage that threw synchronously left the sibling reads' rejections unhandled.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { AiCompletionError, getDailyBudgetUsd, getTodayUsage, prepareAiCall, type AiCallPlan } from '../ai-completion.js';
import type { AiCapability, AiOp } from './types.js';
import { TYPE_CAPABILITIES, typeAllowed, type AiProvider } from './providers.js';
import { providersForOwner } from './provider-store.js';
import { catalogMeta, catalogModel } from './catalog/store.js';
import { readOwnerAiPolicy, appAiMetaOf } from './policy-store.js';
import type { CallerClass } from './policy.js';
import { readRoles, rolesWithLegacy, bindingKey } from './roles.js';
import { classifierState } from '../classification/classifier-state.js';
import { ownKeyCoverage } from '../own-key-coverage.js';

export const CAPABILITY_ORDER: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];

const OP_OF: Record<AiCapability, AiOp> = {
  text: 'text', vision: 'text', files: 'text', image: 'image', speech: 'speak', transcription: 'transcribe', embed: 'embed',
};

/** One line per capability: how an app or an agent uses it. */
const HOW_TO: Record<AiCapability, string> = {
  text: 'AIMEAT.ai.complete({ app_id, prompt }) · POST /v1/ai/complete · aimeat_ai_job_start for long work',
  vision: 'AIMEAT.ai.complete({ app_id, prompt, images: [dataUrl] }) · POST /v1/ai/complete with images',
  files: 'AIMEAT.ai.complete({ app_id, prompt, files: [{ storage_key }] }) · POST /v1/ai/complete with files; the model reads the file itself',
  image: 'AIMEAT.ai.image({ app_id, prompt }) · POST /v1/ai/image · aimeat_image_generate; tell the person the price first',
  speech: 'AIMEAT.ai.speak({ app_id, input }) · POST /v1/ai/speak (NDJSON audio)',
  transcription: 'AIMEAT.ai.transcribe({ app_id, storage_key }) · POST /v1/ai/transcribe · aimeat_ai_transcribe',
  embed: 'AIMEAT.ai.embed({ app_id, input: [texts] }) · POST /v1/ai/embed · aimeat_ai_embed; rarely, only when the person decides, for a collection far larger than one prompt (skill aimeat-ai-capabilities)',
};

export type CapabilityReason =
  | 'NO_MODEL' | 'NO_PROVIDER_SUPPORTS' | 'NO_KEY' | 'POLICY_EMPTY' | 'BUDGET_EXHAUSTED' | 'RETIRED_MODEL'
  | 'UNTESTED' | 'APP_NOT_ALLOWED' | 'UNAVAILABLE';

export interface CapabilityState {
  on: boolean;
  /** `<type>:<model id>`, when on. */
  model?: string;
  provider?: string;
  providerType?: string;
  /** Whether the data leaves this machine. */
  leaves?: boolean;
  chosenBy?: string;
  /** Which pocket pays: an agent's own key, the owner's, or the node's allowance. */
  keySource?: 'agent' | 'own' | 'node';
  /** How many providers a call could move on to after the first. */
  fallbacks?: number;
  price?: Record<string, number>;
  reason?: CapabilityReason;
  code?: string;
  message?: string;
  fix?: string;
  /** For NO_PROVIDER_SUPPORTS: the provider types that serve this capability on this node. */
  providersThatCan?: string[];
  howTo: string;
}

const KEY_CODES = new Set(['NO_API_KEY', 'NODE_KEY_HOST', 'ENCRYPTION_NOT_CONFIGURED']);
const MODEL_CODES = new Set(['NO_IMAGE_MODEL', 'NO_STT_MODEL', 'NO_TTS_MODEL', 'NO_EMBED_MODEL']);
const BUDGET_CODES = new Set(['QUOTA_EXHAUSTED', 'APP_QUOTA_EXHAUSTED', 'AGENT_QUOTA_EXHAUSTED']);

function reasonOf(e: AiCompletionError): CapabilityReason {
  if (MODEL_CODES.has(e.code)) return 'NO_MODEL';
  if (KEY_CODES.has(e.code)) return 'NO_KEY';
  if (BUDGET_CODES.has(e.code)) return 'BUDGET_EXHAUSTED';
  if (e.code === 'AI_MODEL_POLICY_EMPTY' || e.code === 'AI_MODEL_NOT_ALLOWED') return 'POLICY_EMPTY';
  if (e.code === 'APP_NOT_ALLOWED' || e.code === 'APP_ID_REQUIRED') return 'APP_NOT_ALLOWED';
  if (e.code === 'AI_PROVIDER_TYPE_NOT_ALLOWED') return 'NO_PROVIDER_SUPPORTS';
  if (e.code === 'AI_CAPABILITY_UNAVAILABLE') {
    const reasons = ((e.details as { rejected?: Array<{ reason: string }> } | undefined)?.rejected ?? []).map(r => r.reason);
    if (reasons.length === 0 || reasons.every(r => r === 'capability-off' || r === 'type-not-allowed' || r === 'requires-local')) return 'NO_PROVIDER_SUPPORTS';
    if (reasons.includes('no-model')) return 'NO_MODEL';
    if (reasons.includes('no-key')) return 'NO_KEY';
    if (reasons.includes('policy')) return 'POLICY_EMPTY';
    if (reasons.includes('untested')) return 'UNTESTED';
  }
  return 'UNAVAILABLE';
}

/** What to do, in words an AI can act on or pass to the owner. */
function fixFor(reason: CapabilityReason, cap: AiCapability, providersThatCan: string[]): string {
  switch (reason) {
    case 'NO_MODEL': return `Set a model for ${cap} on one of the owner's AI providers (the owner does it on the AI settings page), or ask the operator for a node default.`;
    case 'NO_PROVIDER_SUPPORTS': return `None of the owner's providers serves ${cap}. The owner adds a provider of type ${providersThatCan.join(', ') || '(none allowed on this node)'} on the AI settings page and turns ${cap} on.`;
    case 'NO_KEY': return 'The provider has no key. The owner sets it on the AI settings page; never ask for a key in chat.';
    case 'POLICY_EMPTY': return `The owner's model policy allows no model for ${cap} here. Propose a change with aimeat_ai_policy_set; the owner confirms it.`;
    case 'BUDGET_EXHAUSTED': return 'Today\'s AI budget is spent. The owner raises it in Settings, or it resets at midnight UTC.';
    case 'RETIRED_MODEL': return `The model is retired. Find another with aimeat_ai_models { capability: "${cap}" } and propose it to the owner.`;
    case 'UNTESTED': return `The owner's rules use only tested providers. Test one: aimeat_ai_provider_test { provider, capability: "${cap}" }.`;
    case 'APP_NOT_ALLOWED': return 'The owner allows AI only for listed apps. The owner adds this app to the list in Settings.';
    default: return 'Read aimeat_ai_providers for why each provider is left out.';
  }
}

/** The provider types that serve a capability on this node, for NO_PROVIDER_SUPPORTS. */
function typesThatCan(config: AimeatConfig, cap: AiCapability): string[] {
  return (Object.keys(TYPE_CAPABILITIES) as Array<keyof typeof TYPE_CAPABILITIES>)
    .filter(t => TYPE_CAPABILITIES[t].includes(cap) && typeAllowed(config, t));
}

/** One capability: the call it would be, planned and never run. */
async function stateOf(
  storage: Storage, config: AimeatConfig, gaii: string, cap: AiCapability, ctx: CapabilityCaller, providers: AiProvider[],
): Promise<CapabilityState> {
  const howTo = HOW_TO[cap];
  // No provider of the owner's or the node's serves it at all: the fix is a provider, whatever
  // refusal code the gate would give (an unset model, a missing key).
  if (!providers.some(p => !p.problem && p.capabilities[cap]?.enabled && TYPE_CAPABILITIES[p.type].includes(cap) && typeAllowed(config, p.type))) {
    const providersThatCan = typesThatCan(config, cap);
    return {
      on: false, reason: 'NO_PROVIDER_SUPPORTS', message: `No provider you can use serves ${cap}.`,
      fix: fixFor('NO_PROVIDER_SUPPORTS', cap, providersThatCan), providersThatCan, howTo,
    };
  }
  let plan: AiCallPlan;
  try {
    plan = await prepareAiCall(storage, config, gaii, {
      op: OP_OF[cap], capability: cap, ...(cap === 'vision' ? { hasImages: true } : {}),
      caller: ctx.caller, ...(ctx.agent ? { agent: ctx.agent } : {}),
      ...(ctx.verifiedApp ? { verifiedApp: ctx.verifiedApp } : {}), ...(ctx.appId ? { appId: ctx.appId } : {}),
    });
  } catch (e) {
    if (!(e instanceof AiCompletionError)) throw e;
    const reason = reasonOf(e);
    const providersThatCan = reason === 'NO_PROVIDER_SUPPORTS' ? typesThatCan(config, cap) : [];
    return {
      on: false, reason, code: e.code, message: e.message, fix: fixFor(reason, cap, providersThatCan),
      ...(providersThatCan.length ? { providersThatCan } : {}), howTo,
    };
  }
  const m = catalogModel(plan.providerType, plan.model);
  const state: CapabilityState = {
    on: true, model: `${plan.providerType}:${plan.model}`, provider: plan.provider, providerType: plan.providerType,
    leaves: plan.candidates[0]?.provider.leaves ?? true, chosenBy: plan.chosenBy, keySource: plan.keyScope,
    fallbacks: Math.max(0, plan.candidates.length - 1),
    ...(m && Object.keys(m.price).length ? { price: Object.fromEntries(Object.entries(m.price).filter(([, v]) => typeof v === 'number')) as Record<string, number> } : {}),
    howTo,
  };
  if (m?.status === 'retired') {
    return { ...state, on: false, reason: 'RETIRED_MODEL', message: `${state.model} is retired: the catalogue's sources no longer list it.`, fix: fixFor('RETIRED_MODEL', cap, []) };
  }
  return state;
}

export interface CapabilityCaller {
  caller: CallerClass;
  agent?: string;
  verifiedApp?: string;
  appId?: string;
}

/**
 * The roles this caller can run as (services/ai/roles.ts). An app sees the roles it declares, each
 * bound or not with the fix, so it can show the owner what to connect instead of failing silently;
 * the owner and their agents see the owner's roles.
 */
async function rolesOf(
  storage: Storage, gaii: string, ctx: CapabilityCaller, prefs: Record<string, unknown>,
  providers: { node: AiProvider[]; owner: AiProvider[] },
): Promise<unknown[] | undefined> {
  const record = await readRoles(storage, gaii);
  const appRef = ctx.verifiedApp ?? ctx.appId;
  const app = appRef ? await appAiMetaOf(storage, gaii, appRef) : undefined;
  if (app?.roles?.length && (ctx.verifiedApp || ctx.caller === 'app' || ctx.appId)) {
    return app.roles.map((r) => {
      const bound = record.bindings[bindingKey(app.address ?? appRef!, r.name)];
      return {
        name: r.name, capabilities: r.capabilities, ...(r.purpose ? { purpose: r.purpose } : {}), bound: !!bound,
        ...(bound ? {} : { fix: `The owner connects the role '${r.name}' to one of their AI roles on the AI page, or you propose it with aimeat_ai_role_set and the owner confirms. Until then a call with role '${r.name}' is refused.` }),
      };
    });
  }
  if (ctx.caller === 'app') return undefined;
  return Object.values(rolesWithLegacy(record, prefs, providers)).map((r) => ({
    id: r.id, title: r.title, ...(r.purpose ? { purpose: r.purpose } : {}),
    capabilities: Object.keys(r.capabilities).filter((c) => r.capabilities[c as AiCapability]?.length),
  }));
}

/** The whole answer for one caller. `gaii` is the payer: the owner, also for an agent's call. */
export async function aiCapabilitiesView(
  storage: Storage, config: AimeatConfig, gaii: string, ctx: CapabilityCaller,
): Promise<Record<string, unknown>> {
  const { node, owner } = await providersForOwner(storage, config, gaii);
  const providers = [...owner, ...node];
  // The storage read inside an async function, so a storage that throws before returning a promise
  // rejects this call rather than leaving a sibling's rejection unhandled (as provider-store.ts does).
  const [states, policy, usage, prefsRecord, ownKey] = await Promise.all([
    Promise.all(CAPABILITY_ORDER.map(cap => stateOf(storage, config, gaii, cap, ctx, providers))),
    readOwnerAiPolicy(storage, gaii),
    getTodayUsage(storage, gaii),
    (async () => storage.getMemory(gaii, 'openrouter.settings'))(),
    // What the owner's own key reaches on this node. Not for an app: whose key pays is the owner's
    // business, and `budget.keySource` already tells an app whether a call would run.
    ctx.caller === 'app' ? Promise.resolve(null) : ownKeyCoverage(storage, config, gaii),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown> | undefined) ?? {};
  const switchOf: Record<CallerClass, keyof typeof policy.appliesTo> = { owner: 'owner', chat: 'chat', agent: 'agents', app: 'apps' };
  const meta = catalogMeta();
  const textState = states[0];
  const roles = await rolesOf(storage, gaii, ctx, prefs, { node, owner });
  // TARGET-082 V3: the Content Classifier runs on the decision model or on `text`, so its state is theirs.
  const contentClassifier = await classifierState(storage, config, gaii, textState);
  return {
    capabilities: Object.fromEntries(CAPABILITY_ORDER.map((cap, i) => [cap, states[i]])),
    content_classifier: contentClassifier,
    ...(roles ? { roles } : {}),
    policy: { mode: policy.mode, appliesToCaller: policy.mode !== 'open' && !!policy.appliesTo[switchOf[ctx.caller]] },
    budget: {
      dailyBudgetUsd: getDailyBudgetUsd(prefs), spentTodayUsd: usage.total_cost_usd,
      ...(textState.keySource ? { keySource: textState.keySource } : {}),
    },
    ...(ownKey ? { own_key: ownKey } : {}),
    catalog: { refreshedAt: meta?.refreshedAt ?? null, snapshot: meta?.snapshot ?? null },
    guide: 'node:aimeat-ai-capabilities',
  };
}
