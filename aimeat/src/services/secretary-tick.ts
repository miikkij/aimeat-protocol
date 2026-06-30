/**
 * @file secretary-tick.ts
 * @description Pure (storage-free) helpers for the Secretary's autonomous tick (Phase 4 → P1 action
 *   loop). Kept out of scheduler.ts so the routing/guard logic can be unit-tested directly without a
 *   live server or AI key:
 *     - hasWorkToDo()            — the cheap "anything to do?" pre-check predicate (P1-B): true iff the
 *                                  active context has open goals, due decisions, or pending intake.
 *     - classifySecretaryActions() — route a model-proposed action list through the context's autonomy
 *                                  bands (P1-A): act → perform, draft/ask → inbox card, off/unsupported → drop.
 *     - ledgerSpentToday() / budgetExceeded() — the soft per-day cost guard math (P1-C). The Secretary's
 *                                  autonomous spend is metered in "morsels" where one paid autonomous AI
 *                                  operation (the review of one due decision, or the per-tick action
 *                                  generation) counts as 1 morsel; `policy.dailyMorselBudget` caps the
 *                                  per-context daily total. null budget = no limit; 0 = no autonomous spend.
 *   The capability→action-kind map decides what the tick can actually do on its own as the owner: NOTE
 *   capabilities file a note into the self-organism; FEED capabilities append to the Home feed; anything
 *   else is "unsupported" and dropped (surfaced in the briefing instead of fake-acting). See
 *   docs/plans/2026-06-24-secretary-p1-fix-prompt.md and docs/plans/2026-06-23-secretary-feature.md (§6/§7).
 * @structure ACTION_KINDS · actionKind · classifySecretaryActions · routeRoutineStep ·
 *   sanitizeProposedQuickActions · hasWorkToDo · ledgerSpentToday · budgetExceeded · (P2-E) tokenize ·
 *   scoreContexts · routeIntake · learnCorrection · (G1) routeTickNote
 * @usage import { classifySecretaryActions, routeRoutineStep, sanitizeProposedQuickActions, hasWorkToDo } from './secretary-tick.js';
 * @version-history
 *   v0.10.0 — 2026-06-28 — TriggerLike.action gains workflowId/specialistName/prompt so a trigger can
 *     BIND a workflow/specialist run to its fire (the scheduler tick carries it out).
 *   v0.10.0 — 2026-06-30 — Learning loop helpers: selectLessons (A — highest-signal reviewed-decision
 *     lessons for the tick prompt) + poorDecisionCluster / POOR_SCORE_THRESHOLD (B — the cluster a gated
 *     learned-rule proposal is based on). Both pure + unit-tested in e2e-secretary.
 *   v0.9.0 — 2026-06-28 — G4: deriveRoutineActions uses actionKind() (note|feed) as the single
 *     capability→kind map for tick-performability + renames runFileSteps→runSteps; the tick carries out
 *     briefing/reminders as FEED entries (not notes), aligning all three call sites.
 *   v0.8.0 — 2026-06-28 — G2: recurring routines — cadenceMs / routineDueForRearm / rearmRoutine (the
 *     tick re-arms a completed routine on its cadence: steps → pending, re-activated, next run scheduled).
 *   v0.7.0 — 2026-06-28 — G5: deriveRoutineActions emits a structured `labelKind` + `summary` (not a
 *     server-composed English `text`) so the frontend renders the action-item label via t() (en+fi).
 *   v0.6.0 — 2026-06-28 — B5: deriveRoutineActions() — band-driven routine advancement for the tick
 *     (act+file → run, act+discover/delegate & draft|ask → action-item, delegated → check-result) +
 *     actionItemKey() de-dup. routeRoutineStep now has a production caller (the tick), not just E2E.
 *   v0.5.0 — 2026-06-27 — B3: sanitizeProposedQuickActions() — the canonical security RULE for dynamic
 *     quick actions (brain/secretary may only propose prompt|compose, never a run verb). The frontend
 *     (sanitizeQuickActions) enforces it at author time; secretary.config is the owner's own private blob
 *     (no server-side write validation), so this is the tested reference spec, asserted in e2e-secretary.
 *   v0.4.0 — 2026-06-27 — B2: routeRoutineStep() — pure band-gating for a "What's next" Routine step
 *     (act → run · draft|ask → confirm · off → skip), shared by the view + asserted in e2e-secretary.
 *   v0.3.0 — 2026-06-24 — G1: routeTickNote() — the autonomous tick's cross-context note-routing decision.
 *   v0.2.0 — 2026-06-24 — P2-E: cross-context intake routing + corrections-teach (pure, AI-free).
 *   v0.1.0 — 2026-06-24 — P1: tick action loop + idle pre-check + soft budget guard.
 */

/** Capabilities the tick can perform autonomously as the owner, grouped by how they're carried out. */
const NOTE_CAPS = new Set(['file_intake', 'curate_knowledge']);
const FEED_CAPS = new Set(['briefing', 'reminders']);

export type ActionKind = 'note' | 'feed' | 'unsupported';

/** How (if at all) a proposed capability can be carried out by the autonomous tick. */
export function actionKind(capability: string): ActionKind {
  if (NOTE_CAPS.has(capability)) return 'note';
  if (FEED_CAPS.has(capability)) return 'feed';
  return 'unsupported';
}

/** A model-proposed action after band routing. */
export interface RoutedAction {
  capability: string;
  summary: string;
  payload: Record<string, unknown>;
  kind: ActionKind;
  band: string;
}

export interface ClassifiedActions {
  /** band=act + a performable kind → the tick performs it now. */
  acts: RoutedAction[];
  /** band=draft/ask → the tick posts an inbox decision card and waits for the owner. */
  asks: RoutedAction[];
  /** band=off, an unsupported capability, or a malformed entry → dropped (mentioned in the briefing). */
  dropped: RoutedAction[];
}

/**
 * Route a model-proposed action list through the active context's autonomy bands (P1-A).
 * `bands` is `policy.bands` (capabilityId → 'act'|'draft'|'ask'|'off'); a missing band defaults to the
 * conservative 'ask' so nothing acts silently. Pure: no storage, no AI — safe to unit-test directly.
 */
export function classifySecretaryActions(
  actions: unknown,
  bands: Record<string, string> | undefined,
): ClassifiedActions {
  const acts: RoutedAction[] = [];
  const asks: RoutedAction[] = [];
  const dropped: RoutedAction[] = [];
  const list = Array.isArray(actions) ? actions : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const capability = String(r.capability ?? '').trim();
    const summary = String(r.summary ?? '').trim();
    if (!capability || !summary) continue;
    const kind = actionKind(capability);
    const band = (bands && typeof bands[capability] === 'string') ? bands[capability] : 'ask';
    const payload = (r.payload && typeof r.payload === 'object') ? r.payload as Record<string, unknown> : {};
    const item: RoutedAction = { capability, summary, payload, kind, band };
    if (band === 'off' || kind === 'unsupported') dropped.push(item);
    else if (band === 'act') acts.push(item);
    else asks.push(item); // 'draft' and 'ask' both surface a decision card
  }
  return { acts, asks, dropped };
}

/** Autonomy bands, least → most restrictive (mirrors public/js/services/secretary-policy.js BANDS). */
export const BANDS = ['act', 'draft', 'ask', 'off'] as const;

/** How an approved Routine step should be carried out, decided purely from its band (B2). */
export type StepDisposition = 'run' | 'confirm' | 'skip';

/** Result of band-gating one Routine step (the "What's next" approve flow). */
export interface RoutineStepRoute {
  /** The effective band: a valid step-level override wins, else the policy band, else conservative 'ask'. */
  band: string;
  /** run = act (perform when reached) · confirm = draft|ask (owner approves first) · skip = off (not run). */
  disposition: StepDisposition;
}

/**
 * Band-gate a single Routine step (B2 "What's next"). A step may carry its own `band` (seeded from the
 * policy taxonomy when the routine is proposed); if absent or invalid, fall back to the context's
 * `policy.bands[capability]`, else the conservative 'ask'. The disposition is band-only — act → run,
 * draft|ask → confirm (owner approves first), off → skip — so it can be unit-tested without storage or AI.
 * (Whether a capability has a B2 executor is a separate, frontend concern; delegation lands in B4.)
 * G6 MIRROR: public/js/services/secretary-rules.js::routeRoutineStep — keep IDENTICAL; e2e-secretary's
 * parity test imports both and asserts they agree on a shared vector table.
 */
export function routeRoutineStep(
  step: { capability?: unknown; band?: unknown } | null | undefined,
  bands: Record<string, string> | undefined,
): RoutineStepRoute {
  const capability = String(step?.capability ?? '').trim();
  const override = typeof step?.band === 'string' && (BANDS as readonly string[]).includes(step.band) ? step.band : null;
  const band = override
    ?? ((bands && typeof bands[capability] === 'string') ? bands[capability] : 'ask');
  const disposition: StepDisposition = band === 'off' ? 'skip' : band === 'act' ? 'run' : 'confirm';
  return { band, disposition };
}

/** Loose shapes for the view-authored Routine + ActionItem records the tick reads/advances (B2/B5). */
export interface RoutineStepLike { id?: string; capability?: string; summary?: string; band?: string; status?: string; result?: { taskId?: string; agentName?: string; summary?: string } | null; }
export interface RoutineLike { id?: string; title?: string; status?: string; steps?: RoutineStepLike[]; results?: Array<{ ts?: string; summary?: string }>; cadence?: string | null; lastRunAt?: string | null; nextRunAt?: string | null; }
// G5: action-items carry a STRUCTURED `labelKind` + the step `summary` so the FRONTEND renders the label
// via t() (the tick is server-side and must not compose a fixed-language string). `text` is kept optional
// for any legacy item written before G5 (the frontend falls back to it).
export interface ActionItem { id: string; labelKind?: string; summary?: string; text?: string; suggestedAction: { kind: string; routineId?: string; stepId?: string }; source: string; createdAt: string; status: 'open' | 'done'; }
/** An action-item the tick wants to surface, before the tick stamps id/createdAt/status. */
export interface ActionItemDraft { labelKind: 'approve' | 'ready' | 'check-delegate'; summary: string; suggestedAction: { kind: 'advance' | 'check-delegate'; routineId: string; stepId?: string }; source: string; }

// ── Learning loop (Phase 5+): feed reviewed-decision scores back into behaviour ──

/** A reviewed-decision lesson the tick threads into its next prompt (close the loop, not just record it). */
export interface Lesson { score: number; decision: string; verdict: string; }

/**
 * Select the most relevant LESSONS from the owner's reviewed decisions for one context — the
 * highest-signal ones (a clearly-good or clearly-poor score) first, newest as the tiebreak. The tick
 * injects these into its briefing/action prompt so the next cycle repeats what scored well and avoids
 * what scored poorly, instead of the scores being a dead-end record. Pure (no storage/AI) — unit-tested.
 * `records` are the raw `secretary.decision.*` values; only `status:'reviewed'` with a numeric score count.
 */
export function selectLessons(records: Array<Record<string, unknown>>, contextId: string, limit = 6): Lesson[] {
  return records
    .filter((d) => d && d.status === 'reviewed' && typeof d.score === 'number' && (!d.contextId || d.contextId === contextId))
    .map((d) => ({ score: Math.max(0, Math.min(100, Number(d.score))), decision: String(d.decision || ''), verdict: String(d.verdict || ''), reviewedAt: String(d.reviewedAt || '') }))
    .filter((l) => l.decision)
    // Signal = distance from a neutral 50 (a 95 or a 10 teaches more than a 55); newest breaks ties.
    .sort((a, b) => (Math.abs(b.score - 50) - Math.abs(a.score - 50)) || b.reviewedAt.localeCompare(a.reviewedAt))
    .slice(0, Math.max(0, limit))
    .map(({ score, decision, verdict }) => ({ score, decision, verdict }));
}

/** Decisions whose review scored at/below this are "poor" — the basis for a learned-rule proposal (B). */
export const POOR_SCORE_THRESHOLD = 50;

/**
 * B (learned-rule proposal): the cluster of reviewed decisions a proposal should be based on — those in
 * this context that scored POORLY (≤ threshold) and haven't already fed a proposal (`proposalUsed`).
 * Returns [] unless there's a real cluster (≥ `min`), so a one-off bad decision doesn't trigger a rule.
 * Pure (no storage/AI) — the tick adds the AI call + the gated inbox card around it. Unit-tested.
 */
export function poorDecisionCluster(records: Array<Record<string, unknown>>, contextId: string, min = 3, max = 8): Array<Record<string, unknown>> {
  const poor = records.filter((d) => d && d.status === 'reviewed' && typeof d.score === 'number'
    && (d.score as number) <= POOR_SCORE_THRESHOLD && (!d.contextId || d.contextId === contextId) && !d.proposalUsed);
  return poor.length >= min ? poor.slice(0, max) : [];
}

// ── G2: recurring routines ── the tick re-arms a completed routine on its cadence so it runs again.
/** Supported routine cadences → their interval in ms (null = run-once / no recurrence). */
export function cadenceMs(cadence: string | null | undefined): number | null {
  if (cadence === 'daily') return 24 * 3600 * 1000;
  if (cadence === 'weekly') return 7 * 24 * 3600 * 1000;
  return null;
}

/**
 * Is a routine due to be re-armed (G2)? True iff it has a real cadence, a full run has COMPLETED
 * (status 'done'), and the cadence interval has elapsed since its last run (nextRunAt if set, else
 * lastRunAt + interval). Pure — the tick calls this, then rearmRoutine, then persists.
 */
export function routineDueForRearm(routine: RoutineLike, nowMs: number): boolean {
  const ms = cadenceMs(routine.cadence);
  if (ms === null) return false;
  if (routine.status !== 'done') return false;
  const next = routine.nextRunAt ? Date.parse(routine.nextRunAt)
    : (routine.lastRunAt ? Date.parse(routine.lastRunAt) + ms : nowMs);
  return !Number.isNaN(next) && next <= nowMs;
}

/** Re-arm a due routine (G2): reset every step to 'pending' (clearing its result), re-activate the
 *  routine, and schedule the next run. The prior run's `results` log is kept. Pure. */
export function rearmRoutine(routine: RoutineLike, nowIso: string, nowMs: number): RoutineLike {
  const ms = cadenceMs(routine.cadence) ?? 0;
  const steps = (routine.steps || []).map((s) => ({ ...s, status: 'pending', result: null }));
  return { ...routine, steps, status: 'active', lastRunAt: nowIso, nextRunAt: new Date(nowMs + ms).toISOString() };
}

/** A stable key for an action item (so the tick doesn't re-add the same one every fire). */
export function actionItemKey(a: { suggestedAction?: { kind?: string; routineId?: string; stepId?: string }; source?: string }): string {
  const sa = a.suggestedAction || {};
  return `${sa.kind || ''}:${sa.routineId || a.source || ''}:${sa.stepId || ''}`;
}

/**
 * B5 — band-driven routine advancement for the autonomous tick. For each ACTIVE routine in a context,
 * decide (purely, from the step's band via routeRoutineStep) what the tick should do with its next
 * pending step, plus surface any delegated step whose result should be checked:
 *   - act + a tick-PERFORMABLE capability (G4: actionKind ∈ note|feed — file a note OR append a feed
 *     entry; the tick carries out the right one) → `runSteps` (the tick performs it + advances).
 *   - act + discover/delegate (needs a target/plumbing the tick lacks) → an "advance" action-item.
 *   - draft|ask → an "approve" action-item (the owner decides).
 *   - off → nothing.
 *   - any step already 'delegated' (a task is out) → a "check-delegate" action-item.
 * Pure: no storage/AI. The tick stamps ids + dedupes against existing open items (actionItemKey).
 */
export function deriveRoutineActions(
  context: { routines?: RoutineLike[]; policy?: { bands?: Record<string, string> } },
): { items: ActionItemDraft[]; runSteps: Array<{ routineId: string; stepId: string }> } {
  const items: ActionItemDraft[] = [];
  const runSteps: Array<{ routineId: string; stepId: string }> = [];
  const bands = context.policy?.bands;
  for (const r of (context.routines || [])) {
    if (r.status !== 'active' || !r.id) continue;
    // Delegated steps with a task out → surface a check-result item (the result flowing home).
    for (const s of (r.steps || [])) {
      if (s.status === 'delegated' && s.result?.taskId && s.id) {
        items.push({ labelKind: 'check-delegate', summary: String(s.summary || ''), suggestedAction: { kind: 'check-delegate', routineId: r.id, stepId: s.id }, source: r.id });
      }
    }
    const next = (r.steps || []).find((s) => s.status === 'pending');
    if (!next || !next.id) continue;
    const route = routeRoutineStep(next, bands);
    // G4: a step is tick-performable iff actionKind says note OR feed (the single capability→kind map).
    if (route.disposition === 'run' && actionKind(String(next.capability)) !== 'unsupported') {
      runSteps.push({ routineId: r.id, stepId: next.id });
    } else if (route.disposition === 'run') {
      items.push({ labelKind: 'ready', summary: String(next.summary || ''), suggestedAction: { kind: 'advance', routineId: r.id, stepId: next.id }, source: r.id });
    } else if (route.disposition === 'confirm') {
      items.push({ labelKind: 'approve', summary: String(next.summary || ''), suggestedAction: { kind: 'advance', routineId: r.id, stepId: next.id }, source: r.id });
    }
    // disposition === 'skip' (off) → nothing to surface.
  }
  return { items, runSteps };
}

/** A dynamic quick action (B3): brain-seeded or secretary-proposed shortcut shown in the quick-action row. */
export interface QuickAction {
  label: string;
  kind: 'compose' | 'prompt';
  target?: string; // compose → which input to focus: 'plan' | 'find' | 'note'
  prompt?: string; // prompt → canned message sent to the chat
  source: string;  // 'brain' | 'secretary'
  status: 'proposed' | 'active';
}

/** Inputs a `compose` quick action may focus (must match the working cards the view renders). */
const QUICK_COMPOSE_TARGETS = new Set(['plan', 'find', 'note']);

/**
 * Sanitize brain-seeded / secretary-proposed quick actions (B3). The SECURITY boundary: a non-core
 * action may ONLY be 'prompt' (a canned chat message) or 'compose' (focus an existing input) — never a
 * 'run' verb (those are app-defined core actions). Anything that isn't a well-formed prompt/compose is
 * dropped. Pure: no storage/AI. `id`/`createdAt` are added by the caller (kept out so the function stays
 * deterministic for tests). G6 MIRROR: public/js/services/secretary-rules.js::sanitizeProposedQuickActions
 * — keep IDENTICAL; e2e-secretary's parity test imports both and asserts identical output.
 */
export function sanitizeProposedQuickActions(raw: unknown, source: string, status: 'proposed' | 'active' = 'proposed'): QuickAction[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: QuickAction[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const label = String(o.label ?? '').trim().slice(0, 40);
    const kind = String(o.kind ?? '').trim();
    if (!label) continue;
    if (kind === 'compose') {
      const target = String(o.target ?? '').trim();
      if (!QUICK_COMPOSE_TARGETS.has(target)) continue;
      out.push({ label, kind: 'compose', target, source, status });
    } else if (kind === 'prompt') {
      const prompt = String(o.prompt ?? '').trim().slice(0, 500);
      if (!prompt) continue;
      out.push({ label, kind: 'prompt', prompt, source, status });
    }
    // kind === 'run' (or anything else) → dropped: the explicit security boundary.
  }
  return out.slice(0, 6);
}

/**
 * G8: true iff a STORED quick action is allowed (a well-formed prompt|compose, never a run verb).
 * Derived from sanitizeProposedQuickActions so the rule has a single definition; the tick uses it to
 * SCRUB secretary.config server-side on write (defense-in-depth — secretary.config is the owner's blob
 * with no generic write validation). MIRROR: public/js/services/secretary-rules.js::isAllowedQuickAction.
 */
export function isAllowedQuickAction(a: unknown): boolean {
  const src = (a && typeof a === 'object' && 'source' in a) ? String((a as { source?: unknown }).source ?? '') : '';
  // status doesn't affect validity (only the kind/label/target/prompt do) — pass a fixed valid status.
  return sanitizeProposedQuickActions([a], src, 'active').length === 1;
}

/**
 * The cheap "anything to do?" pre-check (P1-B). Returns true iff the active context has any open goals,
 * any decisions due for review, or any pending intake — i.e. work that justifies the paid tick. When
 * false the tick skips the paid completion entirely.
 */
export function hasWorkToDo(
  counts: { openGoals?: number; dueDecisions?: number; pendingIntake?: number },
): boolean {
  return ((counts.openGoals ?? 0) + (counts.dueDecisions ?? 0) + (counts.pendingIntake ?? 0)) > 0;
}

/** The per-context autonomous-spend ledger kept on `secretary.config.autonomousLedger`. */
export type AutonomousLedger = Record<string, { date: string; morsels: number }>;

/** Morsels already spent autonomously by `contextId` on `today` (YYYY-MM-DD); 0 on a new day. */
export function ledgerSpentToday(ledger: AutonomousLedger | undefined, contextId: string, today: string): number {
  const e = ledger?.[contextId];
  return (e && e.date === today && typeof e.morsels === 'number' && e.morsels > 0) ? e.morsels : 0;
}

/** True when the soft daily budget is set (not null) and the day's autonomous spend has reached it (P1-C). */
export function budgetExceeded(spent: number, budget: number | null | undefined): boolean {
  return typeof budget === 'number' && budget >= 0 && spent >= budget;
}

/** Increment the ledger for `contextId` on `today` by `morsels`, resetting on a date change. */
export function bumpLedger(
  ledger: AutonomousLedger | undefined, contextId: string, today: string, morsels: number,
): AutonomousLedger {
  const next: AutonomousLedger = { ...(ledger ?? {}) };
  const cur = next[contextId];
  const base = (cur && cur.date === today) ? cur.morsels : 0;
  next[contextId] = { date: today, morsels: base + Math.max(0, morsels) };
  return next;
}

// ── P2-E: cross-context intake routing (plan §22 Phase-4) ──────────────────────────────────────
// Cheap, AI-free classification of an intake item against ALL of the user's Secretary contexts by word
// overlap (context name + brain purpose + workspace names/purposes), biased by recorded CORRECTIONS
// (words the owner previously associated with a context). High confidence → auto-route into that
// non-active context; low confidence → surface an Ask card; belongs-to-active / no-signal → null. The
// frontend mirror lives in public/js/services/secretary-routing.js — keep the two in lockstep.

/** A minimal Secretary context shape for routing (a slice of SecretaryContext). */
export interface RoutableContext {
  id: string;
  name?: string;
  organismId?: string | null;
  brain?: { purpose?: string };
  workspaces?: Array<{ name?: string; purpose?: string }>;
}

/** Learned routing signal: significant word → contextId the owner filed it into. */
export type RoutingCorrections = Record<string, string>;

const CORRECTION_BONUS = 5;

/** Significant words (≥4 chars) from text, lowercased + de-duplicated. */
export function tokenize(text: string): string[] {
  return Array.from(new Set(String(text || '').toLowerCase().split(/[^a-z0-9äöå]+/i).filter((w) => w.length >= 4)));
}

/** Score each context by word overlap (+ correction bias); returns entries sorted by score desc. */
export function scoreContexts(
  words: string[], contexts: RoutableContext[], corrections?: RoutingCorrections,
): Array<{ id: string; name: string; organismId: string | null; score: number }> {
  const corr = corrections ?? {};
  return (contexts ?? []).map((ctx) => {
    const hay = [ctx.name, ctx.brain?.purpose, ...((ctx.workspaces ?? []).map((w) => `${w.name} ${w.purpose ?? ''}`))]
      .join(' ').toLowerCase();
    let score = 0;
    for (const w of words) {
      if (hay.includes(w)) score += 1;
      if (corr[w] === ctx.id) score += CORRECTION_BONUS;
    }
    return { id: ctx.id, name: ctx.name ?? ctx.id, organismId: ctx.organismId ?? null, score };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Route intake `text` across `contexts`. Returns null when the item belongs to the active context or
 * carries no signal (file it normally); otherwise `{ contextId, confidence, score }` where confidence
 * is 'high' (auto-route into that non-active context) or 'low' (surface an Ask card).
 */
export function routeIntake(
  text: string, contexts: RoutableContext[], activeId: string | null | undefined, corrections?: RoutingCorrections,
): { contextId: string; confidence: 'high' | 'low'; score: number } | null {
  const t = String(text || '').trim();
  if (t.length < 8 || !Array.isArray(contexts) || contexts.length < 2) return null;
  const words = tokenize(t);
  if (words.length === 0) return null;
  const scored = scoreContexts(words, contexts, corrections);
  const best = scored[0];
  const second = scored[1] ?? { score: 0 };
  if (!best || best.score === 0) return null;
  const activeScore = (scored.find((s) => s.id === activeId) ?? { score: 0 }).score;
  if (best.id === activeId) return null;
  const margin = best.score - second.score;
  const beatsActive = best.score - activeScore;
  if (best.score >= 2 && beatsActive >= 2 && margin >= 2) {
    return { contextId: best.id, confidence: 'high', score: best.score };
  }
  return { contextId: best.id, confidence: 'low', score: best.score };
}

/** Record a correction: associate the text's significant words with `toContextId` (bounded map). */
export function learnCorrection(
  corrections: RoutingCorrections | undefined, text: string, toContextId: string,
): RoutingCorrections {
  const next: RoutingCorrections = { ...(corrections ?? {}) };
  for (const w of tokenize(text)) next[w] = toContextId;
  const keys = Object.keys(next);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete next[k];
  return next;
}

/** Where an autonomous-tick note-filing action should go (G1, §22 Phase-4). */
export type TickNoteRouting =
  | { action: 'file-active' }
  | { action: 'file-routed'; targetContextId: string }
  | { action: 'ask' };

/**
 * Decide where the autonomous tick should file a note when no user is present (§22 Phase-4). Classifies
 * the note text across ALL contexts (corrections-biased, via routeIntake): a HIGH-confidence non-active
 * match auto-routes into that context; an ambiguous (LOW) match defers to an Ask card instead of silently
 * filing into the active context; belongs-to-active / no-signal / <2 contexts files into the active
 * context as before. Pure (no storage, no AI) — unit-testable and kept in lockstep with the interactive
 * frontend path (public/js/services/secretary-routing.js).
 */
export function routeTickNote(
  text: string, contexts: RoutableContext[], activeId: string, corrections?: RoutingCorrections,
): TickNoteRouting {
  const r = routeIntake(text, contexts, activeId, corrections);
  if (!r) return { action: 'file-active' };
  if (r.confidence === 'high') return { action: 'file-routed', targetContextId: r.contextId };
  return { action: 'ask' };
}

// ── Triggers ── proactive follow-ups the Secretary binds to what it tracks. A trigger is declarative
// metadata (`secretary.trigger.{id}`); the autonomous tick is the ENGINE that evaluates them each run and
// fires the bound action band-gated. Four kinds: time (a date), recurring (cadence), completion (a goal/
// routine reaching done), condition (a memory/workspace state — e.g. a prefix gets ≥N items, or no
// activity for D days). Pure helpers here (no storage/AI) so the firing decision is unit-testable; the
// tick computes the signals + performs/persists. Frontend mirror is intentionally avoided — the tick owns firing.

/** Cadence → interval in ms (recurring triggers). */
const TRIGGER_CADENCE_MS: Record<string, number> = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };

export interface TriggerLike {
  id?: string;
  kind?: string;               // 'time' | 'recurring' | 'completion' | 'condition'
  label?: string;
  contextId?: string;
  status?: string;             // 'armed' | 'fired' | 'done' | 'paused'
  when?: string | null;        // ISO date (time)
  cadence?: string | null;     // 'daily' | 'weekly' | 'monthly' (recurring)
  nextFireAt?: string | null;  // computed next fire (time/recurring)
  target?: { type?: string; id?: string } | null;                                   // completion: item to watch
  condition?: { type?: string; prefix?: string; op?: string; value?: number; days?: number } | null; // condition
  // What to do when it fires. kind 'remind' (default) → feed entry + action-item. 'workflow' → start the
  // named Agent Workflow run. 'specialist' → queue + run a task for the named specialist (its `prompt`).
  action?: { kind?: string; summary?: string; band?: string; workflowId?: string; specialistName?: string; prompt?: string } | null;
  lastFiredAt?: string | null;
  createdBy?: string;
}

/** Signals the condition/completion evaluators need (the tick computes these from storage). */
export interface TriggerSignals {
  memoryCounts?: Record<string, number>;   // watched prefix → number of items
  lastActivityMs?: Record<string, number>; // watched prefix → newest item's time (ms), absent if none
  completed?: Record<string, boolean>;     // target id → is it done
}

/** The effective next-fire time (ms) for a time/recurring trigger, or null if not time-based. */
export function triggerNextFireMs(tr: TriggerLike): number | null {
  const src = tr.nextFireAt || tr.when;
  if (!src) return null;
  const t = Date.parse(src);
  return Number.isNaN(t) ? null : t;
}

/** Re-arm a recurring trigger: its next fire = now + cadence. Null for non-recurring. */
export function rearmTriggerAt(tr: TriggerLike, nowMs: number): string | null {
  const ms = TRIGGER_CADENCE_MS[String(tr.cadence)];
  return ms ? new Date(nowMs + ms).toISOString() : null;
}

/** Is a condition trigger's condition currently met? Pure, from the supplied signals. */
export function conditionMet(tr: TriggerLike, sig: TriggerSignals, nowMs: number): boolean {
  const c = tr.condition;
  if (!c || !c.prefix) return false;
  const counts = sig.memoryCounts || {};
  if (c.type === 'memory_count' || c.type === 'workspace_count') {
    const n = counts[c.prefix] ?? 0;
    const v = Number(c.value) || 0;
    return c.op === '>' ? n > v : n >= v; // default '>='
  }
  if (c.type === 'memory_exists') return (counts[c.prefix] ?? 0) > 0;
  if (c.type === 'no_activity') {
    const last = (sig.lastActivityMs || {})[c.prefix];
    if (last == null) return false; // nothing there → not "went quiet"
    return (nowMs - last) >= (Number(c.days) || 7) * 86400000;
  }
  return false;
}

/** Pure: which ARMED triggers fire now? The tick then performs each action + re-arms/settles the trigger. */
export function evaluateTriggers(
  triggers: TriggerLike[], sig: TriggerSignals, nowMs: number,
): Array<{ id: string; trigger: TriggerLike; reason: 'time' | 'completion' | 'condition' }> {
  const fired: Array<{ id: string; trigger: TriggerLike; reason: 'time' | 'completion' | 'condition' }> = [];
  for (const tr of (triggers || [])) {
    if (!tr.id || tr.status !== 'armed') continue;
    if (tr.kind === 'time' || tr.kind === 'recurring') {
      const next = triggerNextFireMs(tr);
      if (next != null && next <= nowMs) fired.push({ id: tr.id, trigger: tr, reason: 'time' });
    } else if (tr.kind === 'completion') {
      const tid = tr.target?.id;
      if (tid && (sig.completed || {})[tid]) fired.push({ id: tr.id, trigger: tr, reason: 'completion' });
    } else if (tr.kind === 'condition') {
      if (conditionMet(tr, sig, nowMs)) fired.push({ id: tr.id, trigger: tr, reason: 'condition' });
    }
  }
  return fired;
}

/** After firing: a recurring trigger re-arms (stays armed, new nextFireAt); others settle to 'fired'. */
export function settleFiredTrigger(tr: TriggerLike, nowMs: number): TriggerLike {
  if (tr.kind === 'recurring') {
    return { ...tr, status: 'armed', lastFiredAt: new Date(nowMs).toISOString(), nextFireAt: rearmTriggerAt(tr, nowMs) };
  }
  return { ...tr, status: 'fired', lastFiredAt: new Date(nowMs).toISOString() };
}
