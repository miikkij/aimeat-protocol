/**
 * @file src/services/classification/classifier-state.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Content Classifier's line in the AI capabilities answer (TARGET-082 V3, spec §7:
 *   aimeat_ai_capabilities shows its state and the fix when it is off). It is not a model capability
 *   of its own: a jev classifier is the decision model, an llm classifier is the text capability, so
 *   its state is theirs, and no second copy of the routing rules exists here.
 * @structure ClassifierState · classifierState()
 * @usage const cc = await classifierState(storage, config, gaii, textState);
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { policyFor } from './policy.js';

export interface ClassifierState {
  on: boolean;
  type: 'jev' | 'llm';
  provider: string | null;
  aiMode: 'off' | 'suggest' | 'auto';
  dailyPerOwner: number;
  reason?: string;
  fix?: string;
  how: string;
}

/** The classifier's state for the owner `gaii`. `text` is the text capability's own state. */
export async function classifierState(
  storage: Storage, config: AimeatConfig, gaii: string, text: { on: boolean; reason?: string; fix?: string },
): Promise<ClassifierState> {
  const policy = await policyFor(storage, config, gaii);
  const c = policy.classifier;
  const base = {
    type: c.type, provider: c.provider ?? null, aiMode: policy.aiMode, dailyPerOwner: c.dailyPerOwner,
    how: 'aimeat_classification { action: "scan", key } · the node also runs it on write where the policy says (classifier.onWrite)',
  };
  if (config.classificationMode === 'off') {
    return { ...base, on: false, reason: 'CLASSIFICATION_OFF', fix: 'The operator turns classification on (the Classification setting, AIMEAT_CLASSIFICATION).' };
  }
  if (policy.aiMode === 'off') {
    return { ...base, on: false, reason: 'AI_LABELLING_OFF', fix: 'The classification policy lets no AI label content (aiMode off). Detection rules still run.' };
  }
  if (c.type === 'jev' && !config.decideEnabled) {
    return { ...base, on: false, reason: 'DECIDE_DISABLED', fix: 'The operator turns the decision model on, or the policy sets classifier.type to llm.' };
  }
  if (c.type === 'llm' && !text.on) {
    return { ...base, on: false, reason: text.reason ?? 'UNAVAILABLE', ...(text.fix ? { fix: text.fix } : {}) };
  }
  return { ...base, on: true };
}
