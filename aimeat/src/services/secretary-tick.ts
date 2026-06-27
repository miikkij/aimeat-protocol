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
 *   v0.5.0 — 2026-06-27 — B3: sanitizeProposedQuickActions() — the security boundary for dynamic quick
 *     actions (brain/secretary may only propose prompt|compose, never a run verb); asserted in e2e-secretary.
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
 * dropped. Pure: no storage/AI — the view mirrors this rule and e2e-secretary asserts it directly.
 * `id`/`createdAt` are added by the caller (kept out so the function stays deterministic for tests).
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
