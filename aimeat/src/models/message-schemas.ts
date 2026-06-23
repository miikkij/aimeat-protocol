/**
 * @file message-schemas.ts
 * @description Zod validation schemas for human↔human direct messaging — sending a message
 *   (markdown body + optional media attachment descriptors), the interactive-message payload
 *   (a federated AskUserQuestion: the question spec one way, the human's answers the other), and
 *   contact actions.
 * @structure MessageAttachmentInputSchema, InteractivePayloadSchema, MessageSendSchema
 * @usage import { MessageSendSchema } from '../models/message-schemas.js';
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 2: local messaging).
 *   v1.1.0 -- 2026-06-23 -- Interactive messages: InteractivePayloadSchema + `interactive` on send.
 */

import { z } from 'zod';

/**
 * A media attachment descriptor supplied by the sender. The bytes are uploaded out-of-band via the
 * storage system; this only references them. `inline: true` means the body embeds it via cid:{id};
 * `id` is that cid handle. Full duplication / cross-node grant / quota handling is wired in a later
 * layer — here the descriptors are accepted and stored.
 */
export const MessageAttachmentInputSchema = z.object({
  storage_key: z.string().min(1).max(512),
  mime: z.string().min(1).max(128),
  size: z.number().int().nonnegative(),
  kind: z.enum(['image', 'audio', 'video', 'file']),
  name: z.string().max(256).optional(),
  inline: z.boolean().optional().default(false),
  id: z.string().min(1).max(64).optional(),
});

// ── Interactive messages (federated AskUserQuestion) ──

/** One selectable option in an interactive question. */
export const InteractiveOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(500),
});

/** A single structured question (mirrors the AskUserQuestion shape). */
export const InteractiveQuestionSchema = z.object({
  id: z.string().min(1).max(64),
  header: z.string().min(1).max(80),
  prompt: z.string().min(1).max(2000),
  options: z.array(InteractiveOptionSchema).min(1).max(20),
  multiSelect: z.boolean().optional().default(false),
  allowOther: z.boolean().optional().default(true),
  required: z.boolean().optional().default(false),
});

/** The human's answer to one question: chosen option ids + an optional freeform "Other" value. */
export const InteractiveAnswerSchema = z.object({
  selected: z.array(z.string().min(1).max(64)).max(20),
  other: z.string().max(2000).nullish(),
});

/**
 * The optional structured payload on a direct message. `questions` = an agent asks the human; `answers`
 * = the human's reply (machine-readable picks; the body still carries a human-readable summary).
 */
export const InteractivePayloadSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('questions'),
    v: z.number().int().positive().optional().default(1),
    questions: z.array(InteractiveQuestionSchema).min(1).max(20),
    submitLabel: z.string().max(80).optional(),
  }),
  z.object({
    role: z.literal('answers'),
    v: z.number().int().positive().optional().default(1),
    answersFor: z.string().min(1).max(64),
    answers: z.record(z.string().min(1).max(64), InteractiveAnswerSchema),
  }),
]);

export const MessageSendSchema = z.object({
  /** Recipient — a human GHII (owner@node). */
  to: z.string().min(3).max(256),
  /** GFM markdown body. May be empty when sending attachment-only. */
  body: z.string().max(50000).optional().default(''),
  /** Id of a message being replied to (same conversation). */
  reply_to: z.string().uuid().optional(),
  /** Continue a specific thread by id (e.g. an existing subject thread). Omit for the default pair thread. */
  conversation_id: z.string().min(8).max(64).optional(),
  /** Open a NEW subject thread with this title (a fresh conversation id is minted server-side). */
  subject: z.string().min(1).max(200).optional(),
  attachments: z.array(MessageAttachmentInputSchema).max(20).optional(),
  /** Interactive payload — a question set (agent asks) or the human's answers (reply). */
  interactive: InteractivePayloadSchema.optional(),
}).refine(
  d => (d.body?.trim().length ?? 0) > 0 || (d.attachments?.length ?? 0) > 0 || d.interactive != null,
  { message: 'A message must have a body, an attachment, or an interactive payload' },
);

// ── Broadcast / send-to-many ──

/** Send one message to many recipients (an explicit list and/or a Share Group's members). `mode`
 *  'announcement' = non-respondable (read-only); 'broadcast' = each recipient can reply (1:1 thread).
 *  An `interactive` payload makes it a poll fanned out to everyone. */
export const BroadcastSendSchema = z.object({
  to: z.array(z.string().min(3).max(256)).max(500).optional(),
  group_id: z.string().min(1).max(64).optional(),
  mode: z.enum(['broadcast', 'announcement']).optional().default('broadcast'),
  body: z.string().max(50000).optional().default(''),
  attachments: z.array(MessageAttachmentInputSchema).max(20).optional(),
  interactive: InteractivePayloadSchema.optional(),
}).refine(
  d => (d.to?.length ?? 0) > 0 || !!d.group_id,
  { message: 'A broadcast needs recipients (to[] and/or group_id)' },
).refine(
  d => (d.body?.trim().length ?? 0) > 0 || (d.attachments?.length ?? 0) > 0 || d.interactive != null,
  { message: 'A broadcast must have a body, an attachment, or an interactive payload' },
);

export type MessageSendInput = z.infer<typeof MessageSendSchema>;
export type MessageAttachmentInput = z.infer<typeof MessageAttachmentInputSchema>;
export type InteractivePayloadInput = z.infer<typeof InteractivePayloadSchema>;
export type InteractiveQuestionInput = z.infer<typeof InteractiveQuestionSchema>;
export type BroadcastSendInput = z.infer<typeof BroadcastSendSchema>;
