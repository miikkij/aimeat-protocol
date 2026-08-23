/**
 * @file src/services/compliance-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node operator's compliance picture: the trail the node kept, the register the
 *   operator wrote, and — the part that is actually worth reading — the difference between them.
 *
 *   THE DIFFERENCE IS THE PRODUCT. Provenance, consent and AI usage were all already in the
 *   database, and each already had a surface. What nobody could get was the answer to "is there
 *   anything running here that we have not written down", because that question needs both halves at
 *   once. `gaps` is that answer, and everything else in this file exists to compute it.
 *
 *   IT REUSES THE TRANSPARENCY ROLL-UP RATHER THAN RE-DERIVING IT. `buildAiTransparencyReport` is
 *   called as-is, so the operator report, the per-owner view, the scheduled sweep and this all
 *   count the same population. Two compliance surfaces on one node disagreeing about a number is a
 *   contradiction discovered in front of a regulator, which is the worst place to find one.
 *
 *   `not_covered` IS NOT A DISCLAIMER, IT IS PART OF THE MEASUREMENT. A report that states a total
 *   without stating its population reads as coverage, and reading as coverage is precisely how a
 *   compliance artefact becomes a liability. Every limit below is derived — from the roll-up's own
 *   scope note, from config retention values, from the archive window — so none of them can drift
 *   away from what the node actually does. Acceptance criterion 5 is this list being non-empty and
 *   true, not its wording.
 *
 *   TWO RINGS. This is ring 1: node-wide, for the operator, on a node the reader operates. Ring 2 is
 *   the per-owner slice on a shared node, where the reader operates nothing and their report must
 *   say so — a different `not_covered` list, not the same one filtered. Every read below already
 *   takes an optional owner, so ring 2 is a scoping argument and a different limits list rather than
 *   a second implementation.
 * @structure
 *   - ComplianceReport — the shape all three surfaces serve
 *   - buildComplianceReport(storage, config, opts) — the roll-up
 *   - MONTH_RE / monthWindow(month) — the scheduled report's period
 * @usage
 *   const report = await buildComplianceReport(storage, config, { sinceDays: 30 });
 *   res.json(success(config.nodeId, report));
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, ring 1 (node-wide).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
  buildAiTransparencyReport, listUnlabelledPublic, DEFAULT_TREND_DAYS,
  type AiTransparencyReport,
} from './ai-transparency-report.js';
import {
  classifyUseCase, effectiveQuestionnaire, readUseCases, UNCLASSIFIED,
  type ComplianceQuestionnaire, type ComplianceRiskVerdict, type ComplianceUseCase,
} from './compliance-register.js';

/** How far back the rollup's hot window reaches before rows move to the archive. */
const USAGE_HOT_WINDOW_DAYS = 90;

/** `YYYY-MM`, the scheduled report's period. */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ComplianceGap {
  kind:
    | 'undocumented-ai-activity'
    | 'unclassified-usecase'
    | 'unlabelled-public-content'
    | 'app-declares-generation-with-gap';
  /** One sentence a person can act on, without needing the vocabulary of this file. */
  detail: string;
  /** What in the data says so — a model id, a filename, a count. Never a guess. */
  evidence?: Record<string, unknown>;
}

export interface ComplianceReport {
  scope: {
    node_id: string;
    /** `node-wide` here. Ring 2 serves `owner` and a different `not_covered`. */
    ring: 'node-wide';
    period: { from: string; to: string };
    generated_at: string;
    questionnaire_version: string;
  };
  /** What this report does NOT cover. Read before the numbers. See the file header. */
  not_covered: string[];
  derived: {
    ai_transparency: AiTransparencyReport;
    ai_usage: {
      calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost_usd: number;
      /** Calls the ledger could not price. Kept visible so a low cost is not read as low use. */
      unpriced_calls: number;
      models: string[];
      owners: number;
    };
    consent: {
      active: number;
      revoked: number;
      expired: number;
      by_scope: Record<string, number>;
      /** Days the audit log is kept on this node. Older activity is gone by configuration. */
      audit_retention_days: number;
    };
  };
  register: {
    usecases: Array<ComplianceUseCase & { risk: ComplianceRiskVerdict }>;
    questionnaire: ComplianceQuestionnaire;
  };
  gaps: ComplianceGap[];
}

export interface ComplianceReportOptions {
  /** Window in days. Ignored when `month` is given. */
  sinceDays?: number;
  /** `YYYY-MM` — the whole calendar month, which is what the scheduled report asks for. */
  month?: string;
}

/** Inclusive `from` / exclusive-feeling `to` for a calendar month, both ISO. */
export function monthWindow(month: string): { from: string; to: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 1);
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), days };
}

/**
 * The limits, derived rather than typed out.
 *
 * `transparencyNote` is lifted from the roll-up's own scope note instead of restated, so the two can
 * never come to say different things about the same absence.
 */
function notCovered(config: AimeatConfig, transparencyNote: string): string[] {
  return [
    transparencyNote,
    'Only this node. Content published on a federation peer, on someone\'s personal node, or '
      + 'anywhere off this node is outside every number here.',
    'The use-case register is what the operator wrote down. Nothing in this report checks it against '
      + 'what is actually running — that comparison is the gap list, and it can only see what the '
      + 'node itself records.',
    'A risk class is the operator\'s own answers run through the operator\'s own question set. It is '
      + 'an engineering aid for finding what needs a closer look, not a legal determination.',
    'This node does not watermark text. It does not sample the tokens, and that layer belongs to '
      + 'whoever runs the model.',
    `Consent audit entries are deleted after ${config.consentAuditRetentionDays} days on this node, `
      + 'so access older than that cannot appear here. The grant counts themselves are not pruned.',
    `AI usage is counted from the rolled-up window of about ${USAGE_HOT_WINDOW_DAYS} days. A period `
      + 'older than that has been archived, and a zero here would mean archived rather than idle.',
    config.aiProvenance
      ? 'Provenance recording is on, so content produced through this node during the period has a '
        + 'record. Content produced before it was switched on does not.'
      : 'Provenance recording is OFF on this node (AIMEAT_AI_PROVENANCE). Nothing was recorded, so '
        + 'every count above is zero for that reason and not because nothing happened.',
  ];
}

/** Node-wide AI usage, folded out of the daily aggregate rows. */
async function aiUsage(
  storage: Storage, from: string, to: string,
): Promise<ComplianceReport['derived']['ai_usage']> {
  const rows = await storage.queryUsageDailyAllOwners({ from: from.slice(0, 10), to: to.slice(0, 10) });
  const models = new Set<string>();
  const owners = new Set<string>();
  const out = {
    calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, unpriced_calls: 0,
    models: [] as string[], owners: 0,
  };
  for (const r of rows) {
    out.calls += r.calls;
    out.prompt_tokens += r.promptTokens;
    out.completion_tokens += r.completionTokens;
    out.cost_usd += r.costUsd;
    out.unpriced_calls += r.unpricedCalls;
    if (r.model) models.add(r.model);
    if (r.ownerGhii) owners.add(r.ownerGhii);
  }
  out.models = [...models].sort();
  out.owners = owners.size;
  // Float addition over many rows drifts in the last places; two decimals is what a report shows and
  // what the ledger is the authority for anyway.
  out.cost_usd = Math.round(out.cost_usd * 100) / 100;
  return out;
}

/** Node-wide consent, folded out of the facets. */
async function consentTotals(
  storage: Storage, config: AimeatConfig, since: string,
): Promise<ComplianceReport['derived']['consent']> {
  const facets = await storage.consentFacets({ since });
  const out = {
    active: 0, revoked: 0, expired: 0,
    by_scope: {} as Record<string, number>,
    audit_retention_days: config.consentAuditRetentionDays,
  };
  for (const f of facets) {
    if (f.status === 'active') out.active += f.count;
    else if (f.status === 'revoked') out.revoked += f.count;
    else if (f.status === 'expired') out.expired += f.count;
    out.by_scope[f.scope] = (out.by_scope[f.scope] ?? 0) + f.count;
  }
  return out;
}

/**
 * The two-way difference.
 *
 * Forward: something in the trail that no register entry mentions. Backward: a register entry whose
 * answers are incomplete. Both matter, and only the pair answers "have we written down what we run".
 *
 * Matching is by exact model id and exact `owner/filename`, deliberately. A fuzzy match would let a
 * near-miss silently satisfy a register entry, and a gap list that under-reports is worse than one
 * that asks about something already covered — the first hides work, the second costs a glance.
 */
function findGaps(
  usecases: Array<ComplianceUseCase & { risk: ComplianceRiskVerdict }>,
  usage: ComplianceReport['derived']['ai_usage'],
  transparency: AiTransparencyReport,
): ComplianceGap[] {
  const gaps: ComplianceGap[] = [];

  const registeredModels = new Set(usecases.flatMap(u => u.models ?? []));
  for (const model of usage.models) {
    if (registeredModels.has(model)) continue;
    gaps.push({
      kind: 'undocumented-ai-activity',
      detail: `The model "${model}" was used on this node during the period, and no use case in the register mentions it.`,
      evidence: { model },
    });
  }

  const registeredApps = new Set(usecases.flatMap(u => u.apps ?? []));
  for (const app of transparency.apps_declaring_generation_with_gap) {
    const ref = `${app.owner}/${app.filename}`;
    gaps.push({
      kind: 'app-declares-generation-with-gap',
      detail: `The app "${ref}" says it generates content, and the publish check recorded a disclosure gap (${app.gap}).`
        + (registeredApps.has(ref) ? '' : ' It is also not in the register.'),
      evidence: { app: ref, gap: app.gap, in_register: registeredApps.has(ref) },
    });
  }

  for (const uc of usecases) {
    if (uc.risk.class !== UNCLASSIFIED) continue;
    gaps.push({
      kind: 'unclassified-usecase',
      detail: `"${uc.title}" has ${uc.risk.unanswered.length} unanswered question(s), so it has no risk class.`,
      evidence: { usecase_id: uc.id, unanswered: uc.risk.unanswered },
    });
  }

  if (transparency.unlabelled > 0) {
    gaps.push({
      kind: 'unlabelled-public-content',
      detail: `${transparency.unlabelled} publicly readable item(s) were produced by a model, nobody recorded reviewing them, `
        + 'and no label was computed as required.',
      evidence: { count: transparency.unlabelled },
    });
  }

  return gaps;
}

/**
 * Build the whole picture.
 *
 * `month` wins over `sinceDays` because the scheduled report asks for a calendar month and a
 * "last 30 days" answer filed as "August" is a quiet lie in an archive somebody will read later.
 */
export async function buildComplianceReport(
  storage: Storage, config: AimeatConfig, opts: ComplianceReportOptions = {},
): Promise<ComplianceReport> {
  const window = opts.month && MONTH_RE.test(opts.month)
    ? monthWindow(opts.month)
    : (() => {
      const days = Math.min(Math.max(opts.sinceDays ?? DEFAULT_TREND_DAYS, 1), 3650);
      const to = new Date();
      return { from: new Date(to.getTime() - days * 86_400_000).toISOString(), to: to.toISOString(), days };
    })();

  const questionnaire = await effectiveQuestionnaire(storage, config.nodeId);
  const [transparency, usage, consent, rawUseCases] = await Promise.all([
    buildAiTransparencyReport(storage, { sinceDays: window.days }),
    aiUsage(storage, window.from, window.to),
    consentTotals(storage, config, window.from),
    readUseCases(storage, config.nodeId),
  ]);

  const usecases = rawUseCases.map(uc => ({ ...uc, risk: classifyUseCase(uc, questionnaire) }));

  return {
    scope: {
      node_id: config.nodeId,
      ring: 'node-wide',
      period: { from: window.from, to: window.to },
      generated_at: new Date().toISOString(),
      questionnaire_version: questionnaire.version,
    },
    not_covered: notCovered(config, transparency.scope.note),
    derived: { ai_transparency: transparency, ai_usage: usage, consent },
    register: { usecases, questionnaire },
    gaps: findGaps(usecases, usage, transparency),
  };
}

/** The unlabelled rows behind the count, for the surface that shows a list rather than a number. */
export async function complianceUnlabelledDetail(
  storage: Storage, sinceDays: number, limit = 50,
): Promise<{ total: number; shown: number; items: unknown[] }> {
  const found = await listUnlabelledPublic(storage, { sinceDays, limit });
  // `total` beside a capped list, always: a truncated list without one reads as the whole story,
  // which is exactly how a compliance report comes to overstate its own coverage.
  return { total: found.total, shown: found.items.length, items: found.items };
}
