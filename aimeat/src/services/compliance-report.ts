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

/**
 * One thing the report does not cover.
 *
 * BOTH A CODE AND A SENTENCE, because two different readers need different things. A person opens
 * this in their own language, so the surface renders `code` through the locale files. A machine —
 * the API, the CSV an auditor is handed, another node — gets `text`, which is the English statement
 * and is also the fallback when a surface has no string for a code it has not seen.
 *
 * The first version was English prose only, built here. It was derived and honest and it could not
 * be translated, which on a page whose whole argument is "read the limits before the numbers" made
 * the limits the one part a Finnish reader skipped.
 */
export interface ComplianceLimit {
  /** Stable identifier the surfaces translate. New codes are additive; never renamed in place. */
  code: string;
  /** The English statement. Served as-is to machines, and used when a surface lacks the code. */
  text: string;
  /** The number the sentence turns on, when it has one — a retention or archive window in days. */
  days?: number;
}

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
    /**
     * Who this report is about. `node-wide` is the operator's, `owner` is one account's own slice.
     *
     * They are not the same document narrowed. An owner reading their slice operates nothing and
     * can see nothing about anybody else, so `not_covered` says different things — and saying the
     * operator's sentences to them would be the report claiming a reach it does not have.
     */
    ring: 'node-wide' | 'owner';
    /** The account this is about, when it is about one. */
    owner_ghii?: string;
    period: { from: string; to: string };
    generated_at: string;
    questionnaire_version: string;
  };
  /** What this report does NOT cover. Read before the numbers. See the file header. */
  not_covered: ComplianceLimit[];
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
  /**
   * Narrow every half to one account — the owner's own slice.
   *
   * The caller passes the identity it RESOLVED, never one a request supplied. The route reads it
   * from resolveIdentity() for exactly the reason every other identity-keyed read on this node does.
   */
  ownerGhii?: string;
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
/**
 * The limits an OWNER reads about their own slice.
 *
 * A different list, not the operator's filtered. The three sentences that change are the ones that
 * would be false if said to an account: they operate nothing, so they cannot switch provenance on or
 * change a retention window, and the register they are compared against is the operator's rather
 * than their own. Handing them the operator's wording would be the report claiming a reach the
 * reader does not have, which is the same defect as a total that reads as coverage — one level up.
 */
function notCoveredForOwner(config: AimeatConfig, transparencyNote: string): ComplianceLimit[] {
  return [
    { code: 'no-record', text: transparencyNote },
    {
      code: 'owner-this-node-only',
      text: 'Only what you did here. Anything you published elsewhere — on another installation, on '
        + 'your own personal one, or off this system entirely — is outside every number here.',
    },
    {
      code: 'owner-your-slice',
      text: 'Only yours. Nothing on this page describes anybody else\'s activity, and nobody else '
        + 'sees yours here.',
    },
    {
      code: 'owner-register-is-the-operators',
      text: 'The list of what AI is used for is kept by whoever runs this installation, not by you. '
        + 'What you see below are the entries that name your account; if something of yours is '
        + 'missing from it, that is a conversation with them rather than something you can fix here.',
    },
    {
      code: 'not-a-legal-determination',
      text: 'A risk class is somebody\'s answers run through a question set. It is an aid for finding '
        + 'what needs a closer look, not a legal determination.',
    },
    {
      code: 'no-watermark',
      text: 'Text is not watermarked here. The tokens are not sampled, and that layer belongs to '
        + 'whoever runs the model.',
    },
    {
      code: 'consent-retention',
      days: config.consentAuditRetentionDays,
      text: `Records of who read what are deleted after ${config.consentAuditRetentionDays} days `
        + 'here, so anything older cannot appear. The permissions themselves are not deleted.',
    },
    {
      code: 'usage-window',
      days: USAGE_HOT_WINDOW_DAYS,
      text: `Your AI use is counted from a window of about ${USAGE_HOT_WINDOW_DAYS} days. Anything `
        + 'older has been archived, and a zero would mean archived rather than idle.',
    },
    ...(config.aiProvenance ? [] : [{
      code: 'owner-provenance-off',
      text: 'Recording is switched off on this installation, which is not something you set. Nothing '
        + 'was recorded, so every count above is zero for that reason and not because you did '
        + 'nothing.',
    }]),
  ];
}

function notCovered(config: AimeatConfig, transparencyNote: string): ComplianceLimit[] {
  return [
    // The absent-record rule is lifted from the roll-up's own scope note rather than restated, so
    // the two can never come to say different things about the same absence.
    { code: 'no-record', text: transparencyNote },
    {
      code: 'this-node-only',
      text: 'Only this node. Content published on a federation peer, on someone\'s personal node, or '
        + 'anywhere off this node is outside every number here.',
    },
    {
      code: 'register-unverified',
      text: 'The use-case register is what the operator wrote down. Nothing in this report checks it '
        + 'against what is actually running — that comparison is the gap list, and it can only see '
        + 'what the node itself records.',
    },
    {
      code: 'not-a-legal-determination',
      text: 'A risk class is the operator\'s own answers run through the operator\'s own question '
        + 'set. It is an engineering aid for finding what needs a closer look, not a legal '
        + 'determination.',
    },
    {
      code: 'no-watermark',
      text: 'This node does not watermark text. It does not sample the tokens, and that layer '
        + 'belongs to whoever runs the model.',
    },
    {
      code: 'consent-retention',
      days: config.consentAuditRetentionDays,
      text: `Consent audit entries are deleted after ${config.consentAuditRetentionDays} days on `
        + 'this node, so access older than that cannot appear here. The grant counts themselves are '
        + 'not pruned.',
    },
    {
      code: 'usage-window',
      days: USAGE_HOT_WINDOW_DAYS,
      text: `AI usage is counted from the rolled-up window of about ${USAGE_HOT_WINDOW_DAYS} days. A `
        + 'period older than that has been archived, and a zero here would mean archived rather than '
        + 'idle.',
    },
    config.aiProvenance
      ? {
        code: 'provenance-on',
        text: 'Provenance recording is on, so content produced through this node during the period '
          + 'has a record. Content produced before it was switched on does not.',
      }
      : {
        code: 'provenance-off',
        text: 'Provenance recording is OFF on this node (AIMEAT_AI_PROVENANCE). Nothing was '
          + 'recorded, so every count above is zero for that reason and not because nothing happened.',
      },
  ];
}

/**
 * AI usage, folded out of the daily aggregate rows.
 *
 * TWO DIFFERENT STORAGE METHODS, not one with a filter. `queryUsageDaily` is owner-scoped in its own
 * signature — the owner is required, not optional — while `queryUsageDailyAllOwners` documents
 * itself as applying no caller restriction. Choosing between them here rather than passing an
 * optional owner into one call means an owner slice cannot become node-wide by an argument going
 * missing, which is the shape of the mistake this whole feature is built to notice in other people.
 */
async function aiUsage(
  storage: Storage, from: string, to: string, ownerGhii?: string,
): Promise<ComplianceReport['derived']['ai_usage']> {
  const window = { from: from.slice(0, 10), to: to.slice(0, 10) };
  const rows = ownerGhii
    ? await storage.queryUsageDaily({ ownerGhii, ...window })
    : await storage.queryUsageDailyAllOwners(window);
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

/** Consent, folded out of the facets. Node-wide unless an owner is given. */
async function consentTotals(
  storage: Storage, config: AimeatConfig, since: string, ownerGhii?: string,
): Promise<ComplianceReport['derived']['consent']> {
  const facets = await storage.consentFacets({ since, ownerGhii });
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

  const owner = opts.ownerGhii;
  const questionnaire = await effectiveQuestionnaire(storage, config.nodeId);
  const [transparency, usage, consent, rawUseCases] = await Promise.all([
    buildAiTransparencyReport(storage, { sinceDays: window.days, ownerGhii: owner }),
    aiUsage(storage, window.from, window.to, owner),
    consentTotals(storage, config, window.from, owner),
    readUseCases(storage, config.nodeId),
  ]);

  // The register is one document the operator keeps, so an owner slice SELECTS from it rather than
  // reading a different one: the entries that name this account, plus the ones that name nobody,
  // because a use that belongs to the installation itself is still one this account runs under.
  const visible = owner ? rawUseCases.filter(uc => !uc.ownerGhii || uc.ownerGhii === owner) : rawUseCases;
  const usecases = visible.map(uc => ({ ...uc, risk: classifyUseCase(uc, questionnaire) }));

  return {
    scope: {
      node_id: config.nodeId,
      ring: owner ? 'owner' : 'node-wide',
      ...(owner ? { owner_ghii: owner } : {}),
      period: { from: window.from, to: window.to },
      generated_at: new Date().toISOString(),
      questionnaire_version: questionnaire.version,
    },
    not_covered: owner
      ? notCoveredForOwner(config, transparency.scope.note)
      : notCovered(config, transparency.scope.note),
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
