/**
 * @file src/services/ai/node-model-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's model rules for every AI call on the node (Jouni, 2026-11-07): the
 *   models any call may use (ai.allowed_models) and whether the operator alone chooses the model
 *   (ai.models_locked).
 *
 *   WHY. An organisation node in Europe may allow only some models, for instance only models processed
 *   in the EU, and may want one model for everybody. Until now the operator's own list
 *   (ai.recommended_models) bound nobody until an owner chose it, so the operator could not set a rule.
 *
 *   THE ALLOWED LIST is the operator's layer of the model policy (policy.ts effectivePolicy, layer
 *   `node`). It binds every caller (the owner, the chat, agents, apps) and whoever pays, and the other
 *   layers can only narrow it. An empty list limits nobody.
 *
 *   THE LOCK sets aside every model choice a person or a call makes: the owner's role models, the
 *   chat's model (routing.ts, the chat agent's record) and a model the call names. The node then uses
 *   its own default for the role, and with an allowed list the first allowed model the provider
 *   reaches (completion.ts prepareAiCall, route-plan.ts). A person sees the model and cannot change it.
 * @structure parseAllowedModels · allowedModelsOf · modelsLocked
 * @usage
 *   const allow = allowedModelsOf(config);   // [] when the operator set no list
 *   if (modelsLocked(config)) { ... }
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (Jouni, 2026-11-07).
 */
import { isModelRef } from './policy.js';

/** Read the operator's list: `<type>:<model id>` references separated by commas or new lines. */
export function parseAllowedModels(raw: string | undefined): { models: string[]; problems: string[] } {
  const problems: string[] = [];
  const models: string[] = [];
  for (const part of (raw ?? '').split(/[,\n]/)) {
    const ref = part.trim();
    if (!ref) continue;
    if (isModelRef(ref)) models.push(ref);
    else problems.push(`"${ref}" is not a <type>:<model id> reference, for example openrouter:mistralai/mistral-small-2603`);
  }
  if (models.length > 200) problems.push('at most 200 models');
  return { models: [...new Map(models.map(r => [r.toLowerCase(), r])).values()], problems };
}

/** The operator's allowed models. A malformed entry is left out, never fatal. Read on every call: a
 *  split of a short string, so the Config tab's change applies at once with nothing to invalidate. */
export function allowedModelsOf(config: { aiAllowedModels?: string }): string[] {
  return parseAllowedModels(config.aiAllowedModels).models;
}

/** Whether the operator alone chooses the model on this node. */
export function modelsLocked(config: { aiModelsLocked?: boolean }): boolean {
  return config.aiModelsLocked === true;
}
