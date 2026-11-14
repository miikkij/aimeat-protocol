/**
 * @file src/services/compliance/lia-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of three compliance documents beside the records of processing: an app's
 *   balancing tests (`lias`: the legitimate interests assessment of GDPR art. 6(1)(f), one per
 *   register that rests on legitimate interests), an app's trial mark (`trial`) and an organism's
 *   privacy contact (`contact`). Their own file so docs-schemas.ts stays a list of documents.
 *
 *   A BALANCING TEST HAS THREE LAYERS, AND EACH SAYS WHO WROTE IT.
 *     facts     what the node reads from the app (its register, data map, privacy notice, the
 *               node's own safeguards). The node writes them on every save; a caller cannot.
 *     answers   yes or no per question of data/compliance-lia.ts, and `notes`, the reasoning per
 *               section or question. A person or their AI writes them; `answerSources` says which.
 *     outcome   suitable or not, with a summary. Approval (services/compliance/lia-ops.ts) records who
 *               approved (`approvedBy`, `approvedByKind`: the account holder, an agent or an app) and,
 *               when the owner allowed an agent's request, `requestedBy`. `ownerApproves` is the
 *               owner's own choice that only they approve this test.
 *
 *   `approvedOn` keeps who could see the data and which regulated data the app held at approval, so a
 *   later change of either reads as "open again" without a write (lia-need.ts).
 *
 *   A TRIAL MARK IS THE OWNER'S STATEMENT THAT AN APP IS NOT IN USE YET. The node's clock sets its
 *   start and end; the caller sends the number of days.
 * @structure LiaFactsSchema · LiaSchema · TrialSchema · ContactSchema · the inferred types · TRIAL_DEFAULT_DAYS · TRIAL_MAX_DAYS
 * @usage const parsed = LiaSchema.safeParse(item);
 * @version-history
 *   v1.1.0 — 2026-11-14 — approvedByKind and ownerApproves: an agent with compliance:write may approve
 *     a test unless its owner asked to approve it themselves (Jouni, 2026-11-14).
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { LIA_QUESTION_IDS, LIA_SECTION_IDS } from '../../data/compliance-lia.js';

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, dot, dash and underscore');
const text = (max = 2000) => z.string().max(max);
const list = (max = 50) => z.array(z.string().max(300)).max(max);
const iso = z.string().max(40).refine(s => !Number.isNaN(Date.parse(s)), 'an ISO date or time');
const stamp = { updatedAt: z.string().max(INPUT_LIMITS.id).optional(), updatedBy: z.string().max(300).optional() };
const reach = z.enum(['none', 'self', 'shared', 'exposed', 'unknown']);

/** What the node reads from the app for the test. Written by the node, never taken from a caller. */
export const LiaFactsSchema = z.object({
  purposeText: text().optional(),
  legalBasis: z.array(z.string().max(40)).max(6),
  dataCategories: list(),
  /** Personal key families the purpose may not need, each with what in the data map says so. A proposal. */
  minimisation: z.array(z.object({ what: z.string().max(300), why: z.string().max(300) })).max(50),
  domains: z.array(z.string().max(60)).max(20),
  subjects: list(),
  usesAi: z.boolean(),
  aiEvidence: list(20),
  reach,
  privacyNotice: z.boolean(),
  nodeSafeguards: z.array(z.object({ area: z.string().max(60), text: z.string().max(1000) })).max(40),
  /** Sentences about a law that asks more of this data (employment privacy law on employee data). */
  reminders: list(10),
  readAt: iso,
});


/** One balancing test: the legitimate interests assessment of one register. */
export const LiaSchema = z.object({
  id, registerId: z.string().min(1).max(120),
  /** A caller need not send it: a write stores a draft, and approval is its own step (lia-write.ts). */
  status: z.enum(['draft', 'approved']).default('draft'),
  /** The language the node writes its own sentences in and the exports print in. Absent: English. */
  language: z.enum(['en', 'fi', 'es']).optional(),
  facts: LiaFactsSchema.optional(),
  /** Question id → yes or no. A question nobody answered is absent, never "no". */
  answers: z.record(z.string().max(60), z.enum(['yes', 'no'])).optional(),
  /** Section id or question id → the reasoning. */
  notes: z.record(z.string().max(60), text(4000)).optional(),
  outcome: z.object({ result: z.enum(['suitable', 'not-suitable']), summary: text(4000).optional() }).optional(),
  approvedBy: z.string().max(300).optional(),
  /** Who approved: the account holder in person, one of their agents, or one of their apps. */
  approvedByKind: z.enum(['person', 'agent', 'app']).optional(),
  approvedAt: iso.optional(),
  /**
   * True when the owner asked to approve this test themselves: an agent or an app that approves it
   * then asks the owner, who allows it signed in. Only the account holder in person sets or clears it.
   */
  ownerApproves: z.boolean().optional(),
  /** The agent or app that asked the owner to approve, when the owner did not start it in person. */
  requestedBy: z.string().max(300).optional(),
  reviewAt: iso.optional(),
  /** What the test was approved on: who could see the data, and the regulated data the app held. */
  approvedOn: z.object({ reach, domains: z.array(z.string().max(60)).max(20) }).optional(),
  answerSources: z.record(z.string().max(80), z.enum(['human', 'ai', 'evidence', 'proposed'])).optional(),
  ...stamp,
}).superRefine((v, ctx) => {
  for (const k of Object.keys(v.answers ?? {})) {
    if (!LIA_QUESTION_IDS.includes(k)) ctx.addIssue({ code: 'custom', path: ['answers', k], message: `no question "${k}"; the ids are ${LIA_QUESTION_IDS.join(', ')}` });
  }
  for (const k of Object.keys(v.notes ?? {})) {
    if (!LIA_QUESTION_IDS.includes(k) && !LIA_SECTION_IDS.includes(k)) ctx.addIssue({ code: 'custom', path: ['notes', k], message: `no section or question "${k}"; the sections are ${LIA_SECTION_IDS.join(', ')}` });
  }
});

export const TRIAL_DEFAULT_DAYS = 60;
export const TRIAL_MAX_DAYS = 180;

/**
 * An app's trial mark: the owner says the app is tried with a limited group and is not in use yet.
 * `endedAt` set: the owner said it goes into use. Nothing stored: the app never was a trial.
 */
export const TrialSchema = z.object({
  startedAt: iso.optional(),
  expiresAt: iso.optional(),
  days: z.number().int().min(1).max(TRIAL_MAX_DAYS).optional(),
  note: text(500).optional(),
  /** How many times the trial was started again. */
  renewals: z.number().int().min(0).max(1000).optional(),
  /** When the node last asked the owner what happens to an expired trial. */
  askedAt: iso.optional(),
  endedAt: iso.optional(),
  ...stamp,
});

/** An organism's privacy contact: a member who hears when a balancing test of an app shared with it is approved. */
export const ContactSchema = z.object({
  /** The member's account name. */
  privacyContact: z.string().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'an account name').optional(),
  notifyApprovedLia: z.boolean().optional(),
  ...stamp,
});

export type ComplianceLiaFacts = z.infer<typeof LiaFactsSchema>;
export type ComplianceLia = z.infer<typeof LiaSchema>;
export type ComplianceTrial = z.infer<typeof TrialSchema>;
export type ComplianceContact = z.infer<typeof ContactSchema>;
