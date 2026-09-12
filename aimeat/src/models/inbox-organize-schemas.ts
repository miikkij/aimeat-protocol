/**
 * @file inbox-organize-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Zod schemas for how an owner organises their Messages list: archiving and restoring
 *   conversations, the auto-archive setting for their own agents' traffic, folding copies that share a
 *   subject, and the rules that fold, group or archive. One shape for the REST door and the MCP tool,
 *   in the snake_case both speak; services/inbox-organize/ turns it into the stored record.
 * @structure CONVERSATION_ID · InboxRuleInputSchema · InboxOrganizePatchSchema · InboxArchiveSchema
 * @usage import { InboxOrganizePatchSchema } from '../models/inbox-organize-schemas.js';
 * @version-history
 *   v1.0.0 -- 2026-09-13 -- Initial, with the Messages list's sections, rules and archive.
 */

import { z } from 'zod';

/** A conversation id as the list hands it out: a 32-hex pair id, a minted uuid, a group id. */
export const CONVERSATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

/** What a rule looks at. Every condition that is given must hold; `scope` defaults to the account's own agents. */
export const InboxRuleMatchSchema = z.object({
  with: z.string().trim().min(1).max(200).optional()
    .describe('Part of an identity in the thread: the other party, who opened it, to whom, or who wrote last.'),
  subject: z.string().trim().min(1).max(200).optional().describe('Text the thread subject contains.'),
  body: z.string().trim().min(1).max(200).optional().describe('Text the newest message contains.'),
  scope: z.enum(['agents', 'all']).optional()
    .describe('"agents" (default): only threads between the owner and their own agents, or between those agents. "all": every thread.'),
  older_than_days: z.number().int().min(1).max(365).optional().describe('Only threads with no message for this many days.'),
}).strict();

export const InboxRuleInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/).optional().describe('Keep the id of an existing rule to edit it in place.'),
  name: z.string().trim().min(1).max(80).describe('What the rule is called; a "group" rule shows its rows under this name.'),
  enabled: z.boolean().optional(),
  action: z.enum(['fold', 'group', 'archive'])
    .describe('"fold": matching threads become one row. "group": they move under a heading of their own. "archive": they go to the archive.'),
  match: InboxRuleMatchSchema,
}).strict();

export const InboxOrganizePatchSchema = z.object({
  auto_archive: z.object({
    enabled: z.boolean().optional(),
    days: z.number().int().min(1).max(365).optional(),
  }).strict().optional(),
  fold_same_subject: z.boolean().optional(),
  rules: z.array(InboxRuleInputSchema).max(50).optional(),
  add_rule: InboxRuleInputSchema.optional(),
  remove_rule: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
}).strict();

export const InboxArchiveSchema = z.object({
  conversation_ids: z.array(z.string().regex(CONVERSATION_ID)).min(1).max(500),
  restore: z.boolean().optional(),
}).strict();

export type InboxRuleInput = z.infer<typeof InboxRuleInputSchema>;
export type InboxOrganizePatch = z.infer<typeof InboxOrganizePatchSchema>;
