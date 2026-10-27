/**
 * @file src/services/classification/external-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether content whose label refuses an outside model may reach a reader or a model
 *   (plan doc-mvlftkh9zmc9, C3.4, decision 10.5): "an AI sees everything, but this content only a
 *   model on this machine". reader.ts asks it in show(), useForAi() and leave(), beside the agent's
 *   clearance.
 *
 *   A READER (show, leave). A person on their own screen is not a model, so a person reads it. Every
 *   AI reader is outside unless it says otherwise in the one place it can: an agent of this node whose
 *   runtime report says `llm: 'local'` (aimeat_agent_runtime_report), meaning its model runs on the
 *   crew's own machine and no prompt leaves it. The node records that claim and cannot check it,
 *   which the compliance report states. An anonymous reader, an ecosystem app, a PAT and an
 *   unattended run are outside. No exception and no app rule opens it: the label is the law's
 *   answer, not the person's preference.
 *
 *   A MODEL (useForAi). Whoever asked, what decides is where the model runs: a model reference whose
 *   provider type is `local` (services/ai/policy.ts: `local:<model id>`) is on this machine; anything
 *   else, or no model named, is outside.
 *
 *   COST. Nothing is read for a label that does not refuse, or for a person. One agent read per
 *   reader, made on the first refusing label and kept, as clearance.ts does.
 * @structure ExternalAiCheck · externalAiFor() · isLocalModelRef() · modelRefuses()
 * @usage
 *   const external = externalAiFor(deps, who);
 *   if (await external.refuses(label)) { … hidden, audited 'refused' … }
 *   if (modelRefuses(label, use.model)) { … the AI call is refused … }
 * @version-history
 *   v1.0.1 — 2026-10-27 — The shared anonymous agent is an outside reader whatever runtime its record
 *     reports (secaudit2026oct26, runtime-source:shared-anonymous-agent-self-report).
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C3.4).
 */
import type { Storage } from '../../storage/interface.js';
import { isValidGAII } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import type { ClassificationLabel } from './defaults.js';
import { refusesExternalAi } from './levels.js';

/** The reserved account of the node's shared anonymous agent (auth/anonymous-principal.ts ANONYMOUS_ACCOUNT). */
const ANONYMOUS_ACCOUNT = 'anonymous';

export interface ExternalAiCheck {
  /** True when content with `label` may not reach this reader, because the reader is a model elsewhere. */
  refuses(label: Pick<ClassificationLabel, 'externalAi'>): Promise<boolean>;
}

/** A model reference that names a provider on this machine (`local:<model id>`). */
export function isLocalModelRef(model: string | undefined | null): boolean {
  return typeof model === 'string' && model.startsWith('local:');
}

/** True when content with `label` may not go into a call to `model`. */
export function modelRefuses(label: Pick<ClassificationLabel, 'externalAi'>, model: string | undefined | null): boolean {
  return refusesExternalAi(label) && !isLocalModelRef(model);
}

/** The check of one reader: a person never refuses; an AI reader unless it reported a local model. */
export function externalAiFor(
  deps: { storage: Pick<Storage, 'getAgent'> },
  who: { kind: string; principal: string },
): ExternalAiCheck {
  if (who.kind === 'human' || who.kind === 'system') return { refuses: async () => false };
  let local: Promise<boolean> | null = null;
  const agentIsLocal = () => (local ??= (who.kind === 'ai' && who.principal && isValidGAII(who.principal)
    ? deps.storage.getAgent(who.principal)
      // The shared anonymous agent (reserved account 'anonymous') is anyone who holds the minted
      // token, so it is an outside reader whatever its record says (secaudit2026oct26,
      // runtime-source:shared-anonymous-agent-self-report).
      .then(a => a?.owner !== ANONYMOUS_ACCOUNT && a?.runtimeSource?.llm === 'local')
      // A failed read must not open what the label closes.
      .catch(err => { logger.warn('classification: the agent\'s runtime could not be read; content that refuses an outside model is held back', { gaii: who.principal, error: String(err) }); return false; })
    : Promise.resolve(false)));
  return {
    async refuses(label) {
      if (!refusesExternalAi(label)) return false;
      return !(await agentIsLocal());
    },
  };
}
