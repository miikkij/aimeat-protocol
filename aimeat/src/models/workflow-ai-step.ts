/**
 * @file src/models/workflow-ai-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workflow `ai` step action: its TypeScript type and its save-time Zod schema.
 *   workflow-schemas.ts puts both into WorkflowStepAction and WorkflowStepActionSchema, and re-exports
 *   nothing new, so every importer of the step types is unchanged.
 * @structure WorkflowAiStepAction · WorkflowAiStepActionSchema
 * @usage imported by models/workflow-schemas.ts
 * @version-history
 *   v1.2.0 — 2026-09-28 — `role`, the AI role the step's call runs as, 1 to 300 characters.
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: `op` (text, image, transcribe), `provider`, `audio_key`
 *     and `language` for a transcription, `size` for an image. The schema refuses at save a field
 *     that does not go with the op, by the rule the background AI job asks (services/ai-jobs/op.ts).
 *   v1.0.0 — 2026-09-28 — Moved unchanged from workflow-schemas.ts, which was at the 800-line limit.
 */
import { z } from 'zod';
import { aiOpRefusal } from '../services/ai-jobs/op.js';

/**
 * Run a prompt on the OWNER'S OWN MODEL, in the node, and write the answer to a key.
 *
 * WHY THIS EXISTS. A step that only turns text into text needed an agent — not because it needed
 * anything an agent has, but because there was no other kind of step. That cost a round trip
 * through a separate repository, a fleet restart and an offer republish for every change to a
 * sentence of prompt. The engine could already reach the owner's model (`completeForOwner`, used
 * by the `llm` signal judge); nothing could produce a DELIVERABLE with it.
 *
 * `prompt_key` points at an owner-namespace memory record holding the prompt, so changing what a
 * step says is a memory write and touches no code, no fleet and no deploy. `prompt` is the inline
 * form for a prompt that is genuinely part of the workflow's definition. Both are templated with
 * the run's vars, so `{ref}` works the way it does everywhere else.
 *
 * `result_to_key` is the deliverable, exactly as it is for an extension step: the engine lands
 * the answer in the owner's namespace and the success_signal gates on it. Declare it or declare
 * your own success_signal — with neither there is nothing to green on but "the model replied".
 *
 * `op` names the kind of model call (services/ai-jobs/op.ts). `text` is the default and the
 * behaviour above. `image` makes one picture from the prompt, stores it in the owner's storage and
 * writes the record `{ storage_key, url, mime_type, model }`. `transcribe` turns the audio file at
 * `audio_key` into text and writes the transcript, or `{ text, language, seconds, model }` with
 * `json`; it has no prompt.
 */
export interface WorkflowAiStepAction {
  kind: 'ai';
  /** Owner-namespace key holding the prompt text. Templated with the run's vars. */
  prompt_key?: string;
  /** The prompt itself, when it belongs to the workflow rather than to a record. */
  prompt?: string;
  /**
   * Owner-namespace keys whose records are read and appended to the prompt, labelled by key.
   * This model has NO TOOLS: the string we send is all it will ever see, so a prompt telling it
   * to read a record is a prompt telling it to invent one. Name here what the step needs.
   */
  input_keys?: string[];
  /** Where the answer lands, in the owner's namespace. Templated; honours keyPrefix. */
  result_to_key?: string;
  /** Parse the answer as JSON before writing it. A malformed answer fails the step. */
  json?: boolean;
  /** Override the owner's default model for this one step. */
  model?: string;
  /**
   * Handed to the provider as given (OpenRouter's unified `reasoning` parameter): `enabled:
   * false` turns a reasoning model's hidden thinking off, `effort` sizes it. Nothing is sent
   * when unset. Exists because a reasoning model behind a token cap spends the cap on thinking
   * and answers with nothing, at HTTP 200, and the only fix is on the request.
   */
  reasoning?: { enabled?: boolean; effort?: 'low' | 'medium' | 'high'; max_tokens?: number; exclude?: boolean };
  /** The kind of model call. Absent means `text`. */
  op?: 'text' | 'image' | 'transcribe';
  /** A provider to use, an id or a type. Naming one turns fallback off (services/ai/route-plan.ts). */
  provider?: string;
  /** The AI role the call runs as: one of the owner's role ids (services/ai/roles.ts). A named model
   *  or provider wins over it. */
  role?: string;
  /** For `transcribe` (required there): the storage key of the audio, in the owner's own storage.
   *  Templated with the run's vars. A storage key, so the run's keyPrefix does not apply. */
  audio_key?: string;
  /** For `transcribe`: an ISO-639-1 hint. */
  language?: string;
  /** For `image`: a provider-specific size, e.g. '1024x1024'. */
  size?: string;
}

// A prompt run on the owner's own model, here on the node. No agent, no fleet, no browser. The
// wording lives in a memory record when `prompt_key` names one, so changing what a step says is a
// memory write rather than a deploy.
export const WorkflowAiStepActionSchema = z.object({
  kind: z.literal('ai'),
  prompt: z.string().max(20000).optional(),
  prompt_key: z.string().max(400).optional(),
  input_keys: z.array(z.string().min(1).max(400)).max(20).optional(),
  result_to_key: z.string().max(400).optional(),
  json: z.boolean().optional(),
  model: z.string().max(200).optional(),
  reasoning: z.object({
    enabled: z.boolean().optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    max_tokens: z.number().int().positive().max(200000).optional(),
    exclude: z.boolean().optional(),
  }).optional(),
  op: z.enum(['text', 'image', 'transcribe']).optional(),
  provider: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(300).optional(),
  audio_key: z.string().min(1).max(400).optional(),
  language: z.string().min(2).max(20).optional(),
  size: z.string().min(1).max(40).optional(),
}).superRefine((action, ctx) => {
  // The rule the background AI job asks at its start, asked here at save, so a step whose fields do
  // not go with its op is refused before any run reaches it.
  const why = aiOpRefusal(action);
  if (why) ctx.addIssue({ code: 'custom', message: why });
});
