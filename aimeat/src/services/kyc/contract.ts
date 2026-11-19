/**
 * @file src/services/kyc/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The records of customer due diligence (EU AMLR 2024/1624) that an obliged organism
 *   keeps on this node: the customer card, each change a new version of it; the suspicion report a
 *   compliance officer drafts for the Financial Intelligence Unit (goAML); the organism's KYC settings
 *   (who does the work, who is the officer, the firm's risk rules); and the receipt that stays when a
 *   card is deleted at the end of its retention.
 *
 *   WHY VERSIONS. An authority asks what the firm knew on a given day ("what was the customer's risk
 *   class and PEP status on 3 April, and what was it based on"). Each change of a card is written as a
 *   new version beside the earlier ones, never over them, and a read `as_of` a time answers the version
 *   in force then, with who wrote it and why.
 *
 *   WHY THE NODE OWNS THEM. The records belong to the organism, not to the member who typed them: a
 *   workspace record is owned by its publisher and leaves with that person's account. These are
 *   records of `system@<node>`, as the compliance documents are, under `kyc.org.<organism>.`, so no
 *   member's erasure, no workspace delete and no memory delete reaches them; only the retention purge
 *   does, after AMLR art. 77's five years.
 * @structure CustomerVersion · CustomerHead · KycSettings · SuspicionReport · PurgeReceipt · the zod schemas
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';

const iso = z.string().min(10).max(40);
const text = (max: number) => z.string().trim().max(max);
const country = z.string().trim().min(2).max(56);

export const PEP_STATUSES = ['no', 'yes', 'family', 'close-associate', 'former', 'unknown'] as const;
export const SANCTION_STATUSES = ['not-screened', 'clear', 'possible', 'confirmed'] as const;
export const CUSTOMER_STATUSES = ['open', 'active', 'blocked', 'ended'] as const;
export const IDENTITY_LEVELS = ['none', 'low', 'substantial', 'high'] as const;
export const CHANGE_KINDS = [
  'opened', 'updated', 'identified', 'screened', 'hit-decided', 'rated', 'approved', 'reviewed', 'ended', 'hold-extended', 'reopened',
] as const;

export const BeneficialOwnerSchema = z.object({
  name: text(200).min(1),
  birthDate: z.string().max(10).optional(),
  country: country.optional(),
  /** Ownership share in percent, when ownership is the ground. */
  share: z.number().min(0).max(100).optional(),
  /** Control by other means (AMLR art. 52), in words. */
  control: text(500).optional(),
});
export type BeneficialOwner = z.infer<typeof BeneficialOwnerSchema>;

export const IdentitySchema = z.object({
  level: z.enum(IDENTITY_LEVELS),
  /** How: 'ftn' (Finnish Trust Network bank ID), 'eudiw' (EU wallet), 'document' (seen in person), 'register' (trade register). */
  method: z.enum(['ftn', 'eudiw', 'document', 'register', 'other']),
  issuer: text(200).optional(),
  verifiedAt: iso,
  expiresAt: iso.optional(),
  faceToFace: z.boolean().default(false),
  /** The person's account on this node when they shared their own verification (the identify link). */
  ghii: text(200).optional(),
  /** The document or register extract the verification rests on, in words (number, issuer). */
  evidence: text(500).optional(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const ScreeningHitSchema = z.object({
  source: z.enum(['eu-fsf', 'un']),
  id: text(120),
  kind: z.enum(['person', 'entity']),
  matchedName: text(300),
  listedName: text(300),
  score: z.number().min(0).max(1),
  reasons: z.array(text(120)).max(12),
  programme: text(300),
  /** Who is screened: the customer itself, or a beneficial owner by its index. */
  subject: z.union([z.literal('customer'), z.string().max(12).regex(/^owner:\d{1,3}$/)]),
  verdict: z.enum(['open', 'false-positive', 'confirmed']).default('open'),
  decidedBy: text(200).optional(),
  decidedAt: iso.optional(),
  note: text(1000).optional(),
});
export type ScreeningHit = z.infer<typeof ScreeningHitSchema>;

export const ScreeningSchema = z.object({
  status: z.enum(SANCTION_STATUSES),
  screenedAt: iso.optional(),
  /** The version of each list the screening read (sha256 prefix of its bytes), so the answer can be redone. */
  lists: z.record(z.string().max(INPUT_LIMITS.id), z.string().max(INPUT_LIMITS.id)).default({}),
  hits: z.array(ScreeningHitSchema).max(200).default([]),
});
export type Screening = z.infer<typeof ScreeningSchema>;

export const RiskSchema = z.object({
  level: z.enum(['low', 'medium', 'high', 'prohibited']),
  score: z.number(),
  dueDiligence: z.enum(['simplified', 'standard', 'enhanced']),
  reasons: z.array(z.object({ code: text(80), text: text(300), points: z.number(), ref: text(80) })).max(40),
  needsSeniorApproval: z.boolean(),
  blocking: z.array(text(80)).max(20),
  ratedAt: iso,
  ratedBy: text(200),
  approvedBy: text(200).optional(),
  approvedAt: iso.optional(),
});
export type Risk = z.infer<typeof RiskSchema>;

/** One version of a customer card: the whole card as it stood after one change. */
export const CustomerVersionSchema = z.object({
  id: z.string().max(64).regex(/^[a-z0-9-]{4,64}$/),
  organism: text(80),
  n: z.number().int().min(1),
  at: iso,
  by: text(200),
  change: z.enum(CHANGE_KINDS),
  /** Why, in the writer's words (a review note, the ground of a decision). */
  note: text(2000).optional(),
  kind: z.enum(['person', 'entity']),
  name: text(300).min(1),
  aliases: z.array(text(300)).max(20).default([]),
  birthDate: z.string().max(10).optional(),
  nationality: country.optional(),
  /** Country of residence (person) or registration (entity). */
  country: country.optional(),
  businessId: text(40).optional(),
  contact: text(300).optional(),
  identity: IdentitySchema.nullable().default(null),
  beneficialOwners: z.array(BeneficialOwnerSchema).max(50).default([]),
  ownershipLayers: z.number().int().min(0).max(20).optional(),
  nomineeOrBearerShares: z.boolean().optional(),
  cashIntensive: z.boolean().optional(),
  productRisk: z.enum(['low', 'medium', 'high']).optional(),
  /** What the customer means to do (AMLR art. 20(1)(c)). */
  purpose: text(2000).optional(),
  sourceOfFunds: text(2000).optional(),
  pep: z.enum(PEP_STATUSES).default('unknown'),
  pepDetail: text(1000).optional(),
  screening: ScreeningSchema.default({ status: 'not-screened', lists: {}, hits: [] }),
  risk: RiskSchema.nullable().default(null),
  status: z.enum(CUSTOMER_STATUSES),
  lastReviewedAt: iso.optional(),
  nextReviewAt: iso.nullable().optional(),
  endedAt: iso.optional(),
  /** The day the purge deletes this card: relationship end + 5 years (AMLR art. 77), or later by a hold. */
  retainUntil: iso.optional(),
  holdBasis: text(500).optional(),
});
export type CustomerVersion = z.infer<typeof CustomerVersionSchema>;

/** The fields a person or an agent may set on a card directly; the rest the service derives. */
export const CustomerInputSchema = CustomerVersionSchema.pick({
  kind: true, name: true, aliases: true, birthDate: true, nationality: true, country: true, businessId: true, contact: true,
  beneficialOwners: true, ownershipLayers: true, nomineeOrBearerShares: true, cashIntensive: true, productRisk: true,
  purpose: true, sourceOfFunds: true, pep: true, pepDetail: true,
}).partial();
export type CustomerInput = z.infer<typeof CustomerInputSchema>;

/** The pointer to a card's newest version, with what a list shows without reading the card. */
export const CustomerHeadSchema = z.object({
  id: z.string().max(INPUT_LIMITS.id),
  n: z.number().int().min(1),
  name: z.string().max(300),
  kind: z.enum(['person', 'entity']),
  status: z.enum(CUSTOMER_STATUSES),
  risk: z.enum(['low', 'medium', 'high', 'prohibited']).nullable(),
  sanctions: z.enum(SANCTION_STATUSES),
  pep: z.enum(PEP_STATUSES),
  nextReviewAt: z.string().max(40).nullable(),
  retainUntil: z.string().max(40).nullable(),
  openedAt: z.string().max(40),
  updatedAt: z.string().max(40),
});
export type CustomerHead = z.infer<typeof CustomerHeadSchema>;

export const KycSettingsSchema = z.object({
  /** Members (GHII) who do customer due diligence: read and write cards. */
  staff: z.array(z.string().max(200)).max(200).default([]),
  /** The compliance officer and deputy (AMLR art. 11): they also read and write suspicion reports. */
  officers: z.array(z.string().max(200)).max(10).default([]),
  /** The firm's list of high-risk third countries (ISO2), from the EU list it follows. */
  highRiskCountries: z.array(z.string().max(2).regex(/^[A-Z]{2}$/)).max(100).default([]),
  reviewMonths: z.object({ low: z.number().int().min(1).max(60), medium: z.number().int().min(1).max(60), high: z.number().int().min(1).max(12) })
    .default({ low: 60, medium: 36, high: 12 }),
  updatedAt: z.string().max(40).optional(),
  updatedBy: z.string().max(INPUT_LIMITS.id).optional(),
});
export type KycSettings = z.infer<typeof KycSettingsSchema>;

export const REPORT_STATUSES = ['marked', 'draft', 'submitted', 'not-reported'] as const;

/** A suspicion and its report to the FIU. Only the officers read it (AMLR art. 73: no tipping off). */
export const SuspicionReportSchema = z.object({
  id: z.string().max(64).regex(/^[a-z0-9-]{4,64}$/),
  organism: z.string().max(INPUT_LIMITS.id),
  customerId: z.string().max(64).optional(),
  status: z.enum(REPORT_STATUSES),
  /** What the person who marked it saw, in their words. */
  observation: text(4000),
  markedBy: z.string().max(INPUT_LIMITS.id),
  markedAt: iso,
  /** goAML report type: STR (transaction) or SAR (activity). */
  reportType: z.enum(['STR', 'SAR']).optional(),
  indicators: z.array(text(200)).max(30).default([]),
  transactions: z.array(z.object({ date: z.string().max(10), amount: z.number(), currency: z.string().max(3), description: text(500) })).max(100).default([]),
  narrative: text(20000).optional(),
  decision: text(2000).optional(),
  submittedAt: iso.optional(),
  goamlRef: text(120).optional(),
  updatedAt: iso,
  updatedBy: z.string().max(INPUT_LIMITS.id),
  retainUntil: iso.optional(),
});
export type SuspicionReport = z.infer<typeof SuspicionReportSchema>;

/** What stays when a card is purged: no personal data, only that it existed and why it went. */
export interface PurgeReceipt { id: string; organism: string; openedAt: string; endedAt: string | null; purgedAt: string; versions: number; basis: string }
