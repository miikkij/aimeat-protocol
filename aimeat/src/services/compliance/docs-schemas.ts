/**
 * @file src/services/compliance/docs-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes of the compliance documents beside the AI use-case register (plan
 *   doc-mvlftkh9zmc9): the records of processing (C1), the processors (C4.1), the data subject
 *   requests (C4.3), the personal data breaches (C5.1), the impact assessments (C5.2) and the answers
 *   to the framework question sets (C6). One zod definition per document, which the REST route and
 *   the MCP tool both validate through, so the two cannot come to disagree about a valid document.
 *
 *   EVERY ENTRY SAYS WHERE ITS ANSWERS CAME FROM. `answerSources` maps a field to human, ai or
 *   evidence, as the use-case register does: an auditor's question is which of the three, and a
 *   register whose drafted answers read as considered would answer it wrongly by omission.
 *
 *   THE NODE'S CLOCK STAMPS. updatedAt and updatedBy are set by the write, never taken from the caller.
 * @structure COMPLIANCE_DOC_KINDS · ComplianceDocKind · RegisterSchema · ProcessorSchema · RequestSchema ·
 *   BreachSchema · DpiaSchema · FrameworkAnswersSchema · DOC_SCHEMAS · the inferred types
 * @usage const parsed = DOC_SCHEMAS.registers.safeParse(body);
 * @version-history
 *   v1.5.0 — 2026-11-13 — Three documents from lia-schemas.ts: an app's balancing tests (`lias`), an
 *     app's trial mark (`trial`) and an organism's privacy contact (`contact`); SINGLE_DOC_KINDS names
 *     the kinds that are one object.
 *   v1.4.2 — 2026-11-05 — Moved unchanged from src/services/compliance-docs-schemas.ts to src/services/compliance/docs-schemas.ts (codebase analysis 2026-11-03, item D-h).
 *   v1.4.1 — 2026-11-01 — A review's id takes a colon: it is the finding's id, and a finding about one
 *     organism or one owner names it after a colon, so those findings could not be reviewed (WP9b).
 *   v1.4.0 — 2026-11-01 — The document `intermediation` (Data Governance Act 2022/868): the provider's
 *     notification record and a person's review of each data intermediation finding (plan
 *     doc-mvwxcas3dom3, D7.2, D7.3).
 *   v1.3.0 — 2026-10-28 — An answer's source may be `proposed`: the node read it from the data map's
 *     words and nobody has decided (a register's domain drafted from an app's map).
 *   v1.2.0 — 2026-10-27 — Every string field has a length limit from models/input-limits.ts (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 *   v1.1.0 — 2026-10-24 — A processor's `agreement` (the DPA plan doc-mvmr4i2wdk0p fills it).
 *   v1.0.1 — 2026-10-24 — retentionMonths takes up to 2 400 months: a patient record's 120 years was refused.
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1.1, C4.1, C4.3, C5.1, C5.2, C6).
 */
import { z } from 'zod';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import {
  ContactSchema, LiaSchema, TrialSchema, type ComplianceContact, type ComplianceLia, type ComplianceTrial,
} from './lia-schemas.js';

/** The documents, in the order the surfaces list them. */
export const COMPLIANCE_DOC_KINDS = ['registers', 'processors', 'requests', 'breaches', 'dpias', 'frameworks', 'intermediation', 'lias', 'trial', 'contact'] as const;
export type ComplianceDocKind = typeof COMPLIANCE_DOC_KINDS[number];

/** The kinds that are one object and no list of entries: nothing in them is changed entry by entry. */
export const SINGLE_DOC_KINDS = ['frameworks', 'trial', 'contact'] as const;
export type SingleDocKind = typeof SINGLE_DOC_KINDS[number];
export function isSingleDocKind(kind: ComplianceDocKind): kind is SingleDocKind {
  return (SINGLE_DOC_KINDS as readonly string[]).includes(kind);
}

export function isComplianceDocKind(v: unknown): v is ComplianceDocKind {
  return typeof v === 'string' && (COMPLIANCE_DOC_KINDS as readonly string[]).includes(v);
}

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, dot, dash and underscore');
const text = (max = 2000) => z.string().max(max);
const list = (max = 50) => z.array(z.string().max(300)).max(max);
const iso = z.string().max(40).refine(s => !Number.isNaN(Date.parse(s)), 'an ISO date or time');
/** `proposed`: the node matched the data map's words to it (compliance-app-signals.ts); a person decides. */
const sources = z.record(z.string(), z.enum(['human', 'ai', 'evidence', 'proposed'])).optional();
const stamp = { updatedAt: z.string().max(INPUT_LIMITS.id).optional(), updatedBy: z.string().max(300).optional() };

/** A container a register covers. An app is its filename (the owner is the register's scope). */
const ContainerSchema = z.object({
  kind: z.enum(['organism', 'workspace', 'app']),
  organism_id: z.string().max(200).optional(),
  ws: z.string().max(200).optional(),
  app: z.string().max(200).optional(),
});

/** C1.1: one record of processing (GDPR art. 30). */
export const RegisterSchema = z.object({
  id, title: z.string().min(1).max(300),
  type: z.enum(['personal', 'pseudonymised', 'anonymised', 'none']),
  purpose: z.enum(['customer', 'member', 'employee', 'patient', 'marketing', 'research', 'camera', 'service-operation', 'other']).optional(),
  purposeText: text().optional(),
  role: z.enum(['controller', 'processor', 'joint-controller']).optional(),
  controller: text(500).optional(),
  /** GDPR art. 6(1) a–f. */
  legalBasis: z.array(z.enum(['consent', 'contract', 'legal-obligation', 'vital-interests', 'public-task', 'legitimate-interests'])).max(6).optional(),
  /** GDPR art. 9(2) a–j, when a domain is a special category. */
  specialBasis: z.enum(['explicit-consent', 'employment-law', 'vital-interests', 'non-profit', 'made-public', 'legal-claims', 'public-interest', 'health-care', 'public-health', 'research']).optional(),
  legalBasisText: text().optional(),
  subjects: list().optional(),
  dataCategories: list().optional(),
  domains: z.array(z.string().max(60)).max(20).optional(),
  recipients: list().optional(),
  processors: z.array(z.string().max(120)).max(50).optional(),
  transfers: z.array(z.object({ country: z.string().max(60), basis: z.enum(['adequacy', 'scc', 'dpf', 'bcr', 'derogation', 'none']) })).max(30).optional(),
  /**
   * How long, in months; null or absent while nobody has said. Up to 200 years: a Finnish patient
   * record is kept 120 years from the patient's birth (1 440 months), which a 100-year cap refused.
   */
  retentionMonths: z.number().int().min(0).max(2400).nullable().optional(),
  retentionText: text().optional(),
  security: text().optional(),
  automatedDecisions: z.boolean().optional(),
  source: text(500).optional(),
  containers: z.array(ContainerSchema).max(50).optional(),
  reviewedAt: iso.optional(),
  reviewEveryMonths: z.number().int().min(1).max(60).optional(),
  answerSources: sources,
  ...stamp,
});

/** C4.1: what the operator adds to a processor the node lists itself, or one it does not know. */
export const ProcessorSchema = z.object({
  id, name: z.string().min(1).max(200),
  service: z.enum(['ai', 'email', 'payments', 'storage', 'hosting', 'analytics', 'other']),
  host: z.string().max(300).optional(),
  country: z.string().max(60).optional(),
  dpaSignedAt: iso.optional(),
  /**
   * The data processing agreement with this processor as the agreements document keeps it (plan
   * doc-mvmr4i2wdk0p): which one, its version and where it stands. "review": a signed copy came in
   * and waits for a person to confirm it. dpaSignedAt stays for a contract signed elsewhere.
   */
  agreement: z.object({
    agreementId: z.string().min(1).max(120),
    version: z.union([z.number().int().min(0), z.string().max(40)]).optional(),
    status: z.enum(['draft', 'sent', 'review', 'signed', 'expired', 'ended']),
    signedAt: iso.optional(),
  }).optional(),
  transferBasis: z.enum(['adequacy', 'scc', 'dpf', 'bcr', 'derogation', 'none']).optional(),
  hipaaBaa: z.boolean().optional(),
  itarEligible: z.boolean().optional(),
  notes: text().optional(),
  answerSources: sources,
  ...stamp,
});

/** C4.3: one data subject request (GDPR art. 12 and 15–22). */
export const RequestSchema = z.object({
  id, kind: z.enum(['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection']),
  subject: z.string().min(1).max(300),
  receivedAt: iso,
  /** When it is due: received + one month, unless extended (art. 12(3)). */
  dueAt: iso.optional(),
  extendedTo: iso.optional(),
  extensionReason: text().optional(),
  status: z.enum(['open', 'done', 'refused']),
  closedAt: iso.optional(),
  channel: z.enum(['node', 'email', 'letter', 'other']).optional(),
  /** Written by the node itself (an export or an account erasure it carried out). */
  auto: z.boolean().optional(),
  notes: text().optional(),
  ...stamp,
});

/** C5.1: one personal data breach (GDPR art. 33–34; HIPAA 45 CFR 164.400–414). */
export const BreachSchema = z.object({
  id, title: z.string().min(1).max(300),
  discoveredAt: iso,
  description: text(4000).optional(),
  dataCategories: list().optional(),
  subjectsApprox: z.number().int().min(0).optional(),
  consequences: text().optional(),
  measures: text().optional(),
  regimes: z.array(z.enum(['gdpr', 'hipaa'])).max(2).optional(),
  /** Whether the breach is likely to result in a risk to people (art. 33(1)): no risk, no notice. */
  riskToPeople: z.enum(['none', 'risk', 'high-risk']).optional(),
  authorityNotifiedAt: iso.optional(),
  subjectsNotifiedAt: iso.optional(),
  hhsNotifiedAt: iso.optional(),
  mediaNotifiedAt: iso.optional(),
  notNotifiedReason: text().optional(),
  securityIncidentId: z.string().max(200).optional(),
  status: z.enum(['open', 'closed']),
  ...stamp,
});

/** C5.2: one data protection impact assessment (GDPR art. 35). */
export const DpiaSchema = z.object({
  id, registerId: z.string().max(120),
  description: text(4000).optional(),
  necessity: text(4000).optional(),
  risks: text(4000).optional(),
  measures: text(4000).optional(),
  residualRisk: z.enum(['low', 'medium', 'high']).optional(),
  dpoOpinion: text().optional(),
  /** Art. 36: a high residual risk goes to the supervisory authority before processing. */
  priorConsultation: z.boolean().optional(),
  completedAt: iso.optional(),
  reviewedAt: iso.optional(),
  answerSources: sources,
  ...stamp,
});

/** C6: answers per framework, keyed by framework id and question id. */
export const FrameworkAnswersSchema = z.object({
  answers: z.record(z.string().max(60), z.record(z.string().max(120), z.unknown())),
  answerSources: z.record(z.string().max(60), z.record(z.string().max(120), z.enum(['human', 'ai', 'evidence']))).optional(),
  ...stamp,
});

/**
 * D7.2: the data intermediation notification (Data Governance Act 2022/868, art. 11): the legal person
 * that provides the service, its business id, when it notified the authority and the authority's
 * reference, the EU register entry, when the authority confirmed it, and what the service covers. The
 * operator keeps the node's; in mode `owners` an organism that runs its own marketplace keeps its own.
 */
export const IntermediationNotificationSchema = z.object({
  id, type: z.literal('notification'),
  legalName: z.string().min(1).max(300),
  businessId: z.string().min(1).max(60),
  notifiedAt: iso.optional(),
  authorityRef: z.string().max(200).optional(),
  euRegisterUrl: z.string().max(500).optional(),
  confirmedAt: iso.optional(),
  /** What the service covers, in the provider's words (the marketplace, the data space). */
  scope: text(2000),
  answerSources: sources,
  ...stamp,
});

/**
 * D7.3: a person's decision on one data intermediation finding of the compliance report: the finding's
 * id, accepted (it is intermediation and is handled) or dismissed (it is not, with the reason). A finding
 * without a review reads source `proposed`: the node matched it by rule, and nobody has decided.
 * The id is the finding's own, and a finding about one thing names it after a colon
 * (`open_organism_with_data:<organism>`, `person_party_contact:<owner>`), so this id takes a colon too.
 */
const findingId = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'letters, digits, dot, colon, dash and underscore');
export const IntermediationReviewSchema = z.object({
  id: findingId, type: z.literal('review'),
  decision: z.enum(['accepted', 'dismissed']),
  note: text().optional(),
  reviewedAt: iso.optional(),
  ...stamp,
});

export const IntermediationItemSchema = z.discriminatedUnion('type', [IntermediationNotificationSchema, IntermediationReviewSchema]);

/** A list document: { items: [...] }, ids unique. */
function listDoc<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.object({ items: z.array(item).max(max) }).superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const [i, it] of (v.items as Array<{ id: string }>).entries()) {
      if (seen.has(it.id)) ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `duplicate id "${it.id}"` });
      seen.add(it.id);
    }
  });
}

export const DOC_SCHEMAS = {
  registers: listDoc(RegisterSchema, 500),
  processors: listDoc(ProcessorSchema, 200),
  requests: listDoc(RequestSchema, 2000),
  breaches: listDoc(BreachSchema, 500),
  dpias: listDoc(DpiaSchema, 500),
  frameworks: FrameworkAnswersSchema,
  intermediation: listDoc(IntermediationItemSchema, 500),
  lias: listDoc(LiaSchema, 100),
  trial: TrialSchema,
  contact: ContactSchema,
} as const;

export type ComplianceRegister = z.infer<typeof RegisterSchema>;
export type ComplianceProcessor = z.infer<typeof ProcessorSchema>;
export type ComplianceRequest = z.infer<typeof RequestSchema>;
export type ComplianceBreach = z.infer<typeof BreachSchema>;
export type ComplianceDpia = z.infer<typeof DpiaSchema>;
export type ComplianceFrameworkAnswers = z.infer<typeof FrameworkAnswersSchema>;
export type IntermediationNotification = z.infer<typeof IntermediationNotificationSchema>;
export type IntermediationReview = z.infer<typeof IntermediationReviewSchema>;
export type IntermediationItem = z.infer<typeof IntermediationItemSchema>;

/** The document each kind stores. */
export interface ComplianceDocs {
  registers: { items: ComplianceRegister[] };
  processors: { items: ComplianceProcessor[] };
  requests: { items: ComplianceRequest[] };
  breaches: { items: ComplianceBreach[] };
  dpias: { items: ComplianceDpia[] };
  frameworks: ComplianceFrameworkAnswers;
  intermediation: { items: IntermediationItem[] };
  lias: { items: ComplianceLia[] };
  trial: ComplianceTrial;
  contact: ComplianceContact;
}

/** An empty document of a kind, which is what a scope with nothing stored reads as. */
export function emptyDoc<K extends ComplianceDocKind>(kind: K): ComplianceDocs[K] {
  return (kind === 'frameworks' ? { answers: {} } : isSingleDocKind(kind) ? {} : { items: [] }) as ComplianceDocs[K];
}
