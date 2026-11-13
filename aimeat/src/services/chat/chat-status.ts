/**
 * @file src/services/chat/chat-status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the chat page says about its AI before anybody types: whether the chat can
 *   answer and, when it cannot, why and who can change that; and when it can, which key pays, which
 *   model answers and in which region, with what the person may change here (Jouni, 2026-11-07).
 *
 *   WHY. A node with no chat agent showed "No chat agent is configured on this node. An operator sets
 *   AIMEAT_GOOSE_BIN." to everybody: an English line for a developer, which told a person neither
 *   that the chat is off nor that the operator can turn it on. A person with a working chat could not
 *   see which model answered or where, or change it, without leaving for the AI settings.
 *
 *   ONE PLAN, ASKED ONCE. The payer, the model and the refusal all come from the one prepareAiCall a
 *   chat turn would make (agent `chat`, caller `chat`), so this answer cannot disagree with the turn.
 *
 *   THE STATES:
 *   - `no_agent`: the operator has not set up the chat agent (ai.chat_agent_bin). Only an operator
 *     changes it. `technical` keeps the developer's sentence for whoever reads it.
 *   - `agent_down`: a chat agent is set up and does not start (agent-health.ts starts it to find out,
 *     and a turn whose agent fails marks it). Only an operator changes it; `technical` says why.
 *   - `no_ai`: the chat agent is there and no key may pay for a turn. `fix` is the gate's own sentence
 *     in the person's language; a key of their own, or the operator, changes it.
 *   - `ready`.
 *
 *   WHAT THE PERSON MAY CHANGE HERE, each with the one writer it already has:
 *   - the chat's model: the chat agent's own text model (routing.ts, PUT /v1/ai/routing with agent
 *     `chat`), offered from the models the policy allows the chat, in the region in use. Not while the
 *     operator locks the models (ai.models_locked) or the operator's shared chat key pays.
 *   - the chat's key: the chat agent's own OpenRouter key (agent-ai-keys.ts, PUT /v1/agents/chat/ai-keys),
 *     which pays for the chat and nothing else. Not on the shared chat key, which pays every turn.
 *   - the region: the person's own rule (routing.ts rules.openrouterRegion), which covers all of their
 *     AI on this node, offered only when the operator lets people choose.
 * @structure ChatAiState · ChatAiStatus · chatAiStatus()
 * @usage const s = await chatAiStatus({ storage, config }, gaii, locale);
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (Jouni, 2026-11-07).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { Locale } from '../../i18n.js';
import { prepareAiCall, type AiCallPlan } from '../ai/completion.js';
import { AiCompletionError } from '../ai/errors.js';
import { chatEnabled } from '../chat-session.js';
import { chatUsesSharedKey } from '../goose-env.js';
import { CHAT_AGENT_NAME } from '../chat-agent.js';
import { readRouting } from '../ai/routing.js';
import { agentAiView } from '../agent/ai-keys.js';
import { allowedModelsOf, modelsLocked } from '../ai/node-model-rules.js';
import { regionChoiceFor, regionModelIds, regionModeOf, regionSettingsOf, type OpenRouterRegion } from '../ai/openrouter-region.js';
import { queryModels, MAX_MODEL_ROWS } from '../ai/catalog/query.js';
import { nodeOpenRouterKey } from '../ai/node-openrouter-key.js';
import { parseModelRef } from '../ai/policy.js';
import { chatAgentHealth } from './agent-health.js';
import { logger } from '../../utils/logger.js';

export type ChatAiState = 'ready' | 'no_agent' | 'agent_down' | 'no_ai';

/** The most models the chat offers in its picker: the catalogue's own cap, so no model is cut off by
 *  its place in the alphabet (OpenRouter's whole list is about 450). The picker has a search. */
const MAX_CHOICES = MAX_MODEL_ROWS;

export interface ChatAiStatus {
  state: ChatAiState;
  /** Who pays for the next turn, as GET /v1/chat/status has always answered it. */
  pays: 'node' | 'own' | 'allowance' | null;
  model?: string;
  /** The developer's sentence for a chat that cannot start or cannot pay, kept for whoever reads it. English. */
  technical?: string;
  /** For a chat that cannot pay: the refusal's code, the gate's sentence for a person in their
   *  language when it has one, and where to fix it. */
  fix?: { code: string; message?: string; settings_url?: string };
  ai: {
    /** Which key pays: the chat's own key, the person's own key, the node's key on their allowance,
     *  or the operator's shared chat key. Null when none may pay. */
    key: { source: 'chat' | 'own' | 'node' | 'shared' | null; chat_key_set: boolean; can_set_chat_key: boolean };
    model: {
      current: string | null;
      /** The chat's own model, when the person chose one. */
      chosen: string | null;
      /** The operator chooses the model (ai.models_locked, or the shared chat key). */
      locked: boolean;
      can_choose: boolean;
      /** The models offered in the picker: what the policy allows the chat, in the region in use. */
      choices: Array<{ id: string; name: string }>;
      /** The operator's list for every call (ai.allowed_models), empty when none. */
      operator_allowed: string[];
    };
    /** Where OpenRouter processes the chat's calls; null when the chat does not run on OpenRouter. */
    region: {
      current: OpenRouterRegion;
      choices: OpenRouterRegion[];
      can_choose: boolean;
      /** Only the EU is allowed (the operator's regions, or the eu-only mode). */
      eu_only: boolean;
      /** The person's region rule covers all of their AI on this node, not only the chat. */
      applies_to: 'all';
    } | null;
  };
}

const TECHNICAL_NO_AGENT = 'No chat agent is configured on this node. An operator sets AIMEAT_GOOSE_BIN.';

/** The chat's AI, as the chat page and an AI read it before a turn. */
export async function chatAiStatus(
  deps: { storage: Storage; config: AimeatConfig }, gaii: string, locale: Locale,
): Promise<ChatAiStatus> {
  const { storage, config } = deps;
  const enabled = chatEnabled(config);
  const shared = chatUsesSharedKey(config);
  const locked = modelsLocked(config);
  const [routing, keys] = await Promise.all([
    readRouting(storage, gaii, CHAT_AGENT_NAME),
    agentAiView(storage, gaii, CHAT_AGENT_NAME),
  ]);

  let plan: AiCallPlan | null = null;
  let fix: ChatAiStatus['fix'];
  let refusal: string | undefined;
  if (!shared) {
    try {
      plan = await prepareAiCall(storage, config, gaii, {
        appId: 'llm-proxy', agent: CHAT_AGENT_NAME, caller: 'chat', lang: { chosen: locale },
      });
    } catch (err) {
      if (!(err instanceof AiCompletionError)) throw err;
      const details = (err.details ?? {}) as { fix?: unknown; settingsUrl?: unknown };
      // The gate's own sentence for a person, when it has one in their language; its message is
      // written for a developer, so it goes to `technical` and the page says it in its own words.
      fix = {
        code: err.code,
        ...(typeof details.fix === 'string' && details.fix ? { message: details.fix } : {}),
        ...(typeof details.settingsUrl === 'string' ? { settings_url: details.settingsUrl } : {}),
      };
      refusal = `${err.code}: ${err.message}`;
      logger.info(`[chat] no payer for ${gaii}'s chat: ${err.message}`);
    }
  }

  // The agent really starts (agent-health.ts): a path that is set but names no working agent is out of use.
  const health = enabled ? await chatAgentHealth(config) : null;
  const agentDown = !!health && !health.ok;
  const state: ChatAiState = !enabled ? 'no_agent' : agentDown ? 'agent_down' : (!shared && !plan) ? 'no_ai' : 'ready';
  const pays: ChatAiStatus['pays'] = shared ? 'node' : plan ? (plan.keyScope === 'node' ? 'allowance' : 'own') : null;
  const current = shared ? (config.gooseModel || null) : plan?.model ?? null;
  const source: ChatAiStatus['ai']['key']['source'] = shared ? 'shared'
    : plan ? ({ agent: 'chat', own: 'own', node: 'node' } as const)[plan.keyScope] : null;

  // The region: for a chat whose calls go to OpenRouter, and for one that cannot pay while the node
  // has an OpenRouter key of its own, where the region may be what refuses the call.
  const scope: 'agent' | 'own' | 'node' | null = shared ? null
    : plan ? (plan.providerType === 'openrouter' ? plan.keyScope : null)
      : (nodeOpenRouterKey(config) ? 'node' : null);
  let region: ChatAiStatus['ai']['region'] = null;
  if (scope) {
    const choice = regionChoiceFor(config, routing.owner.rules, scope);
    const personMay = scope !== 'node' || regionSettingsOf(config).personChoice;
    region = {
      current: choice.region,
      choices: choice.allowed,
      can_choose: personMay && choice.allowed.length > 1,
      eu_only: regionModeOf(config) === 'eu-only' || (scope === 'node' && choice.allowed.length === 1 && choice.allowed[0] === 'eu'),
      applies_to: 'all',
    };
  }

  const canChoose = enabled && !agentDown && !shared && !locked;
  const choices = canChoose && plan ? await modelChoices(deps, gaii, plan, region?.current ?? 'any') : [];

  return {
    state, pays, ...(current ? { model: current } : {}),
    ...(state === 'no_agent' ? { technical: TECHNICAL_NO_AGENT }
      : state === 'agent_down' && health && !health.ok ? { technical: `The chat agent did not start: ${health.error}` }
        : state === 'no_ai' && refusal ? { technical: refusal } : {}),
    ...(state === 'no_ai' && fix ? { fix } : {}),
    ai: {
      key: { source, chat_key_set: keys.openrouter.has_key, can_set_chat_key: enabled && !agentDown && !shared },
      model: {
        current, chosen: routing.agentModel ?? null, locked: locked || shared, can_choose: canChoose, choices,
        operator_allowed: allowedModelsOf(config),
      },
      region,
    },
  };
}

/**
 * The models the chat may pick: the catalogue's text models the chat's policy allows on a provider
 * the person reaches, of the type that answers the chat now, and in the region in use when that is
 * not "any". A region list that cannot be read leaves the list unfiltered, as a call would go there
 * and OpenRouter would refuse rather than leave the region.
 */
async function modelChoices(
  deps: { storage: Storage; config: AimeatConfig }, gaii: string, plan: AiCallPlan, region: OpenRouterRegion,
): Promise<Array<{ id: string; name: string }>> {
  try {
    const answer = await queryModels(deps.storage, deps.config, { payer: gaii, caller: 'chat', agent: CHAT_AGENT_NAME }, {
      capability: 'text', type: plan.providerType, allowed: true,
    });
    let rows = (answer.models as Array<{ id: string; name?: string }>).map(m => ({ id: m.id, name: m.name || m.id }));
    if (plan.providerType === 'openrouter' && region !== 'any') {
      const inRegion = await regionModelIds(deps.config, region);
      if (inRegion) rows = rows.filter(m => inRegion.has(m.id));
    }
    // The operator's allowed models of this provider type are the choice set they named, so each one
    // is offered even when the catalogue does not list it; the model in use stays pickable too.
    const named = allowedModelsOf(deps.config).map(parseModelRef).filter(p => p.type === plan.providerType).map(p => p.id);
    for (const id of [...named, ...(plan.model ? [plan.model] : [])]) {
      if (!rows.some(m => m.id === id)) rows.push({ id, name: id });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_CHOICES);
  } catch (err) {
    if (!(err instanceof AiCompletionError)) throw err;
    logger.info(`[chat] no model choices for ${gaii}'s chat: ${err.message}`);
    return plan.model ? [{ id: plan.model, name: plan.model }] : [];
  }
}
