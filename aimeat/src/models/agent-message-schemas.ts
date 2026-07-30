/**
 * @file agent-message-schemas.ts
 * @description Zod validation schemas for agent message creation and status updates
 * @version-history
 *   Text limits raised — 2026-07-30 — content to 200 000, tool descriptions to 10 000.
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 *   v1.1.0 -- 2026-05-30 -- Add single-select option-prompts: metadata.prompt (agent
 *     attaches a question + option list to an outbound message) and metadata.prompt_answer
 *     (owner's reply correlated back to the question via prompt_id).
 */

import { z } from 'zod';

// An agent-authored single-select question attached to an outbound message.
// The UI renders `options` as clickable chips plus an implicit "Other" (free
// text); do NOT include "Other" in `options`. Because the agent authored the
// list, it can interpret the owner's choice unambiguously.
export const MessagePromptSchema = z.object({
  prompt_id: z.string().min(1).max(128),
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(200)).min(2).max(10),
  allow_other: z.boolean().optional().default(true),
});

// The owner's reply to a MessagePrompt. `choice` is the chosen option text, or
// the free text typed when the owner used "Other". `prompt_id` echoes the
// question so the agent can match answer -> question deterministically.
export const MessagePromptAnswerSchema = z.object({
  prompt_id: z.string().min(1).max(128),
  choice: z.string().min(1).max(10000),
  is_other: z.boolean().optional().default(false),
});

export const AgentMessageCreateSchema = z.object({
  content: z.string().min(1).max(200_000),
  direction: z.enum(['inbound', 'outbound']),
  thread_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
  metadata: z.object({
    tokens_used: z.number().optional(),
    processing_ms: z.number().optional(),
    proposed_task: z.object({
      title: z.string().min(1).max(256),
      description: z.string().max(10_000),
    }).optional(),
    prompt: MessagePromptSchema.optional(),
    prompt_answer: MessagePromptAnswerSchema.optional(),
  }).optional(),
});

export const AgentMessageStatusSchema = z.object({
  status: z.enum(['processing', 'delivered', 'error']),
});
