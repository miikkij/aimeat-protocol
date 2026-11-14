/**
 * @file src/models/help-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bodies the routes of Ask someone who knows take (routes/help/), checked with
 *   validateBody before the handler runs: types and bounds only. What a value means (a topic that
 *   matches, a member who may take a question, an AI level the operator allows) is decided by the
 *   service (services/help/), which answers with its own refusal codes.
 * @structure HelpProfileBody · HelpFindBody · HelpAskBody · HelpRespondBody · HelpCloseBody · HelpReportWriteBody
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from './input-limits.js';

const word = () => z.string().max(INPUT_LIMITS.id).nullable().optional();
const flag = () => z.boolean().nullable().optional();
const topics = () => z.array(z.string().max(200)).max(60).nullable().optional();
const longText = (max: number) => z.string().max(max).nullable().optional();

/** PUT /v1/help/me: the member's own choices; only the fields given change. */
export const HelpProfileBody = z.looseObject({
  helper: flag(),
  asker: flag(),
  topics: topics(),
  audience: word(),
  cap_per_week: z.number().int().nullable().optional(),
  status: word(),
  status_until: z.string().max(64).nullable().optional(),
  ai_mode: word(),
  auto_topics: topics(),
  ai_may_send: flag(),
  agents_may_ask: flag(),
});

/** POST /v1/help/find: kept answers and the helpers who could answer. */
export const HelpFindBody = z.looseObject({
  question: longText(8000),
  query: longText(2000),
  topics: topics(),
});

/** POST /v1/help/questions: ask. */
export const HelpAskBody = z.looseObject({
  question: z.string().min(1).max(8000),
  subject: longText(300),
  tried: longText(4000),
  topics: topics(),
  people: z.array(z.string().max(INPUT_LIMITS.email)).max(2).nullable().optional(),
  helpers: z.number().int().nullable().optional(),
  to_board: flag(),
  attachments: z.array(z.looseObject({
    storage_key: z.string().max(512),
    mime: z.string().max(128),
    size: z.number().int().nonnegative(),
    kind: z.string().max(16),
    name: z.string().max(256).optional(),
  })).max(10).nullable().optional(),
});

/** POST /v1/help/questions/:id/respond: answer, approve a draft, pass, refer, take, confirm a kept answer. */
export const HelpRespondBody = z.looseObject({
  action: word(),
  answer: longText(16000),
  to: z.string().max(INPUT_LIMITS.email).nullable().optional(),
  keep_allowed: flag(),
});

/** POST /v1/help/questions/:id/close: solved, cancel, extend. */
export const HelpCloseBody = z.looseObject({
  action: word(),
  helper: z.string().max(INPUT_LIMITS.email).nullable().optional(),
  thanks: longText(1000),
  keep: flag(),
  days: z.number().int().nullable().optional(),
});

/** POST /v1/admin/help/reports/:id: the written report, and the operator's decisions on its suggestions. */
export const HelpReportWriteBody = z.looseObject({
  text: longText(40_000),
  suggestions: z.array(z.looseObject({ title: z.string().max(300), why: z.string().max(600).optional() })).max(8).nullable().optional(),
  decisions: z.array(z.looseObject({ n: z.number().int(), decision: z.string().max(16) })).max(8).nullable().optional(),
  dry_run: flag(),
});
