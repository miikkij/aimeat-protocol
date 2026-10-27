/**
 * @file src/services/compliance-agreements-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of a data processing agreement (GDPR art. 28) as the node keeps it (plan
 *   doc-mvmr4i2wdk0p, D1.1): the two parties, the choices the standard contractual clauses of
 *   Decision (EU) 2021/915 leave open, and a list of versions, each with its four annexes, its
 *   signatures and its state. One zod definition, read by the REST routes and the MCP tool alike.
 *
 *   A VERSION NEVER CHANGES ONCE IT IS SENT. Editing is allowed on the newest version while it is a
 *   draft; anything later makes a new version. `textHash` is the SHA-256 of the canonical text
 *   (compliance-agreements-render.ts), which is what a signature, a returned PDF and a scanned copy
 *   are all checked against.
 *
 *   EVERY ANNEX FIELD SAYS WHERE IT CAME FROM. `sources` maps a field path to evidence (read from the
 *   node), ai (drafted by a model) or human, as the registers do.
 * @structure AGREEMENT_STATUSES · PartySchema · OptionsSchema · OptionsInputSchema · AnnexesSchema · SignatureSchema ·
 *   ReviewSchema · NoticeSchema · VersionSchema · AgreementSchema · CreateInputSchema · PatchInputSchema ·
 *   the inferred types · MEASURE_AREAS
 * @usage const parsed = CreateInputSchema.safeParse(body);
 * @version-history
 *   2026-10-27 — A signature's level may be `test`: a wallet signature on the EU reference wallet's test roots (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1.1).
 */
import { z } from 'zod';
import { isValidEmail } from '../utils/email-validator.js';

/** The state of one version, in order. `review` means a signed copy arrived and waits for a person. */
export const VERSION_STATUSES = ['draft', 'sent', 'review', 'signed', 'superseded'] as const;
/** The state of an agreement as a whole, the field the processor list and fleet read. */
export const AGREEMENT_STATUSES = ['draft', 'sent', 'review', 'signed', 'expired', 'ended'] as const;
export type AgreementStatus = typeof AGREEMENT_STATUSES[number];

/**
 * The areas of Annex III, in the order of the template's explanatory note. The generator fills what
 * the node can read about each; the operator writes the rest.
 */
export const MEASURE_AREAS = [
  'encryption', 'confidentiality', 'restore', 'testing', 'identification', 'transmission', 'storage',
  'physical', 'logging', 'configuration', 'governance', 'certification', 'minimisation', 'quality',
  'retention', 'accountability', 'portability',
] as const;
export type MeasureArea = typeof MEASURE_AREAS[number];

const text = (max = 2000) => z.string().max(max);
const iso = z.string().max(40).refine(s => !Number.isNaN(Date.parse(s)), 'an ISO date or time');
const source = z.enum(['evidence', 'ai', 'human']);
const lines = (max = 40) => z.array(z.string().max(500)).max(max);

/** A party as Annex I lists it, plus the account on this node that receives notices and signs. */
export const PartySchema = z.object({
  name: z.string().min(1).max(300),
  type: z.enum(['company', 'natural_person', 'public_body', 'other']).optional(),
  businessId: z.string().max(60).optional(),
  address: text(500).optional(),
  country: z.string().max(60).optional(),
  contactName: z.string().max(200).optional(),
  contactRole: z.string().max(200).optional(),
  contactEmail: z.string().max(254).refine(isValidEmail, 'an e-mail address').optional(),
  signerName: z.string().max(200).optional(),
  signerRole: z.string().max(200).optional(),
  dpo: text(500).optional(),
  /** The party's account on this node (name@node). Notices land in its bell, and it may sign here. */
  account: z.string().max(300).regex(/^[a-z0-9._-]+@[A-Za-z0-9._-]+$/, 'an account on this node, name@node').optional(),
});

/** The choices Decision 2021/915 leaves open, and the commitments this node adds beside it. */
export const OptionsSchema = z.object({
  /** Clause 7.7(a): option 2 (general written authorisation) or option 1 (prior specific). */
  subprocessorAuthorisation: z.enum(['general', 'specific']).default('general'),
  /** Clause 7.7(a): the period, in days. */
  noticeDays: z.number().int().min(1).max(180).default(30),
  /** Beside Clause 9.2: the processor tells the controller within this many hours. */
  breachNoticeHours: z.number().int().min(1).max(72).default(24),
  /** Beside Clause 10(d): deletion or return within this many days of the end. */
  deletionDays: z.number().int().min(1).max(180).default(30),
  /** Clause 5, the docking clause: whether a third party may accede. */
  dockingClause: z.boolean().default(false),
});

/**
 * The same choices as a caller writes them: every field optional and NO defaults, so a change of one
 * field never puts the others back to their defaults (a partial of OptionsSchema would).
 */
export const OptionsInputSchema = z.object({
  subprocessorAuthorisation: z.enum(['general', 'specific']).optional(),
  noticeDays: z.number().int().min(1).max(180).optional(),
  breachNoticeHours: z.number().int().min(1).max(72).optional(),
  deletionDays: z.number().int().min(1).max(180).optional(),
  dockingClause: z.boolean().optional(),
}).strict();

export const MeasureSchema = z.object({
  area: z.enum(MEASURE_AREAS),
  text: text(2000),
  source,
});

export const SubprocessorSchema = z.object({
  name: z.string().min(1).max(200),
  address: text(500).optional(),
  country: z.string().max(60).optional(),
  contact: text(300).optional(),
  description: text(1000),
  /** The processor list entry it came from, when it came from there. */
  processorId: z.string().max(120).optional(),
});

/** The four annexes of Decision 2021/915. */
export const AnnexesSchema = z.object({
  I: z.object({ controller: PartySchema, processor: PartySchema }),
  II: z.object({
    subjects: lines(),
    categories: lines(),
    sensitive: text(2000),
    nature: text(2000),
    purposes: text(2000),
    duration: text(1000),
    subprocessing: text(2000).optional(),
  }),
  III: z.object({ measures: z.array(MeasureSchema).max(60), assistance: text(2000) }),
  IV: z.object({ subprocessors: z.array(SubprocessorSchema).max(50) }),
});

/**
 * One signature on a version. `level` is what it proves, strongest first. `test` is a wallet
 * signature that chains to the EU reference wallet's test roots: it proves nothing in law
 * (docsign/validate.ts TEST_TRUST_ANCHOR), and the history says so.
 */
export const SignatureSchema = z.object({
  party: z.enum(['controller', 'processor']),
  method: z.enum(['aimeat', 'eudi-wallet', 'external-pdf', 'scan']),
  level: z.enum(['qualified', 'advanced', 'aimeat', 'scanned', 'test']),
  signer: z.string().max(300),
  at: iso,
  /** The docsign request, the validation summary, or the scan check, by reference. */
  evidence: z.record(z.string(), z.unknown()).optional(),
});

/** A signed copy that came back and waits for a person (a scan, or a PDF signed elsewhere). */
export const ReviewSchema = z.object({
  kind: z.enum(['scan', 'pdf']),
  storageKey: z.string().max(500),
  storageOwner: z.string().max(300),
  uploadedBy: z.string().max(300),
  uploadedAt: iso,
  party: z.enum(['controller', 'processor']),
  checks: z.array(z.object({ id: z.string().max(60), ok: z.boolean().nullable(), note: text(600) })).max(30),
  /** What the check found, in one word: everything passed, something needs a look, or it failed. */
  verdict: z.enum(['pass', 'attention', 'fail']),
  level: z.enum(['qualified', 'advanced', 'scanned']).optional(),
  checkedBy: z.string().max(200).optional(),
  decidedBy: z.string().max(300).optional(),
  decidedAt: iso.optional(),
  decision: z.enum(['accepted', 'rejected']).optional(),
  reason: text(1000).optional(),
});

/** A change to the sub-processor list announced under option 2 of Clause 7.7(a). */
export const NoticeSchema = z.object({
  sentAt: iso,
  objectionUntil: iso,
  objectedAt: iso.optional(),
  objection: text(2000).optional(),
});

export const VersionSchema = z.object({
  n: z.number().int().min(1),
  status: z.enum(VERSION_STATUSES),
  annexes: AnnexesSchema,
  sources: z.record(z.string(), source).default({}),
  options: OptionsSchema,
  textHash: z.string().max(64).optional(),
  sccSha256: z.string().max(64).optional(),
  pdfKey: z.string().max(500).optional(),
  docsignId: z.string().max(80).optional(),
  createdAt: iso,
  createdBy: z.string().max(300),
  sentAt: iso.optional(),
  signedAt: iso.optional(),
  effectiveFrom: iso.optional(),
  signatures: z.array(SignatureSchema).max(10).default([]),
  review: ReviewSchema.optional(),
  notice: NoticeSchema.optional(),
  remindersSent: z.array(iso).max(10).default([]),
});

export const HistorySchema = z.object({ at: iso, by: z.string().max(300), event: z.string().max(60), detail: text(600).optional() });

export const AgreementSchema = z.object({
  id: z.string().regex(/^dpa-[a-z0-9]{6,20}$/),
  type: z.literal('dpa-art28'),
  template: z.literal('eu-scc-2021-915'),
  language: z.enum(['fi', 'en']),
  ourRole: z.enum(['processor', 'controller']),
  product: z.enum(['place', 'box', 'managed', 'custom']),
  /** What the agreement covers, in a few words ("AIMEAT-ympäristö ja sovitut palvelimet"). */
  subject: text(300),
  counterparty: PartySchema,
  registerId: z.string().max(120).optional(),
  /** An outside reference the operator's own systems use: a shop order, a fleet host. */
  externalRef: z.string().max(200).optional(),
  versions: z.array(VersionSchema).min(1).max(50),
  endedAt: iso.optional(),
  endReason: text(1000).optional(),
  deletion: z.object({
    choice: z.enum(['delete', 'return']),
    dueAt: iso,
    doneAt: iso.optional(),
    note: text(1000).optional(),
  }).optional(),
  history: z.array(HistorySchema).max(500).default([]),
  createdAt: iso,
  updatedAt: iso,
});

/** What a caller sends to make a new agreement; the annexes are generated, then overridden. */
export const CreateInputSchema = z.object({
  counterparty: PartySchema,
  product: z.enum(['place', 'box', 'managed', 'custom']).default('custom'),
  language: z.enum(['fi', 'en']).default('fi'),
  ourRole: z.enum(['processor', 'controller']).default('processor'),
  subject: text(300).optional(),
  registerId: z.string().max(120).optional(),
  externalRef: z.string().max(200).optional(),
  options: OptionsInputSchema.optional(),
  /** Annex parts the caller writes over the generated ones; whatever is given is marked human (or ai). */
  annexes: z.object({
    II: AnnexesSchema.shape.II.partial().optional(),
    III: z.object({ measures: z.array(MeasureSchema).max(60).optional(), assistance: text(2000).optional() }).optional(),
    IV: AnnexesSchema.shape.IV.partial().optional(),
  }).optional(),
  /** Who wrote the overrides: a person (human, the default) or a model (ai). */
  written_by: z.enum(['human', 'ai']).optional(),
}).strict();

/**
 * What may change on the newest version while it is a draft. Written out, NOT a partial of
 * CreateInputSchema: a partial keeps its defaults, so a change of one annex silently set the product
 * back to `custom` and the language to `fi` and generated the annexes again.
 */
export const PatchInputSchema = z.object({
  counterparty: PartySchema.optional(),
  product: z.enum(['place', 'box', 'managed', 'custom']).optional(),
  language: z.enum(['fi', 'en']).optional(),
  subject: text(300).optional(),
  registerId: z.string().max(120).optional(),
  externalRef: z.string().max(200).optional(),
  options: OptionsInputSchema.optional(),
  annexes: CreateInputSchema.shape.annexes,
  written_by: z.enum(['human', 'ai']).optional(),
}).strict();

export type AgreementParty = z.infer<typeof PartySchema>;
export type AgreementOptions = z.infer<typeof OptionsSchema>;
export type AgreementAnnexes = z.infer<typeof AnnexesSchema>;
export type AgreementSignature = z.infer<typeof SignatureSchema>;
export type AgreementReview = z.infer<typeof ReviewSchema>;
export type AgreementVersion = z.infer<typeof VersionSchema>;
export type Agreement = z.infer<typeof AgreementSchema>;
export type AgreementCreateInput = z.infer<typeof CreateInputSchema>;
export type AgreementPatchInput = z.infer<typeof PatchInputSchema>;
