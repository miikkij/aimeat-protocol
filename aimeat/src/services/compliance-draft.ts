/**
 * @file src/services/compliance-draft.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node writes the first draft of its own use-case register, out of what it already
 *   recorded.
 *
 *   WHY THIS EXISTS. The first version showed one proposal per MODEL and a button beside each. On a
 *   real installation that was fifteen rows and a hundred and eighty dropdowns, and the operator's
 *   answer was the correct one: nobody is going to do that, and a platform that accelerates work
 *   must not build an obstacle course out of its own bookkeeping. A model id is not a use of AI
 *   either — twelve models here are four purposes, and the node knows which agent and which app
 *   called each one.
 *
 *   IT GROUPS BY WHAT CALLED THE MODEL, NOT BY THE MODEL. An agent is a named thing with a
 *   description its owner wrote, which is most of a use-case entry already. The models it used
 *   become that entry's model list. An app that uses AI is its own entry, described by its data map
 *   and listing the models the provenance records say its calls ran on.
 *
 *   EVERY APP THAT USES AI, NOT ONLY THE ONES WITH A GAP. Until 2026-10-28 an app entered the draft
 *   only when its publish check had found a disclosure gap. On innokas.aimeat.io that left out
 *   TalentGrid and CV Parser, which send colleagues' and candidates' CV data to a model and say so in
 *   their data maps, so the register never showed the two uses most likely to be high-risk. An app
 *   enters now on any of its own statements (compliance-app-signals.ts).
 *
 *   IT FILLS IN WHAT IT CAN EVIDENCE, MARKS WHAT IT PROPOSES, AND NOTHING ELSE. From the record:
 *   whether this principal's generated content is readable by a visitor (for an app, whether the app
 *   is publicly served at all), and for one that publishes, whether a person was recorded reviewing
 *   it; those come back marked `evidence`. By rule: the Annex III area of an app that uses AI on
 *   employment or biometric data, marked `proposed`, with the reason in `proposals`. Every other
 *   answer is left empty rather than guessed, because a guessed answer that reads as considered is
 *   the one failure this whole feature exists to prevent.
 *
 *   NOTHING HERE IS STORED. It returns a proposal. The caller shows it, somebody approves it, and
 *   the existing write path stores it — so an operator sees what would go in before it goes in.
 * @structure
 *   - RegisterDraft — the proposal, plus what it could and could not derive
 *   - draftRegisterFromActivity(storage, config, opts) — the composer
 * @usage
 *   const draft = await draftRegisterFromActivity(storage, config, { sinceDays: 30 });
 *   res.json(success(config.nodeId, draft));
 * @version-history
 *   v1.3.0 — 2026-10-29 — An app that uses AI with no employment or biometric data in its map gets
 *     "none of these" proposed as its Annex III area, so only the transparency questions are asked
 *     of it (askedWhen); each entry carries its verdict, and the count left to answer is of the
 *     questions each entry is asked.
 *   v1.2.0 — 2026-10-28 — The maker's answers and notes from the app's data map (`aiAct`) enter the
 *     draft marked `maker`, below evidence and over a rule's proposal; an entry already stored gets
 *     them in `makerUpdates` for the questions it has not answered (Jouni: the maker answers for
 *     their own app, the administrator approves).
 *   v1.1.0 — 2026-10-28 — Every app that uses AI gets an entry, described from its data map, with its
 *     models from the provenance records its calls minted, and the Annex III area proposed when its
 *     map holds employment or biometric data. "Publishes publicly" is evidenced by content a visitor
 *     can read, not by a record existing: on innokas.aimeat.io, where every app is parked, it had
 *     answered yes. Entries the stored register already holds are not proposed again, as this header
 *     had promised and the code had not done. The provenance read pages past the storage's 500-row
 *     page instead of asking for 2000 and getting 500.
 *   v1.0.1 — 2026-08-23 — Ids are unique within a draft. Two agents sharing a display name slugged
 *     to the same id and the register refused the whole draft, so the button did nothing on any
 *     node where a name repeated.
 *   v1.0.0 — 2026-08-23 — BR-02. Replaces the per-model proposal list.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AiProvenanceListQuery, AiProvenanceRecordRow } from '../storage/types/ai-provenance.js';
import type { ComplianceAnswerSource, ComplianceUseCase } from './compliance-register.js';
import { classifyUseCase, effectiveQuestionnaire, readUseCases, type ComplianceRiskVerdict } from './compliance-register.js';
import { appAiSignals } from './compliance-app-signals.js';
import { readAppDataMap } from './data-map/data-map-store.js';
import type { AiActStatement } from './data-map/data-map-types.js';
import { localAccountName } from '../utils/gaii.js';

/** Provenance rows read per draft. Bounded: this is a page of recent activity, not a scan. */
const PROVENANCE_SAMPLE = 2000;
/** The storage's own page cap (listAiProvenance clamps `limit` to it). */
const PROVENANCE_PAGE = 500;
/** How many apps are read, as the records-of-processing drafts read them. */
const APP_SCAN = 1000;

/** The question ids this can answer from the record or propose by rule. */
const Q = {
  publishesPublicly: 'q-publishes-publicly',
  humanReviews: 'q-human-reviews-before-publish',
  annex3: 'q-annex3-area',
} as const;

/** One answer the draft proposes by rule, with the reason a person reads before deciding. */
export interface DraftProposal {
  usecase_id: string;
  question: string;
  value: unknown;
  /** The reason in English, for a machine or a log. */
  reason: string;
  /**
   * The same reason as data, for a page that says it in its reader's language. Null for "none of
   * these areas", which rests on what the map does NOT hold: no employment or biometric data.
   */
  basis: { domain: string; source: 'evidence' | 'proposed'; rows: string[]; words: string[] } | null;
}

/** The reason beside a proposed "none of these" area. */
const NO_AREA_REASON = 'The data map holds no employment or biometric data, the two Annex III areas a data map can show. '
  + 'The other areas (education, credit, critical infrastructure and the rest) are a person\'s call.';

/**
 * The maker's answers for an entry the stored register already holds: the questions that entry has
 * not answered, and the notes it has none for. The caller merges them into the stored entry, never
 * over an answer somebody already saved.
 */
export interface MakerUpdate {
  usecase_id: string;
  answers: Record<string, unknown>;
  answerSources: Record<string, ComplianceAnswerSource>;
  answerNotes: Record<string, string>;
}

export interface RegisterDraft {
  /** The proposed entries, each with its verdict. Not stored: the caller shows these and somebody approves them. */
  usecases: Array<ComplianceUseCase & { risk: ComplianceRiskVerdict }>;
  /** Every `proposed` answer in `usecases`, with why. */
  proposals: DraftProposal[];
  /** The maker's answers that stored entries do not carry yet. */
  makerUpdates: MakerUpdate[];
  /** How many answers came from the record, from apps' makers and by rule, and how many are left. */
  counts: { entries: number; answeredFromEvidence: number; fromMaker: number; proposed: number; leftToAnswer: number };
  /** What this draft could NOT work out, in the same spirit as the report's own limits. */
  notes: string[];
}

/** Read a provenance query page by page, up to the sample. */
async function provenanceRows(storage: Storage, query: AiProvenanceListQuery): Promise<AiProvenanceRecordRow[]> {
  const out: AiProvenanceRecordRow[] = [];
  for (let offset = 0; offset < PROVENANCE_SAMPLE; offset += PROVENANCE_PAGE) {
    const { items } = await storage.listAiProvenance({ ...query, limit: PROVENANCE_PAGE, offset });
    out.push(...items);
    if (items.length < PROVENANCE_PAGE) break;
  }
  return out;
}

/** What one principal's provenance rows say about it. */
interface PrincipalEvidence {
  /** It generated something during the period. */
  generated: boolean;
  /** Some of it is readable by an anonymous visitor now. */
  published: boolean;
  /** A person was recorded reviewing some of the public part. */
  reviewed: boolean;
}

/** `owner/filename-without-.html`, lower case: the key an app's calls and its listing agree on. */
const appKey = (owner: string, filename: string): string =>
  `${owner}/${filename.replace(/\.html$/i, '')}`.toLowerCase();

/**
 * Publishing evidence per principal and models per app, read once for the whole draft.
 *
 * Two reads: every record of the period, and the public ones. A record existing says only that
 * something was generated; whether anyone outside can read it is the public read's answer, which is
 * the same visibility rule the transparency report counts with.
 */
async function readActivity(storage: Storage, since: string): Promise<{
  byPrincipal: Map<string, PrincipalEvidence>;
  modelsByApp: Map<string, Set<string>>;
}> {
  const [all, pub] = await Promise.all([
    provenanceRows(storage, { since }),
    provenanceRows(storage, { since, publicOnly: true }),
  ]);
  const byPrincipal = new Map<string, PrincipalEvidence>();
  const modelsByApp = new Map<string, Set<string>>();
  const at = (p: string) => {
    const e = byPrincipal.get(p) ?? { generated: false, published: false, reviewed: false };
    byPrincipal.set(p, e);
    return e;
  };
  for (const row of all) {
    at(row.principal).generated = true;
    // The node records the calling app as the generator's pipeline: `owner/filename` from the app's
    // grant, never a name the request body chose (services/ai/completion.ts).
    const pipeline = row.record?.generator?.pipeline;
    const model = row.record?.generator?.model;
    if (pipeline && model && pipeline.includes('/')) {
      const [owner, ...rest] = pipeline.split('/');
      const key = appKey(owner, rest.join('/'));
      const set = modelsByApp.get(key) ?? new Set<string>();
      set.add(model);
      modelsByApp.set(key, set);
    }
  }
  for (const row of pub) {
    const e = at(row.principal);
    e.generated = true;
    e.published = true;
    const involvement = row.record?.humanInvolvement;
    if (involvement === 'editorial-control' || involvement === 'full-human') e.reviewed = true;
  }
  return { byPrincipal, modelsByApp };
}

/**
 * A stable, readable id from a name that may contain anything, unique within one draft.
 *
 * The name is NOT unique and the id has to be: two agents may carry the same display name, and on a
 * node where they did, every one of them slugged to `uc-ledgerbot` and the register refused the
 * whole draft as duplicate ids. So the caller keeps a set and a collision takes a numeric suffix.
 * Deterministic, because the callers are walked in a fixed order, and readable, which is the reason
 * the id comes from the name rather than from the GAII in the first place.
 */
function slugOf(prefix: string, raw: string, used: Set<string>): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const base = `${prefix}-${slug || 'unnamed'}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/**
 * An app served to anyone who asks: not parked, not hidden by the operator, no access code, and no
 * `access` limit to signed-in accounts or one organism. The provenance rule's own definition of a
 * public app (PUBLICLY_LINKED_CONTAINERS) plus the access limit, which also keeps a stranger out.
 */
const publiclyServed = (app: { parked?: boolean; operatorHidden?: boolean; accessCode?: string; access?: string }): boolean =>
  !app.parked && !app.operatorHidden && !app.accessCode && !app.access;

/**
 * Compose the draft.
 *
 * Existing entries are respected: an id, a title or an app the stored register already holds is not
 * proposed again, so running this after a partial register adds what is missing rather than
 * duplicating what is there.
 */
export async function draftRegisterFromActivity(
  storage: Storage, config: AimeatConfig, opts: { sinceDays?: number } = {},
): Promise<RegisterDraft> {
  const days = Math.min(Math.max(opts.sinceDays ?? 30, 1), 3650);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [usage, agents, activity, questionnaire, apps, stored] = await Promise.all([
    storage.queryUsageDailyAllOwners({ from: since.slice(0, 10), to: new Date().toISOString().slice(0, 10) }),
    storage.listAgents(),
    readActivity(storage, since),
    effectiveQuestionnaire(storage, config.nodeId),
    storage.listApps({ adminView: true, limit: APP_SCAN }),
    readUseCases(storage, config.nodeId),
  ]);

  const questionIds = new Set(questionnaire.questions.map(q => q.id));
  const agentByGaii = new Map(agents.map(a => [a.gaii, a]));
  const storedIds = new Set(stored.map(u => u.id));
  const storedTitles = new Set(stored.map(u => u.title));
  const storedByApp = new Map<string, ComplianceUseCase>();
  for (const u of stored) {
    for (const ref of u.apps ?? []) {
      const [owner, ...rest] = ref.split('/');
      storedByApp.set(appKey(owner, rest.join('/')), u);
    }
  }

  /**
   * The maker's answers the CURRENT question set can take: a yes/no for a yes/no question, one of the
   * options for a choice. An answer of the wrong shape is left out rather than coerced, because a
   * coerced answer reads as the maker's and is not.
   */
  const makerAnswers = (stmt: AiActStatement | undefined): { answers: Record<string, unknown>; notes: Record<string, string> } => {
    const answers: Record<string, unknown> = {};
    const notes: Record<string, string> = {};
    for (const q of questionnaire.questions) {
      const a = stmt?.answers?.[q.id];
      const fits = q.type === 'boolean' ? typeof a === 'boolean' : (q.options || []).some(o => o.value === a);
      if (fits) answers[q.id] = a;
      const n = stmt?.notes?.[q.id];
      if (typeof n === 'string' && n.trim()) notes[q.id] = n.trim().slice(0, 2000);
    }
    return { answers, notes };
  };
  let fromMaker = 0;
  const makerUpdates: MakerUpdate[] = [];

  let answeredFromEvidence = 0;
  const usecases: ComplianceUseCase[] = [];
  const proposals: DraftProposal[] = [];
  // Stored ids are taken: a drafted entry never reuses one, so a merge by id cannot overwrite.
  const usedIds = new Set(storedIds);

  /** Fill one answer, only when the CURRENT question set asks it: the set is data an operator edits. */
  const answer = (
    answers: Record<string, unknown>, sources: Record<string, ComplianceAnswerSource>,
    q: string, value: unknown, source: ComplianceAnswerSource,
  ): boolean => {
    if (!questionIds.has(q)) return false;
    answers[q] = value;
    sources[q] = source;
    if (source === 'evidence') answeredFromEvidence++;
    return true;
  };

  // ── Group the models by what called them ──────────────────────────────────────────────────
  const byCaller = new Map<string, { models: Set<string>; owner: string; calls: number }>();
  for (const row of usage) {
    // An unattributed row still happened, and hiding it would be the report under-reporting. It
    // lands in one entry the operator can name, rather than in no entry at all.
    const key = row.agentGaii || '(unattributed)';
    const g = byCaller.get(key) ?? { models: new Set<string>(), owner: row.ownerGhii, calls: 0 };
    if (row.model) g.models.add(row.model);
    g.calls += row.calls;
    byCaller.set(key, g);
  }

  for (const [caller, group] of byCaller) {
    const agent = agentByGaii.get(caller);
    const title = agent?.displayName || agent?.name || (caller === '(unattributed)' ? 'AI use with no agent recorded' : caller);
    if (storedTitles.has(title)) continue;
    const ev = activity.byPrincipal.get(caller);
    const answers: Record<string, unknown> = {};
    const answerSources: Record<string, ComplianceAnswerSource> = {};
    // "Does it publish" is answered only when the record can say: generated content that a visitor
    // can read is a yes, generated content none of which is public is a no. No record is silence.
    if (ev?.generated) {
      answer(answers, answerSources, Q.publishesPublicly, ev.published, 'evidence');
      if (ev.published) answer(answers, answerSources, Q.humanReviews, ev.reviewed, 'evidence');
    }
    usecases.push({
      id: slugOf('uc', title, usedIds),
      title,
      // The agent's own description, written by whoever created it. Better than anything derivable,
      // and left empty rather than invented when there is none.
      ...(agent?.description ? { description: agent.description } : {}),
      ownerGhii: group.owner || null,
      models: [...group.models].sort(),
      ...(agent?.capabilities?.length ? { systems: agent.capabilities } : {}),
      answers,
      answerSources,
    });
  }

  // ── Apps that use AI, by their own statements ─────────────────────────────────────────────
  let proposed = 0;
  for (const app of apps.apps) {
    const owner = localAccountName(app.ownerName ?? app.ownerGaii ?? '');
    if (!owner) continue;
    const key = appKey(owner, app.filename);
    const storedEntry = storedByApp.get(key);
    const map = await readAppDataMap(storage, `${owner}@${config.nodeId}`, app.filename.replace(/\.html$/i, ''));
    const maker = makerAnswers(map?.aiAct);
    if (storedEntry) {
      // Already in the register: only what the maker answered and nobody saved yet, never over a
      // saved answer. A note the entry has none for comes with it.
      const u: MakerUpdate = { usecase_id: storedEntry.id, answers: {}, answerSources: {}, answerNotes: {} };
      for (const [q, a] of Object.entries(maker.answers)) {
        if (storedEntry.answers?.[q] !== undefined) continue;
        u.answers[q] = a;
        u.answerSources[q] = 'maker';
      }
      for (const [q, n] of Object.entries(maker.notes)) if (!storedEntry.answerNotes?.[q]) u.answerNotes[q] = n;
      if (Object.keys(u.answers).length || Object.keys(u.answerNotes).length) makerUpdates.push(u);
      continue;
    }
    const signals = appAiSignals(map, app.manifest?.aiPosture);
    if (!signals.usesAi) continue;

    const ref = `${owner}/${app.filename}`;
    const title = app.manifest?.name || app.filename.replace(/\.html$/i, '');
    const id = slugOf('uc-app', ref, usedIds);
    const answers: Record<string, unknown> = {};
    const answerSources: Record<string, ComplianceAnswerSource> = {};
    // An app nobody outside can open publishes nothing to the public through itself: evidence. A
    // publicly served app may or may not show generated content to a visitor, so that stays open.
    if (!publiclyServed(app)) answer(answers, answerSources, Q.publishesPublicly, false, 'evidence');
    // The rule's proposal stays in `proposals` even when the maker answered the same question: a
    // maker's "none of these" beside a rule's "employment" is the pair the administrator decides on.
    if (signals.annex3) {
      proposals.push({ usecase_id: id, question: Q.annex3, value: signals.annex3.area, reason: signals.annex3.reason, basis: signals.annex3.basis });
      if (!(Q.annex3 in maker.answers) && answer(answers, answerSources, Q.annex3, signals.annex3.area, 'proposed')) proposed++;
    } else if (!(Q.annex3 in maker.answers) && questionnaire.questions.some(q => q.id === Q.annex3 && (q.options || []).some(o => o.value === 'none'))) {
      // No employment or biometric data in the map: "none of these" is proposed, so the full survey
      // is not asked until a person or the maker names an area (Jouni, 2026-10-29).
      proposals.push({ usecase_id: id, question: Q.annex3, value: 'none', reason: NO_AREA_REASON, basis: null });
      if (answer(answers, answerSources, Q.annex3, 'none', 'proposed')) proposed++;
    }
    // The maker's answers, below what the record evidences and over what a rule proposes.
    for (const [q, a] of Object.entries(maker.answers)) {
      if (answerSources[q] === 'evidence') continue;
      if (answer(answers, answerSources, q, a, 'maker')) fromMaker++;
    }
    const domains = signals.domains.map(d => `${d.domain} (${d.source === 'evidence' ? 'stated' : 'proposed'}: ${d.rows.join(', ')})`);
    usecases.push({
      id,
      title,
      description: (map?.what || app.manifest?.description || '').slice(0, 4000) || undefined,
      ownerGhii: `${owner}@${config.nodeId}`,
      apps: [ref],
      models: [...(activity.modelsByApp.get(key) ?? [])].sort(),
      systems: signals.aiEvidence.slice(0, 100),
      ...(map?.usedFor ? { purpose: map.usedFor.slice(0, 2000) } : {}),
      ...(signals.personal ? {
        dataSubjects: `Personal data per the app's data map${domains.length ? `; domains: ${domains.join('; ')}` : ''}.`.slice(0, 2000),
      } : {}),
      answers,
      answerSources,
      ...(Object.keys(maker.notes).length ? { answerNotes: maker.notes } : {}),
    });
  }

  // Each entry with its verdict, so a page shows the questions asked of it and the class its answers
  // give; the register's write strips `risk`, which is derived on read.
  const withRisk = usecases.map(u => ({ ...u, risk: classifyUseCase(u, questionnaire) }));
  return {
    usecases: withRisk,
    proposals,
    makerUpdates,
    counts: {
      entries: usecases.length,
      answeredFromEvidence,
      fromMaker,
      proposed,
      // The questions still open, of the ones each entry is asked (askedWhen), not of all of them.
      leftToAnswer: withRisk.reduce((n, u) => n + u.risk.unanswered.length, 0),
    },
    notes: [
      'Grouped by what called the model, not by the model: an agent is a named thing with a purpose, '
        + 'and a model id is not a use of AI. Every app that uses AI is its own entry, described by its data map.',
      'The titles, descriptions and capabilities are the ones whoever created each agent or app wrote. '
        + 'Nothing here was invented.',
      'Answers read from the record are marked evidence. An app\'s Annex III area is marked proposed when its '
        + 'data map holds employment or biometric data and the app uses AI, and "none of these" is proposed when it '
        + 'holds neither; the reason is in proposals, and a person decides. Every other answer is left empty rather than guessed.',
      'Outside the Annex III areas only the area and the two transparency questions are asked; the rest of the set '
        + 'waits for an area (each question\'s askedWhen, and each entry\'s risk.notAsked).',
      'An app\'s maker answers the questions in the app\'s data map (aiAct), with a note each; those answers are marked '
        + 'maker, below what the record evidences and over what a rule proposes. A stored entry gets the maker\'s answers '
        + 'to the questions it has not answered, in makerUpdates, never over a saved answer.',
      'Entries the stored register already holds are not proposed again.',
      'Nothing is stored until somebody saves it.',
    ],
  };
}
