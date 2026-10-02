/**
 * @file src/services/ai-call-plan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The plan prepareAiCall returns (everything decided before a model is called) and the
 *   two pure readers of it.
 *
 *   PURE EXTRACTION from ai-completion.ts, which passed the 800-line cap when the plan gained the
 *   free router a spent own key is retried on. The type and the two functions are the same; the
 *   completion service imports them and re-exports every name, so no importer changed.
 * @structure AiCallPlan · targetOf · planFor
 * @usage import { prepareAiCall, planFor, type AiCallPlan } from './ai-completion.js';
 * @version-history
 *   v1.0.0 — 2026-10-02 — Extracted from ai-completion.ts, verbatim.
 */
import type { AiAdapterType, AiCapability, AiOp, AiTarget } from './ai/types.js';
import type { RoutingRules } from './ai/routing.js';
import type { AiCandidate, ChosenBy, RejectedCandidate } from './ai/route-plan.js';
import type { AppAiRoleParams } from './app-ai-roles.js';
import type { UsageRecord } from './ai-usage-record.js';

/**
 * Everything decided BEFORE a model is called, for one owner and one call.
 *
 * Which pocket pays, which model answers, whether the allowance has run out and the answer has to
 * come from a free model instead of a refusal: those are one decision, and this is where it is made.
 * `completeForOwner` runs it and then calls the provider itself; the chat proxy runs the same one
 * and then streams the provider's own bytes back. Two call shapes, one set of rules — the alternative
 * was a second implementation of the key choice and the budget, which is how a paywall ends up
 * enforced on one door and not the other.
 */
export interface AiCallPlan {
  prefs: Record<string, unknown>;
  /** The id of the provider the first candidate calls (services/ai/providers.ts). */
  provider: string;
  baseUrl: string;
  /** The decrypted key that will pay. Never logged, never returned to a caller. */
  key: string | undefined;
  keyScope: 'agent' | 'own' | 'node';
  /** The owner's agent that asked, by bare name, so the settle step adds the spend to its cap. */
  agent?: string;
  /** What is left on the node's allowance, when the node is paying. */
  allowanceRemainingUsd?: number;
  /** Today's usage record, read once so the settle step does not read it again. */
  usage: UsageRecord;
  dailyBudgetUsd: number;
  model: string;
  /** True when the allowance was spent and a free model is answering instead of nothing. */
  degradedToFree: boolean;
  /** What this call does. */
  op: AiOp;
  /** Which adapter builds the model for this provider (services/ai/adapters/). */
  providerType: AiAdapterType;
  /** True when the owner's model policy chose the model because the one that would have answered
   *  is not allowed, or nobody chose one (services/ai/policy-gate.ts). */
  policyChoseModel: boolean;
  /** The references this call's policy allows, or 'any'. A model list shown to the caller is
   *  filtered by it, so nobody picks a model the node would then refuse. */
  allowedModels: string[] | 'any';
  /** The first candidate's destination; the plan's own fields mirror it. */
  target: AiTarget;
  /** What the call asks for. */
  capability: AiCapability;
  /** Every provider that may answer, in order, and the ones that may not with their reason. */
  candidates: AiCandidate[];
  rejected: RejectedCandidate[];
  chosenBy: ChosenBy;
  /** Whether a failure may move to the next candidate (the owner's rules and the call's own word). */
  allowFallback: boolean;
  rules: RoutingRules;
  /** The free router a spent own or agent key is retried on once (route-run.ts), when the call may use it. */
  noCreditModel?: string;
  /** The role the call ran as: the owner's role, the app's binding, and the app's fine-tuning for it. */
  role?: { id: string; binding?: string; params?: AppAiRoleParams };
}

/** Where the gateway sends a planned call: the adapter, the address and the key that pays. */
export function targetOf(plan: AiCallPlan): AiTarget {
  return plan.target;
}

/** The plan as the candidate that answered it: its provider, key, model and pocket. */
export function planFor(plan: AiCallPlan, c: AiCandidate): AiCallPlan {
  return {
    ...plan, provider: c.provider.id, providerType: c.provider.type, baseUrl: c.target.baseUrl, key: c.target.key,
    keyScope: c.keyScope, model: c.model, degradedToFree: !!c.degradedToFree, policyChoseModel: c.policyChoseModel,
    target: c.target,
    ...(c.allowanceRemainingUsd !== undefined ? { allowanceRemainingUsd: c.allowanceRemainingUsd } : { allowanceRemainingUsd: undefined }),
  };
}
