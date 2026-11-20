/**
 * @file src/routes/kyc/bodies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The request bodies of the customer due diligence doors (routes/kyc/routes.ts), each a
 *   bounded schema checked before the service runs: a wrong field answers 400 with that field, and the
 *   services' own schemas (services/kyc/contract.ts) then check what they keep.
 * @structure EmptyBody · NoteBody · CustomerBody · IdentityBody · HitBody · EndBody · HoldBody · SettingsBody ·
 *   MarkBody · SuspicionDraftBody · SubmitBody · CloseBody · RiskAssessmentRecordedBody
 * @version-history
 *   v1.1.1 — 2026-11-20 — SettingsBody and SuspicionDraftBody are patchOf() schemas (utils/zod-patch.ts).
 *   v1.1.0 — 2026-11-19 — RiskAssessmentRecordedBody (POST /v1/kyc/:org/risk-assessment/recorded).
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import { patchOf } from '../../utils/zod-patch.js';
import { CustomerInputSchema, IdentitySchema, KycSettingsSchema, SuspicionReportSchema } from '../../services/kyc/contract.js';

const note = z.string().max(2000).optional();
const date = z.string().max(40);

/** A door that takes no body: anything sent is ignored, but it must be an object. */
export const EmptyBody = z.object({}).passthrough().optional();
export const NoteBody = z.object({ note }).optional();
export const CustomerBody = CustomerInputSchema.extend({ note });
export const IdentityBody = IdentitySchema.extend({ note });
export const HitBody = z.object({
  source: z.enum(['eu-fsf', 'un']),
  hit_id: z.string().min(1).max(120),
  subject: z.string().max(12).optional(),
  verdict: z.enum(['false-positive', 'confirmed']),
  note: z.string().max(1000),
});
export const EndBody = z.object({ note, ended_at: date.optional() }).optional();
export const HoldBody = z.object({ until: date, basis: z.string().min(1).max(500) });
export const SettingsBody = patchOf(KycSettingsSchema.pick({ staff: true, officers: true, highRiskCountries: true, reviewMonths: true }));
export const MarkBody = z.object({ customer_id: z.string().max(64).optional(), observation: z.string().min(1).max(4000) });
export const SuspicionDraftBody = patchOf(SuspicionReportSchema.pick({ reportType: true, indicators: true, transactions: true, narrative: true }));
export const SubmitBody = z.object({ goaml_ref: z.string().min(1).max(120), submitted_at: date.optional(), decision: z.string().max(2000).optional() });
export const CloseBody = z.object({ decision: z.string().min(1).max(2000) });
/** Recording the business-wide risk assessment: where the document is, optionally. */
export const RiskAssessmentRecordedBody = z.object({ ref: z.string().max(500).optional() }).optional();

/** Kept for the readers of the limits: an id is at most this long. */
export const KYC_ID_MAX = INPUT_LIMITS.id;
