/**
 * @file message-schemas.ts
 * @description Zod validation schemas for human↔human direct messaging — sending a message
 *   (markdown body + optional media attachment descriptors) and contact actions.
 * @structure MessageAttachmentInputSchema, MessageSendSchema
 * @usage import { MessageSendSchema } from '../models/message-schemas.js';
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation for user-to-user messaging (layer 2: local messaging).
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
}).refine(
  d => (d.body?.trim().length ?? 0) > 0 || (d.attachments?.length ?? 0) > 0,
  { message: 'A message must have a body or at least one attachment' },
);

export type MessageSendInput = z.infer<typeof MessageSendSchema>;
export type MessageAttachmentInput = z.infer<typeof MessageAttachmentInputSchema>;
