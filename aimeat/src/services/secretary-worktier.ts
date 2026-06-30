/**
 * @file secretary-worktier.ts
 * @description Pure (storage-free, AI-free) helpers that encode the Secretary's LIGHT-vs-HEAVY work seam —
 *   the single most important rule of the redesign: the cheap node-local Secretary only does LIGHT work
 *   (monitor / detect gaps / remind / route / short notes / keep the Current picture fresh) and PROPOSES a
 *   Work Brief for anything HEAVY (build structure, change schema, author substantial content, synthesize
 *   strategy, multi-step research). Heavy work is executed by a Builder — a connected big AI via the appdev
 *   MCP tools (Claude Desktop, or a queued task a connected agent picks up) — never by inventing content on
 *   the cheap model. SPECIALIST work is the narrow middle: produce one short artifact FROM supplied facts.
 *
 *   Two responsibilities, both deterministic so they unit-test directly (like secretary-tick.ts):
 *     - classifyWork() / classifyIntent() — map a capability id or a free-text intent to a tier.
 *     - assessGaps() — scan collected workspace summaries for the structural gaps that justify a Work Brief
 *       (empty workspace, empty space, stale workspace, off-target KPI). The "no real source → escalate"
 *       rule lives in the impure brief builder (it needs Discovery); the structural gap scan is here.
 *
 *   Inputs are loose structural shapes (a WorkspaceSummary from structure-overview.ts satisfies GapInput),
 *   so this module imports NOTHING from the rest of the codebase and tests with plain object vectors.
 * @structure WORK_TIERS · classifyWork · classifyIntent · needsHeavyEscalation · assessGaps · gapKey
 * @usage import { classifyWork, assessGaps } from './secretary-worktier.js';
 * @version-history
 *   v0.1.0 — 2026-07-01 — Initial: the light/specialist/heavy classifier + structural gap scan that turns
 *     the Secretary from a one-shot content inventor into a watcher that proposes Work Briefs.
 */

/** The three work tiers. light = cheap, here · specialist = cheap bounded, here · heavy = dispatch to a Builder. */
export type WorkTier = 'light' | 'specialist' | 'heavy';
export const WORK_TIERS = ['light', 'specialist', 'heavy'] as const;

/** Capabilities the cheap Secretary may carry out itself: watch, surface, remind, route, short notes. */
const LIGHT_CAPS = new Set([
  'briefing', 'reminders', 'file_intake', 'curate_knowledge', 'discover',
  'note', 'feed', 'remind', 'route', 'monitor', 'triage', 'plan', 'find',
]);

/** Bounded, single-shot "produce from supplied facts" work — the specialist's lane (no structure, no invention). */
const SPECIALIST_CAPS = new Set([
  'delegate', 'summarize', 'summarise', 'draft', 'extract', 'prep', 'condense', 'transform', 'specialist',
]);

/** High-judgment / expensive work that the cheap model must NOT do one-shot — propose a Work Brief instead. */
const HEAVY_CAPS = new Set([
  'author_content', 'create_resource', 'create_workspace', 'create_organism', 'create_structure',
  'schema_change', 'manifest_change', 'research', 'strategy', 'strategy_synthesis', 'build', 'populate',
]);

/**
 * Classify a capability id into a work tier. Unknown capabilities default to 'light' — the tick's
 * model-proposed action verbs are note/feed shaped, and genuinely structural intent is caught by
 * classifyIntent() + the impure "no real source → heavy" escalation in the brief builder. The seam's bias
 * (false-heavy is a mild annoyance, false-light is the failure we're eliminating) is applied where a real
 * decision is made (assessGaps + escalation), not by defaulting every unknown verb to heavy.
 */
export function classifyWork(capability: string | null | undefined): WorkTier {
  const c = String(capability ?? '').trim().toLowerCase();
  if (HEAVY_CAPS.has(c)) return 'heavy';
  if (SPECIALIST_CAPS.has(c)) return 'specialist';
  return 'light';
}

/** Verbs in a free-text intent that imply building structure, sourcing real data, or synthesizing strategy. */
const HEAVY_INTENT = /\b(build|create|set ?up|design|architect|structure|schema|manifest|migrat\w*|research|investigat\w*|strateg\w*|roadmap|populate|fill (in|out)?|model out|flesh out|draft (a |the )?(full|complete|whole))\b/i;

/**
 * Classify a free-text intent (a "Plan/Find/Note" composer line, a goal description). Heavy when it asks to
 * build/structure/research/strategize; otherwise light. Conservative on purpose — only clearly-heavy verbs
 * escalate, so everyday notes/reminders stay cheap.
 */
export function classifyIntent(text: string | null | undefined): WorkTier {
  const t = String(text ?? '').trim();
  if (!t) return 'light';
  return HEAVY_INTENT.test(t) ? 'heavy' : 'light';
}

/**
 * The hallucination-killer predicate (the impure brief builder supplies the facts): a task escalates to a
 * HEAVY Work Brief — never authored here — when it is structural, OR substantial, OR there is no real source
 * to ground it (Discovery scope=own returned nothing). Only a non-structural, non-substantial task WITH a
 * real source can be done cheaply. Pure: the caller computes the three booleans.
 */
export function needsHeavyEscalation(opts: { isStructural?: boolean; isSubstantial?: boolean; hasRealSource?: boolean }): boolean {
  if (opts.isStructural) return true;
  if (opts.isSubstantial) return true;
  if (opts.hasRealSource === false) return true;   // no source → cannot do well without inventing → brief
  return false;
}

// ── Structural gap scan ───────────────────────────────────────────────────────────────────────────

/** Default: a workspace whose newest content is older than this is "stale" and worth a refresh brief. */
export const STALE_AFTER_DAYS = 30;

/** Loose structural view of one workspace (structure-overview.ts WorkspaceSummary satisfies this). */
export interface GapInput {
  ws: string;
  name: string;
  readable: boolean;
  spaces: Array<{ name: string; namespace: string; mode: 'records' | 'document'; total: number }>;
  objectives: Array<{ statement?: string; kpis: Array<{ name: string; current: number | null; target?: { op?: string; value?: number; values?: number[] } }> }>;
  totalRecords: number;
  totalDocuments: number;
  lastActivity: string | null;
}

export type GapKind = 'empty-workspace' | 'empty-space' | 'stale' | 'kpi-off-target';

/** One structural gap the Secretary can surface as (or fold into) a Work Brief. */
export interface WorkspaceGap {
  ws: string;
  wsName: string;
  kind: GapKind;
  /** A short, deterministic phrasing seed (the brief builder may rephrase via a cheap call). */
  detail: string;
  namespace?: string;
  spaceName?: string;
  spaceMode?: 'records' | 'document';
  kpiName?: string;
}

/**
 * Does `current` meet `target`? null = undecidable. MIRROR of structure-overview.ts::meetsTarget — kept
 * inline so this module stays dependency-free and unit-testable with plain objects. Keep the two in sync.
 */
function meetsTarget(current: number | null, t: GapInput['objectives'][number]['kpis'][number]['target']): boolean | null {
  if (current === null || !t || typeof t.op !== 'string') return null;
  const v = t.value;
  switch (t.op) {
    case '<': return typeof v === 'number' ? current < v : null;
    case '<=': return typeof v === 'number' ? current <= v : null;
    case '>': return typeof v === 'number' ? current > v : null;
    case '>=': return typeof v === 'number' ? current >= v : null;
    case '==': return typeof v === 'number' ? current === v : null;
    case 'between': return Array.isArray(t.values) && t.values.length === 2 ? current >= t.values[0] && current <= t.values[1] : null;
    default: return null;
  }
}

/**
 * Scan collected workspace summaries for the structural gaps that justify proposing a Work Brief. A gap is
 * heavy by nature (filling a workspace = authoring real content = a Builder's job), so each gap becomes a
 * brief suggestion, NOT cheap-authored content. Deterministic (the caller passes `now` for tests):
 *   - empty-workspace  — readable workspace with zero records AND zero documents.
 *   - empty-space      — a memory-backed space with total === 0 (only reported when the workspace as a whole
 *                        has SOME content, so a brand-new all-empty workspace yields one 'empty-workspace'
 *                        gap, not one per space).
 *   - stale            — newest content older than `freshnessDays` (workspaces with content only).
 *   - kpi-off-target   — a measured KPI that does not meet its declared target (meetsTarget === false).
 * Unreadable workspaces are skipped (nothing to brief about what you can't see).
 */
export function assessGaps(
  summaries: GapInput[],
  opts?: { now?: number; freshnessDays?: number },
): WorkspaceGap[] {
  const now = opts?.now ?? Date.now();
  const freshnessMs = (opts?.freshnessDays ?? STALE_AFTER_DAYS) * 86400000;
  const gaps: WorkspaceGap[] = [];
  for (const s of summaries) {
    if (!s || s.readable === false) continue;
    const hasContent = (s.totalRecords + s.totalDocuments) > 0;
    if (!hasContent) {
      gaps.push({ ws: s.ws, wsName: s.name, kind: 'empty-workspace', detail: `Workspace "${s.name}" has no content yet.` });
    } else {
      for (const sp of (s.spaces ?? [])) {
        if (sp.total === 0) {
          gaps.push({ ws: s.ws, wsName: s.name, kind: 'empty-space', detail: `Space "${sp.name}" is empty.`, namespace: sp.namespace, spaceName: sp.name, spaceMode: sp.mode });
        }
      }
      // Staleness only applies to a workspace that already has content (an empty one is covered above).
      if (s.lastActivity) {
        const last = Date.parse(s.lastActivity);
        if (!Number.isNaN(last) && (now - last) >= freshnessMs) {
          const days = Math.floor((now - last) / 86400000);
          gaps.push({ ws: s.ws, wsName: s.name, kind: 'stale', detail: `Workspace "${s.name}" had no activity for ${days} days.` });
        }
      }
    }
    // Off-target KPIs apply whether or not the workspace has other content.
    for (const o of (s.objectives ?? [])) {
      for (const k of (o.kpis ?? [])) {
        if (meetsTarget(k.current, k.target) === false) {
          gaps.push({ ws: s.ws, wsName: s.name, kind: 'kpi-off-target', detail: `KPI "${k.name}" is off target${o.statement ? ` for "${o.statement}"` : ''}.`, kpiName: k.name });
        }
      }
    }
  }
  return gaps;
}

/** A stable key for a gap so the tick doesn't re-propose the same brief every run. */
export function gapKey(g: { ws?: string; kind?: string; namespace?: string; kpiName?: string }): string {
  return `${g.ws ?? ''}:${g.kind ?? ''}:${g.namespace ?? g.kpiName ?? ''}`;
}
