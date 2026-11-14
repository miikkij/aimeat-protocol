/**
 * @file src/services/help/report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's report about what people asked: which help was needed and where, which
 *   questions repeat, which topics have no helper, how the load spreads, and suggested next steps the
 *   operator can add to a development queue (Jouni, 2026-11-14: "mistä voitaisiin päätellä mitä
 *   seuraavia kehitysaskeleita otetaan").
 *
 *   THE JOB COUNTS; AN AI WRITES. The scheduled job `help-report` stores the figures of the week or
 *   month that ended, without names, and tells the operators. By default the operator's OWN AI writes
 *   the text with aimeat_help_report_data and aimeat_help_report_write (a dry run first, then the
 *   operator's yes), as the compliance report is written (Jouni, 2026-11-14: "sen voi ajaa kuka
 *   tahansa operaattori omalla älylläkin"). With `helpReportWriter` 'node-ai' the node's own model
 *   writes it right after the figures are stored, paid as an operator's call.
 *
 *   WHAT THE WRITER READS is the operator's choice (`helpReportReads`): topics, times and states, or
 *   also the questions' subjects and texts. Never a name, never who asked or who answered.
 *
 *   STORED under `system@<node>` as `help.report.<period>` (YYYY-MM or YYYY-Www), kept for
 *   `helpReportRetentionMonths`. Questions nobody was found for are counted per month in
 *   `help.unmatched.<YYYY-MM>`, topics only, because such a question is not stored.
 * @structure HelpReport · periodOf · noteUnmatched · buildReportData · readReport · listReports ·
 *   writeReportText · decideSuggestion · runHelpReportJob · reportPrompt
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import type { HelpQuestionRecord } from '../../storage/types/help.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { listOperatorGhiis } from '../operators.js';
import { logger } from '../../utils/logger.js';
import { normalizeTopic, refuse, text, type HelpDeps, type HelpResult } from './rules.js';

const REPORT_PREFIX = 'help.report.';
const UNMATCHED_PREFIX = 'help.unmatched.';
const systemGhii = (nodeId: string) => `system@${nodeId}`;

export interface HelpSuggestion { n: number; title: string; why: string; status: 'open' | 'queued' | 'rejected'; queued_ref?: string }

export interface HelpReport {
  id: string;
  kind: 'monthly' | 'weekly';
  from: string;
  to: string;
  generated_at: string;
  reads: 'topics' | 'questions';
  figures: {
    asked: number; solved: number; expired: number; cancelled: number; open: number;
    median_first_answer_hours: number | null; kept_new: number; kept_total: number; kept_stale: number;
    morsels_to_helpers: number; answered_by_ai: number; from_board: number; nobody_found: number;
    helpers_total: number; helpers_active: number; top3_share: number | null;
  };
  topics: Array<{ topic: string; asked: number; solved: number; expired: number }>;
  topics_without_helper: Array<{ topic: string; asked: number }>;
  questions?: Array<{ subject: string; question: string; topics: string[]; state: string }>;
  previous?: { id: string; suggestions: HelpSuggestion[] } | null;
  text: string | null;
  suggestions: HelpSuggestion[];
  written_by: string | null;
  written_at: string | null;
}

function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7) };
}

/** The month or ISO week that ended before `now`: its id and its bounds. */
export function periodOf(kind: 'monthly' | 'weekly', now: Date): { id: string; from: string; to: string } {
  if (kind === 'monthly') {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, 1));
    return { id: from.toISOString().slice(0, 7), from: from.toISOString(), to: to.toISOString() };
  }
  const day = now.getUTCDay() || 7;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const w = isoWeek(from);
  return { id: `${w.year}-W${String(w.week).padStart(2, '0')}`, from: from.toISOString(), to: to.toISOString() };
}

/** Count the topics of a question nobody could be found for, per month. Topics only, no text. */
export async function noteUnmatched(deps: HelpDeps, topics: string[]): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const parse = (v: unknown): Record<string, number> => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, number>) } : {});
  await updateRecord(deps.storage, systemGhii(deps.config.nodeId), `${UNMATCHED_PREFIX}${month}`, parse, cur => {
    const next: Record<string, number> = { ...cur, '': (cur[''] ?? 0) + 1 };
    for (const t of topics.slice(0, 10)) next[normalizeTopic(t)] = (next[normalizeTopic(t)] ?? 0) + 1;
    return next;
  }, { tag: 'help' });
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The figures of one period, without names. */
export async function buildReportData(deps: HelpDeps, kind: 'monthly' | 'weekly', period: { id: string; from: string; to: string }): Promise<HelpReport> {
  const { storage, config } = deps;
  const all = await storage.listHelpQuestions({ since: period.from, limit: 1000 });
  const qs = all.filter(q => q.createdAt < period.to);
  const firstAnswer: number[] = [];
  const answersBy = new Map<string, number>();
  let fromBoard = 0;
  for (const q of qs) {
    const routes = await storage.listHelpRoutes(q.id);
    const answered = routes.filter(r => r.outcome === 'answered' && r.outcomeAt).sort((a, b) => a.outcomeAt!.localeCompare(b.outcomeAt!));
    if (answered[0]) firstAnswer.push((Date.parse(answered[0].outcomeAt!) - Date.parse(q.createdAt)) / 3_600_000);
    for (const r of answered) answersBy.set(r.helperGhii, (answersBy.get(r.helperGhii) ?? 0) + 1);
    // A question taken from the shared list keeps no 'board' audience; its first route is the taker's.
    if (q.audience === 'board' || (routes[0] && Date.parse(routes[0].routedAt) - Date.parse(q.createdAt) > 60_000 && !routes[0].referredTo)) fromBoard++;
  }
  const byTopic = new Map<string, { topic: string; asked: number; solved: number; expired: number }>();
  for (const q of qs) for (const t of q.topics) {
    const k = normalizeTopic(t);
    const row = byTopic.get(k) ?? { topic: t, asked: 0, solved: 0, expired: 0 };
    row.asked++; if (q.state === 'solved') row.solved++; if (q.state === 'expired') row.expired++;
    byTopic.set(k, row);
  }
  // Questions nobody was found for, by month: a weekly report reads the month it falls in.
  const months = new Set([period.from.slice(0, 7), new Date(Date.parse(period.to) - 1).toISOString().slice(0, 7)]);
  const unmatched = new Map<string, number>();
  let nobody = 0;
  for (const m of months) {
    const rec = await storage.getMemory(systemGhii(config.nodeId), `${UNMATCHED_PREFIX}${m}`);
    const v = (rec?.value ?? {}) as Record<string, number>;
    for (const [k, n] of Object.entries(v)) {
      if (k === '') nobody += Number(n) || 0;
      else unmatched.set(k, (unmatched.get(k) ?? 0) + (Number(n) || 0));
    }
  }
  const kept = await storage.listHelpQuestions({ saved: true, states: ['solved'], limit: 1000 });
  const helpers = await storage.listHelpers({ limit: 1000 });
  const counts = [...answersBy.values()].sort((a, b) => b - a);
  const totalAnswers = counts.reduce((s, n) => s + n, 0);
  const state = (s: string) => qs.filter(q => q.state === s).length;
  const report: HelpReport = {
    id: period.id, kind, from: period.from, to: period.to, generated_at: new Date().toISOString(),
    reads: config.helpReportReads === 'questions' ? 'questions' : 'topics',
    figures: {
      asked: qs.length, solved: state('solved'), expired: state('expired'), cancelled: state('cancelled'),
      open: state('open') + state('answered'),
      median_first_answer_hours: (() => { const m = median(firstAnswer); return m === null ? null : Math.round(m * 10) / 10; })(),
      kept_new: qs.filter(q => q.saved).length, kept_total: kept.length, kept_stale: kept.filter(q => q.stale).length,
      morsels_to_helpers: qs.reduce((s, q) => s + q.rewardMorsels, 0),
      answered_by_ai: qs.filter(q => q.answeredByAi && (q.state === 'solved' || q.state === 'answered')).length,
      from_board: fromBoard, nobody_found: nobody,
      helpers_total: helpers.length, helpers_active: answersBy.size,
      top3_share: totalAnswers ? Math.round((counts.slice(0, 3).reduce((s, n) => s + n, 0) / totalAnswers) * 100) / 100 : null,
    },
    topics: [...byTopic.values()].sort((a, b) => b.asked - a.asked).slice(0, 30),
    topics_without_helper: [...unmatched.entries()].map(([topic, asked]) => ({ topic, asked })).sort((a, b) => b.asked - a.asked).slice(0, 20),
    previous: null, text: null, suggestions: [], written_by: null, written_at: null,
  };
  if (report.reads === 'questions') {
    report.questions = qs.slice(0, 200).map((q: HelpQuestionRecord) => ({ subject: q.subject, question: q.question.slice(0, 1000), topics: q.topics, state: q.state }));
  }
  const prev = (await listReports(deps)).find(r => r.id < period.id && r.kind === kind);
  if (prev) {
    const p = await readReport(deps, prev.id);
    if (p) report.previous = { id: p.id, suggestions: p.suggestions };
  }
  return report;
}

function parseReport(v: unknown): HelpReport | null {
  return v && typeof v === 'object' && typeof (v as HelpReport).id === 'string' ? v as HelpReport : null;
}

export async function readReport(deps: HelpDeps, id: string): Promise<HelpReport | null> {
  const rec = await deps.storage.getMemory(systemGhii(deps.config.nodeId), `${REPORT_PREFIX}${id}`);
  return parseReport(rec?.value);
}

export async function listReports(deps: HelpDeps): Promise<Array<{ id: string; kind: 'monthly' | 'weekly'; written: boolean; generated_at: string }>> {
  const { items } = await deps.storage.listAllMemoryMeta({
    ownerPrefix: systemGhii(deps.config.nodeId), prefix: REPORT_PREFIX, limit: 500, excludeVersionRows: true,
  });
  const out = [];
  for (const it of items) {
    const id = it.key.slice(REPORT_PREFIX.length);
    if (!/^\d{4}-(\d{2}|W\d{2})$/.test(id)) continue;
    const r = await readReport(deps, id);
    if (r) out.push({ id, kind: r.kind, written: !!r.text, generated_at: r.generated_at });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

async function storeReport(deps: HelpDeps, report: HelpReport): Promise<void> {
  await updateRecord(deps.storage, systemGhii(deps.config.nodeId), `${REPORT_PREFIX}${report.id}`, parseReport, () => report, { tag: 'help' });
  emitChange('help-report');
}

/** The instructions the report's writer follows: the operator's own, or the built-in ones. */
export function reportPrompt(deps: HelpDeps, report: HelpReport): string {
  const own = deps.config.helpReportPrompt.trim();
  const base = own || `You write the ${report.kind} report of Ask someone who knows for the operator of this AIMEAT node: what help members needed and where, so the organisation can decide its next development steps.
Write in the operator's language. Lead with a summary of three to five sentences. Then name what help was needed and where: for each group of questions, say whether it is about a PROCESS, an APPLICATION, or a SHARED PLACE, and name it. Say which questions repeat even though a kept answer exists, which topics have no helper, and how the load spreads (never who). Then give at most five suggested next steps, each with one sentence of why, grounded in the figures. When the previous report had suggestions, say for each whether the questions about it went down.
Never name a person. Never guess a number the data does not hold.`;
  return `${base}\n\nThe data (JSON, no names):\n${JSON.stringify({ ...report, text: undefined, suggestions: undefined }, null, 2)}`;
}

/**
 * Store the text and the suggestions the operator's AI (or the node's model) wrote. With `dry_run`
 * nothing is stored and the answer shows what would be. Only an operator, in person or through their
 * agent holding operator:admin, writes it.
 */
export async function writeReportText(deps: HelpDeps, caller: CallerContext, id: string, body: Record<string, unknown>): Promise<HelpResult<{ report: HelpReport; stored: boolean }>> {
  if (!(await caller.operator())) return refuse(403, 'OPERATOR_ONLY', 'Only an operator writes the report.');
  const report = await readReport(deps, id);
  if (!report) return refuse(404, 'NOT_FOUND', 'No report with this id. Its figures are made by the scheduled job; ask for aimeat_help_report_data first.');
  const decisions = Array.isArray(body.decisions) ? body.decisions.slice(0, 8) : [];
  const reportText = text(body.text, 40_000);
  if (!reportText && decisions.length === 0) return refuse(400, 'INVALID_INPUT', 'text is the report itself, in Markdown; decisions decide its suggestions.');
  if (!reportText) {
    if (body.dry_run === true) return { ok: true, data: { report, stored: false } };
    for (const d of decisions) {
      const n = Number((d as { n?: unknown }).n);
      const decision = (d as { decision?: unknown }).decision;
      if (decision !== 'queue' && decision !== 'reject') return refuse(400, 'INVALID_INPUT', 'A decision is queue or reject.');
      const r = await decideSuggestion(deps, caller, id, n, decision);
      if (!r.ok) return r;
    }
    return { ok: true, data: { report: (await readReport(deps, id)) ?? report, stored: true } };
  }
  const raw = Array.isArray(body.suggestions) ? body.suggestions.slice(0, 8) : [];
  const suggestions: HelpSuggestion[] = raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({ n: i + 1, title: text(s.title, 300), why: text(s.why, 600), status: 'open' as const }))
    .filter(s => s.title);
  const next: HelpReport = { ...report, text: reportText, suggestions, written_by: caller.principal, written_at: new Date().toISOString() };
  if (body.dry_run === true) return { ok: true, data: { report: next, stored: false } };
  await storeReport(deps, next);
  return { ok: true, data: { report: next, stored: true } };
}

/**
 * The operator adds a suggestion to the development queue or rejects it. Queued, it becomes a
 * document in the workspace the operator named (`helpBacklogWorkspace`), written in the operator's
 * name so the workspace's own rules apply.
 */
export async function decideSuggestion(deps: HelpDeps, caller: CallerContext, id: string, n: number, decision: 'queue' | 'reject'): Promise<HelpResult<{ suggestion: HelpSuggestion }>> {
  if (!(await caller.operator())) return refuse(403, 'OPERATOR_ONLY', 'Only an operator decides a report\'s suggestions.');
  const report = await readReport(deps, id);
  const s = report?.suggestions.find(x => x.n === n);
  if (!report || !s) return refuse(404, 'NOT_FOUND', 'No such suggestion.');
  if (s.status !== 'open') return refuse(409, 'DECIDED', `This suggestion is already ${s.status}.`);
  let queuedRef: string | undefined;
  if (decision === 'queue') {
    const target = deps.config.helpBacklogWorkspace;
    if (!target) return refuse(409, 'NO_QUEUE', 'No development queue is set. Name one in the settings: <organism id>/<workspace id>.');
    const [organismId, ...rest] = target.split('/');
    const { writeWorkspaceDocument } = await import('./backlog.js');
    const written = await writeWorkspaceDocument(deps, caller, organismId, rest.join('/'), {
      title: s.title, markdown: `${s.title}\n\n${s.why}\n\nFrom the report ${report.id} of Ask someone who knows.`,
    });
    if (!written.ok) return written;
    queuedRef = written.data.ref;
  }
  const updated: HelpSuggestion = { ...s, status: decision === 'queue' ? 'queued' : 'rejected', ...(queuedRef ? { queued_ref: queuedRef } : {}) };
  await updateRecord(deps.storage, systemGhii(deps.config.nodeId), `${REPORT_PREFIX}${id}`, parseReport, cur => {
    if (!cur) return UNCHANGED;
    return { ...cur, suggestions: cur.suggestions.map(x => (x.n === n ? updated : x)) };
  }, { tag: 'help' });
  emitChange('help-report');
  return { ok: true, data: { suggestion: updated } };
}

/**
 * What the report's writer needs: the figures of one period and the instructions. Without an id, the
 * newest report. With `make` the figures of the month or week that ended are made now, when the job
 * has not made them yet (a node that turned the feature on mid-month, or an operator who wants them).
 */
export async function reportData(deps: HelpDeps, caller: CallerContext, args: { id?: string; make?: 'monthly' | 'weekly' }): Promise<HelpResult<{
  report: HelpReport | null; prompt: string; reports: Awaited<ReturnType<typeof listReports>>;
}>> {
  if (!(await caller.operator())) return refuse(403, 'OPERATOR_ONLY', 'Only an operator reads the report of Ask someone who knows.');
  if (!deps.config.helpEnabled) return refuse(403, 'HELP_DISABLED', 'Ask someone who knows is switched off on this node.');
  let report: HelpReport | null;
  if (args.make) {
    const period = periodOf(args.make, new Date());
    report = await readReport(deps, period.id);
    if (!report) {
      report = await buildReportData(deps, args.make, period);
      await storeReport(deps, report);
    }
  } else if (args.id) {
    report = await readReport(deps, args.id);
  } else {
    const newest = (await listReports(deps))[0];
    report = newest ? await readReport(deps, newest.id) : null;
  }
  // No report yet is the normal first state, not an error: the page shows its empty state.
  if (!report && !args.id) return { ok: true, data: { report: null, prompt: '', reports: await listReports(deps) } };
  if (!report) return refuse(404, 'NOT_FOUND', 'No report with this id. Ask with make "monthly" or "weekly" to make the figures of the period that ended.');
  return { ok: true, data: { report, prompt: reportPrompt(deps, report), reports: await listReports(deps) } };
}

/** The month so far, for the operator's Status view: the same figures, not stored. */
export async function liveStatus(deps: HelpDeps, caller: CallerContext): Promise<HelpResult<{ report: HelpReport }>> {
  if (!(await caller.operator())) return refuse(403, 'OPERATOR_ONLY', 'Only an operator reads this.');
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const report = await buildReportData(deps, 'monthly', { id: from.slice(0, 7), from, to: now.toISOString() });
  delete report.questions;
  return { ok: true, data: { report } };
}

/** The node's own model writes the report, as an operator's call. Failing, the figures stay for the operator's AI. */
async function writeWithNodeAi(deps: HelpDeps, report: HelpReport, operatorGhii: string): Promise<void> {
  try {
    const { completeForOwner } = await import('../ai/completion.js');
    const { OWNER_CALLER } = await import('../ai/caller-context.js');
    const r = await completeForOwner(deps.storage, deps.config, operatorGhii, {
      ...OWNER_CALLER, modelRole: 'reasoning',
      prompt: `${reportPrompt(deps, report)}\n\nAnswer with the report in Markdown. End it with a line "SUGGESTIONS:" followed by one suggestion per line as "title | why".`,
    });
    const [body, tail] = r.content.split(/\nSUGGESTIONS:\s*\n/);
    const suggestions = (tail ?? '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(([t]) => t)
      .slice(0, 8).map(([title, why], i) => ({ n: i + 1, title, why: why ?? '', status: 'open' as const }));
    await storeReport(deps, { ...report, text: body.trim(), suggestions, written_by: systemGhii(deps.config.nodeId), written_at: new Date().toISOString() });
  } catch (err) {
    logger.warn('help: the node model did not write the report; the figures wait for the operator', { id: report.id, error: String(err) });
  }
}

/** The daily job: on the first of the month the monthly report's figures, on Mondays the weekly. */
export async function runHelpReportJob(deps: HelpDeps, now: Date = new Date()): Promise<string[]> {
  const c = deps.config;
  if (!c.helpEnabled || c.helpReportCadence === 'off') return [];
  const due: Array<'monthly' | 'weekly'> = [];
  if ((c.helpReportCadence === 'monthly' || c.helpReportCadence === 'both') && now.getUTCDate() === 1) due.push('monthly');
  if ((c.helpReportCadence === 'weekly' || c.helpReportCadence === 'both') && now.getUTCDay() === 1) due.push('weekly');
  const made: string[] = [];
  const operators = await listOperatorGhiis(deps.storage, c);
  const recipients = [...new Set([...operators, ...c.helpReportRecipients.map(n => `${n}@${c.nodeId}`)])];
  for (const kind of due) {
    const period = periodOf(kind, now);
    if (await readReport(deps, period.id)) continue;
    const report = await buildReportData(deps, kind, period);
    await storeReport(deps, report);
    made.push(period.id);
    for (const r of recipients) {
      await notify(deps.storage, r, {
        type: 'help_report', title: `The figures of Ask someone who knows are ready: ${period.id}`,
        body: c.helpReportWriter === 'node-ai' ? 'The node\'s model writes the report.' : 'Give your AI the prompt on the page, or ask it to write the report with aimeat_help_report_data.',
        link: `/v1/admin?tab=help&report=${period.id}`, i18n: { key: 'help_report', vars: { period: period.id } },
      });
    }
    if (c.helpReportWriter === 'node-ai' && operators[0]) await writeWithNodeAi(deps, report, operators[0]);
  }
  // Reports older than the retention leave.
  const keepAfter = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - c.helpReportRetentionMonths, 1)).toISOString().slice(0, 7);
  for (const r of await listReports(deps)) {
    if (r.id.slice(0, 7) < keepAfter) await deps.storage.deleteMemory(systemGhii(c.nodeId), `${REPORT_PREFIX}${r.id}`);
  }
  return made;
}
