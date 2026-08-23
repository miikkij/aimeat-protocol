/**
 * @file src/services/compliance-register.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The written half of the operator's compliance picture: what this node is used for,
 *   and how each use is classified. The derived half — provenance, consent, AI usage — lives in
 *   services/compliance-report.ts, and the report is the difference between the two.
 *
 *   THE QUESTION SET IS DATA, AND THE CLASSIFIER PROVES IT. `classifyUseCase` knows no question id
 *   and no class name: it reads `implies` off whatever set it was handed, picks the most severe hit
 *   by `severity`, and stops. Adding a question is therefore an edit to a memory record, not a
 *   release — which is the whole point, because regulatory reading moves and a set that needed a
 *   deploy to follow it would not follow it.
 *
 *   UNANSWERED IS NOT MINIMAL. A use case with a question it has not answered comes back
 *   `unclassified` and lands in the report's gap list. Defaulting it to the mildest class would be
 *   the single most dangerous shortcut available here: it would turn "nobody has looked at this"
 *   into "this was looked at and found fine", in a document handed to an auditor.
 *
 *   BOTH RECORDS LIVE UNDER `system@{nodeId}`. They are the node's own configuration rather than
 *   anyone's content, so they are not charged against an owner's key quota and do not appear in an
 *   owner's memory listing. Same namespace and the same getMemory/setMemory pair as
 *   services/ecosystem-events.ts, which is the established shape for a registry the server itself
 *   trusts.
 * @structure
 *   - Types: ComplianceQuestionnaire · ComplianceUseCase · ComplianceRiskVerdict
 *   - Zod: QuestionnaireSchema · UseCasesSchema — one definition, used by the route and the tool
 *   - classifyUseCase(useCase, questionnaire) — the pure function; no ids, no class names
 *   - readQuestionnaire / writeQuestionnaire / readUseCases / writeUseCases
 *   - effectiveQuestionnaire(storage, nodeId) — the stored set, or the seed; never null
 *   - reportKeyFor / writeStoredReport / readStoredReport / listStoredReports — the monthly snapshots
 * @usage
 *   const q = await readQuestionnaire(storage, config.nodeId);
 *   const verdict = classifyUseCase(useCase, q);
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import { z } from 'zod';
import type { Storage } from '../storage/interface.js';
import { emitChange } from './event-bus.js';

export const QUESTIONNAIRE_KEY = 'compliance.questionnaire';
export const USECASES_KEY = 'compliance.usecases';

/** The system identity both records belong to. Not an actor — the node itself. */
export const systemGhiiFor = (nodeId: string): string => `system@${nodeId}`;

// ── Types ────────────────────────────────────────────────────────────────────────────────────

export interface ComplianceRiskClass {
  id: string;
  label: string;
  /** Higher wins. The classifier orders by this alone, so a new class slots in without code. */
  severity: number;
  note?: string;
}

export interface ComplianceQuestionOption {
  value: string;
  label: string;
}

export interface ComplianceQuestion {
  id: string;
  text: string;
  help?: string;
  type: 'boolean' | 'choice';
  options?: ComplianceQuestionOption[];
  /**
   * Answer → class id. A `boolean` question keys on the strings `'true'` / `'false'`; a `choice`
   * question keys on the option value. An answer with no entry implies nothing, which is how a
   * question can be asked for the record without moving the class.
   */
  implies: Record<string, string>;
}

export interface ComplianceQuestionnaire {
  version: string;
  updatedAt: string;
  note: string;
  classes: ComplianceRiskClass[];
  defaultClass: string;
  questions: ComplianceQuestion[];
}

export interface ComplianceUseCase {
  id: string;
  title: string;
  description?: string;
  /** The account this use runs under, when it is one account's. `null` means the node's own. */
  ownerGhii?: string | null;
  /** What it runs on, in the operator's words. Matched loosely against the derived trail. */
  systems?: string[];
  /** Model ids as they appear in the usage ledger, e.g. `anthropic/claude-opus-5`. */
  models?: string[];
  /** Published app filenames, as `owner/filename.html`. */
  apps?: string[];
  purpose?: string;
  dataSubjects?: string;
  /** questionId → the answer. `boolean` questions store a boolean; `choice` questions a string. */
  answers?: Record<string, unknown>;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ComplianceRiskVerdict {
  /** A class id from the set, or `unclassified` when a question has not been answered. */
  class: string;
  label: string;
  /** Which answers produced the class, in the question's own words. Empty for the default class. */
  reasons: Array<{ questionId: string; question: string; answer: string; impliesClass: string }>;
  /** Question ids with no answer. Non-empty means `unclassified`, whatever the answered ones said. */
  unanswered: string[];
  /** The version of the set this verdict was computed against. */
  questionnaireVersion: string;
}

/** The class id a use case carries while a question is still unanswered. Never a real class. */
export const UNCLASSIFIED = 'unclassified';

// ── Validation ───────────────────────────────────────────────────────────────────────────────
// One definition. The HTTP route and the MCP tool both validate through these, so the two doors
// cannot come to disagree about what a valid register looks like.

const OptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
});

const QuestionSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(2000),
  help: z.string().max(2000).optional(),
  type: z.enum(['boolean', 'choice']),
  options: z.array(OptionSchema).max(50).optional(),
  implies: z.record(z.string(), z.string()),
});

export const QuestionnaireSchema = z.object({
  version: z.string().min(1).max(60),
  updatedAt: z.string().optional(),
  note: z.string().max(4000).default(''),
  classes: z.array(z.object({
    id: z.string().min(1).max(60),
    label: z.string().min(1).max(200),
    severity: z.number().int(),
    note: z.string().max(2000).optional(),
  })).min(1).max(20),
  defaultClass: z.string().min(1).max(60),
  questions: z.array(QuestionSchema).max(200),
}).superRefine((q, ctx) => {
  const ids = new Set(q.classes.map(c => c.id));
  // A class id that does not exist would make the verdict name something the reader cannot look up.
  // Caught here rather than at classification time, where it would surface as a silent default.
  if (!ids.has(q.defaultClass)) {
    ctx.addIssue({ code: 'custom', path: ['defaultClass'], message: `defaultClass "${q.defaultClass}" is not one of the classes` });
  }
  for (const [qi, question] of q.questions.entries()) {
    if (question.type === 'choice' && !question.options?.length) {
      ctx.addIssue({ code: 'custom', path: ['questions', qi, 'options'], message: 'a choice question needs options' });
    }
    for (const [answer, cls] of Object.entries(question.implies)) {
      if (!ids.has(cls)) {
        ctx.addIssue({ code: 'custom', path: ['questions', qi, 'implies', answer], message: `implies "${cls}", which is not one of the classes` });
      }
    }
  }
  const seen = new Set<string>();
  for (const [qi, question] of q.questions.entries()) {
    if (seen.has(question.id)) {
      ctx.addIssue({ code: 'custom', path: ['questions', qi, 'id'], message: `duplicate question id "${question.id}"` });
    }
    seen.add(question.id);
  }
});

export const UseCaseSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  ownerGhii: z.string().max(300).nullable().optional(),
  systems: z.array(z.string().max(300)).max(100).optional(),
  models: z.array(z.string().max(300)).max(100).optional(),
  apps: z.array(z.string().max(300)).max(100).optional(),
  purpose: z.string().max(2000).optional(),
  dataSubjects: z.string().max(2000).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().max(300).optional(),
});

export const UseCasesSchema = z.object({
  usecases: z.array(UseCaseSchema).max(500),
}).superRefine((v, ctx) => {
  const seen = new Set<string>();
  for (const [i, uc] of v.usecases.entries()) {
    if (seen.has(uc.id)) {
      ctx.addIssue({ code: 'custom', path: ['usecases', i, 'id'], message: `duplicate use case id "${uc.id}"` });
    }
    seen.add(uc.id);
  }
});

// ── The classifier ───────────────────────────────────────────────────────────────────────────

/** How an answer is keyed into `implies`. Booleans become the strings the set is written with. */
function answerKey(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Run one use case through one question set.
 *
 * Pure, and deliberately ignorant: it never names a question or a class, so the set can grow, shrink
 * or be rewritten entirely without this function changing. That is what makes acceptance criterion 1
 * true rather than merely claimed.
 *
 * An unanswered question wins over every answered one. See the file header: defaulting it would
 * turn "nobody looked" into "looked at and fine", inside a compliance artefact.
 */
export function classifyUseCase(
  useCase: ComplianceUseCase, questionnaire: ComplianceQuestionnaire,
): ComplianceRiskVerdict {
  const byId = new Map(questionnaire.classes.map(c => [c.id, c]));
  const answers = useCase.answers ?? {};
  const reasons: ComplianceRiskVerdict['reasons'] = [];
  const unanswered: string[] = [];
  let best: ComplianceRiskClass | null = null;

  for (const question of questionnaire.questions) {
    const key = answerKey(answers[question.id]);
    if (key === null) { unanswered.push(question.id); continue; }
    const impliedId = question.implies[key];
    if (!impliedId) continue;
    const implied = byId.get(impliedId);
    if (!implied) continue;
    reasons.push({ questionId: question.id, question: question.text, answer: key, impliesClass: impliedId });
    if (!best || implied.severity > best.severity) best = implied;
  }

  const version = questionnaire.version;
  if (unanswered.length) {
    return { class: UNCLASSIFIED, label: 'Not yet classified', reasons, unanswered, questionnaireVersion: version };
  }
  const fallback = byId.get(questionnaire.defaultClass);
  const chosen = best ?? fallback;
  return {
    class: chosen?.id ?? questionnaire.defaultClass,
    label: chosen?.label ?? questionnaire.defaultClass,
    reasons, unanswered, questionnaireVersion: version,
  };
}

// ── Reading and writing ──────────────────────────────────────────────────────────────────────

/**
 * Write one of the compliance records, and tell the live stream.
 *
 * The emit lives HERE rather than at each door, so the HTTP route and the MCP tool cannot come to
 * differ about whether an operator watching the tab sees a change. A tool that hands its write to a
 * silent service is the same defect as a tool that never emitted, and it hides better.
 *
 * The scheduled monthly report writes through here too and emits with everything else: a report
 * appearing while somebody has the tab open is exactly the case the stream exists for.
 */
async function writeSystemRecord(
  storage: Storage, nodeId: string, key: string, value: unknown, tag: string,
): Promise<void> {
  const systemGhii = systemGhiiFor(nodeId);
  const existing = await storage.getMemory(systemGhii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: systemGhii, value,
    visibility: 'private', tags: ['compliance', tag], ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  });
  emitChange('compliance');
}

/** The stored question set, or null when the node has none yet. */
export async function readQuestionnaire(
  storage: Storage, nodeId: string,
): Promise<ComplianceQuestionnaire | null> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), QUESTIONNAIRE_KEY);
  const value = rec?.value as ComplianceQuestionnaire | undefined;
  return value && Array.isArray(value.questions) ? value : null;
}

/**
 * `updatedAt` is optional on the way IN and always present on the way out: this function stamps it,
 * so a caller handing over a freshly validated document does not have to invent one — and cannot
 * backdate it either.
 */
export async function writeQuestionnaire(
  storage: Storage, nodeId: string,
  questionnaire: Omit<ComplianceQuestionnaire, 'updatedAt'> & { updatedAt?: string },
): Promise<ComplianceQuestionnaire> {
  const stamped = { ...questionnaire, updatedAt: new Date().toISOString() };
  await writeSystemRecord(storage, nodeId, QUESTIONNAIRE_KEY, stamped, 'questionnaire');
  return stamped;
}

export async function readUseCases(storage: Storage, nodeId: string): Promise<ComplianceUseCase[]> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), USECASES_KEY);
  const value = rec?.value as { usecases?: ComplianceUseCase[] } | undefined;
  return Array.isArray(value?.usecases) ? value.usecases : [];
}

export async function writeUseCases(
  storage: Storage, nodeId: string, usecases: ComplianceUseCase[], updatedBy: string,
): Promise<ComplianceUseCase[]> {
  const now = new Date().toISOString();
  const stamped = usecases.map(uc => ({ ...uc, updatedAt: uc.updatedAt ?? now, updatedBy: uc.updatedBy ?? updatedBy }));
  await writeSystemRecord(storage, nodeId, USECASES_KEY, { usecases: stamped }, 'usecases');
  return stamped;
}

// ── The scheduled monthly snapshots ──────────────────────────────────────────────────────────

/** One key per month: twelve a year, which the key budget swallows for decades. */
export const reportKeyFor = (month: string): string => `compliance.report.${month}`;
const REPORT_PREFIX = 'compliance.report.';

/** Store one month's report. Overwrites, because re-running a month must not leave two answers. */
export async function writeStoredReport(
  storage: Storage, nodeId: string, month: string, report: unknown,
): Promise<void> {
  await writeSystemRecord(storage, nodeId, reportKeyFor(month), report, 'report');
}

export async function readStoredReport(
  storage: Storage, nodeId: string, month: string,
): Promise<unknown | null> {
  const rec = await storage.getMemory(systemGhiiFor(nodeId), reportKeyFor(month));
  return rec?.value ?? null;
}

/**
 * Which months have a stored report, newest first — the index, never the bodies.
 *
 * Listing metadata rather than values on purpose: a year of reports is a large read, and the caller
 * wants to know what exists before choosing one.
 */
export async function listStoredReports(
  storage: Storage, nodeId: string,
): Promise<Array<{ month: string; generated_at: string }>> {
  const { items } = await storage.listAllMemoryMeta({
    ownerPrefix: systemGhiiFor(nodeId), prefix: REPORT_PREFIX, limit: 500, excludeVersionRows: true,
  });
  return items
    .map(r => ({ month: r.key.slice(REPORT_PREFIX.length), generated_at: r.updatedAt }))
    // A `.version.N` row would otherwise appear as a month named "2026-08.version.3".
    .filter(r => /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * The set to classify against: the stored one, or the seed when nothing has been stored.
 *
 * Never null, because a report that could not classify would have to explain why, and "nothing has
 * been written yet" is not a sentence an auditor should ever have to read.
 *
 * NOTHING SEEDS THIS AT BOOT, deliberately. This fallback IS the mechanism: a node whose operator
 * never opens the compliance surface never gains a record, and the first save is what materialises
 * one. Seeding at boot would write a record onto every node in the world — most of them run by
 * somebody with no interest in this — to save a read that already has an answer.
 */
export async function effectiveQuestionnaire(
  storage: Storage, nodeId: string,
): Promise<ComplianceQuestionnaire> {
  const stored = await readQuestionnaire(storage, nodeId);
  if (stored) return stored;
  const { COMPLIANCE_QUESTIONNAIRE_SEED } = await import('../data/compliance-questionnaire.js');
  return COMPLIANCE_QUESTIONNAIRE_SEED;
}
