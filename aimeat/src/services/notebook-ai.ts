/**
 * @file notebook-ai.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared owner-model plumbing for the notebook AI features (classify, plan, triage, the
 *   living author). Resolves the caller's own model from their per-owner settings and runs the
 *   completion through THE chokepoint, `services/ai/completion.ts`, mapping its failures to stable
 *   codes the routes already understand. Extracted from notebook-classify.ts so the classifier and
 *   the planner never drift on key handling.
 *
 *   IT NO LONGER TOUCHES THE KEY. Until Phase 8b this file decrypted the owner's provider key and
 *   called the provider itself, which made every notebook completion a second LLM path: no provenance
 *   record, and — the half that costs money — no entry in the owner's usage ledger. Six features ran
 *   through here, so six features were billed to nobody. `resolveOwnerModel()` now checks that a key
 *   EXISTS (so an expensive prompt is not built for a call that cannot happen) and stops there; the
 *   decryption, the provider-host allowlist, the daily budget, the usage record and the provenance
 *   mint all belong to the one place that owns them.
 * @structure
 *   - NotebookAiError — stable code + HTTP status for the route envelope
 *   - resolveOwnerModel() — the caller's model + an early "is this even possible" check
 *   - completeOwner() — run the completion through the chokepoint, mapping failures to codes
 * @usage const owner = await resolveOwnerModel(storage, config, gaii, 'notebook:classify');
 *        const result = await completeOwner(owner, prompt, SYSTEM, { temperature: 0.2 });
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial: extracted shared key/model resolution + completion wrapper.
 *   v1.1.0 — 2026-07-01 — Vendor-neutral default: replace the hardcoded anthropic/claude-sonnet-4
 *     fallback with OpenRouter's free-models router 'openrouter/free'.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 8b: routed through services/ai/completion.ts. Every
 *     notebook completion now mints provenance and is metered. `OwnerModel` carries the handle the
 *     chokepoint needs (storage, config, gaii) instead of a decrypted key, and takes an `appId` so
 *     each feature's spend is legible in the owner's usage breakdown rather than pooled.
 *   v1.3.0 — 2026-10-13 — The early key check counts a key on one of the owner's providers
 *     (own-key-coverage.ts hasOwnAiKey), not only the legacy openrouter.apikey record. From node 4.0.0
 *     the providers are the only place a key is set, so AI sorting answered NO_OPENROUTER_KEY to every
 *     owner who set one there (the 4.0.0 sweep).
 *   v1.4.0 — 2026-11-04 — A person with no key of their own is asked of prepareAiCall, the question
 *     every other AI call asks, instead of being refused NO_OPENROUTER_KEY: the node's shared key pays
 *     from their allowance as it does for chat. No model is named for such a call, so the plan
 *     chooses it and a spent allowance falls back to the free model. A person with their own key keeps
 *     the model chosen here, as before (codebase analysis 2026-11-03, item A10).
 *   v1.5.0 — 2026-11-08 — resolveOwnerModel takes who asks (`who`, caller-context.ts): an agent or an
 *     outside app is planned and paid as the owner GHII with the agent or the app named, so the
 *     owner's allowance, budget, the agent's cap and the app rules apply, and the owner's own key is
 *     found. The owner in person is the default (secaudit2026nov08 round 14,
 *     aimeat/notebook-ai/payer-is-caller-identity-not-owner).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CompletionOptions } from './openrouter.js';
import { completeForOwner, prepareAiCall, AiCompletionError, type CompleteForOwnerResult } from './ai/completion.js';
import { getEncryptionKey } from './encryption.js';
import { hasOwnAiKey } from './own-key-coverage.js';
import { OWNER_CALLER, type AiCallerContext } from './ai/caller-context.js';
import { nodeAiProviders } from './ai/providers.js';

/** Raised with a stable `code` so routes can map it to the right HTTP status + envelope. */
export class NotebookAiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** A resolved handle for running one owner's completions through the chokepoint. */
export interface OwnerModel {
  storage: Storage;
  config: AimeatConfig;
  /** The owner GHII whose settings, budget and ledger the completion belongs to. */
  gaii: string;
  /** The model this feature will ask for, from the owner's own settings when the owner's own key
   *  pays. Absent when another key pays: the plan chooses, as it does for chat. */
  model?: string;
  /** Per-feature attribution, so the owner's usage breakdown says which feature spent what. */
  appId: string;
  /** Who asks: the owner, or the owner's agent or outside app the call is paid for (caller-context.ts). */
  who?: AiCallerContext;
}

/**
 * Resolve the caller's model from their settings, and fail EARLY if no completion is possible.
 *
 * The early check is the whole reason this function is separate from the completion: every caller
 * builds a large prompt (a whole organism context, a document) before it would otherwise discover
 * there is no key. The chokepoint raises the same `NO_API_KEY` itself — this just raises it before
 * the work.
 */
export async function resolveOwnerModel(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
  appId: string,
  /** Who asks. `gaii` is then the owner GHII that pays (caller-facts.ts payerOfPrincipal), never
   *  the agent's or the app's own identity; the owner's allowance, budget, the agent's cap and the
   *  app rules apply. Absent: the owner in person, as before. */
  who: AiCallerContext = OWNER_CALLER,
): Promise<OwnerModel> {
  const [apiKeyRecord, prefsRecord] = await Promise.all([
    storage.getMemory(gaii, 'openrouter.apikey'),
    storage.getMemory(gaii, 'openrouter.settings'),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as string) || 'openrouter';
  const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
  if (encrypted) {
    // Presence only — the key is never decrypted here. A node with no encryption key configured
    // cannot read it either, and that is a different, operator-facing failure.
    if (!getEncryptionKey(config)) {
      throw new NotebookAiError('ENCRYPTION_NOT_CONFIGURED', 'Encryption key not configured on this node.', 503);
    }
  } else if (provider === 'openrouter' && !(await hasOwnAiKey(storage, gaii))) {
    // No key of the person's own (a key on one of their providers counts: from node 4.0.0 that is the
    // only place a key is set). Another key may still pay: the node's shared key from the person's
    // allowance, an operator's provider. The one place that decides it is asked, as chat asks it
    // (chat-session.ts chatRefusal), and the plan is discarded: the completion plans again.
    // With no provider of the node's, nothing but the person's own key could pay, and the answer is
    // known without planning (as before this check asked the planner).
    if (nodeAiProviders(config).length === 0) throw noKeyError();
    try {
      await prepareAiCall(storage, config, gaii, { appId, ...who });
    } catch (e) {
      throw notebookErrorOf(e);
    }
    // No model is named, so the plan chooses it as it does for chat: the person's setting, the
    // node's default, and the free model when the allowance is spent.
    return { storage, config, gaii, appId, who };
  }
  const model = (prefs.model as string) || (prefs.reasoningModel as string) || (prefs.executionModel as string) || 'openrouter/free';
  return { storage, config, gaii, model, appId, who };
}

/** The refusal for a person no key can pay for. The code is the one clients branch on. */
function noKeyError(message?: string): NotebookAiError {
  return new NotebookAiError('NO_OPENROUTER_KEY',
    message || 'No AI key can pay for this. Add your own key on the AI settings page, or ask the operator to give this node a shared key.', 400);
}

/** A chokepoint refusal as this surface's stable codes: NO_API_KEY keeps its long-standing name. */
function notebookErrorOf(e: unknown): NotebookAiError {
  if (e instanceof AiCompletionError) {
    // The person's own sentence when the chokepoint wrote one (ai/ai-fix-words.ts withPersonFix).
    const fix = (e.details as { fix?: unknown } | undefined)?.fix;
    const message = typeof fix === 'string' && fix ? fix : e.message;
    if (e.code === 'NO_API_KEY') return noKeyError(message);
    return new NotebookAiError(e.code === 'PROVIDER_ERROR' ? 'OPENROUTER_ERROR' : e.code, message, e.status);
  }
  return new NotebookAiError('OPENROUTER_ERROR', (e as Error).message, 502);
}

/**
 * Run the completion through the chokepoint, mapping its failures to the codes the routes understand.
 *
 * `NO_API_KEY` is renamed to this surface's long-standing `NO_OPENROUTER_KEY` so a client that
 * branches on the code keeps working; the two conditions are the same one. The budget refusals
 * (`QUOTA_EXHAUSTED`, `APP_QUOTA_EXHAUSTED`) are NEW here and pass through with their own codes and a
 * 402 — a notebook completion is spend like any other, and silently exempting it from the owner's
 * budget was the bug.
 */
export async function completeOwner(
  owner: OwnerModel,
  prompt: string,
  systemPrompt: string,
  options?: CompletionOptions,
): Promise<CompleteForOwnerResult> {
  try {
    return await completeForOwner(owner.storage, owner.config, owner.gaii, {
      prompt,
      systemPrompt,
      model: owner.model,
      appId: owner.appId,
      // The owner in person by default; an agent or an outside app named when one asked (the
      // librarian routes, secaudit2026nov08 round 14).
      ...(owner.who ?? OWNER_CALLER),
      temperature: options?.temperature,
      topP: options?.top_p,
      maxTokens: options?.max_tokens,
    });
  } catch (e) {
    if (e instanceof AiCompletionError) {
      if (e.code === 'NO_API_KEY') {
        throw new NotebookAiError('NO_OPENROUTER_KEY', e.message, e.status);
      }
      throw new NotebookAiError(e.code === 'PROVIDER_ERROR' ? 'OPENROUTER_ERROR' : e.code, e.message, e.status);
    }
    throw new NotebookAiError('OPENROUTER_ERROR', (e as Error).message, 502);
  }
}
