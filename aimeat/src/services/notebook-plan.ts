/**
 * @file notebook-plan.ts
 * @description Notebook stage 2 — AI enrichment PLANNER. Given a free-text note and the user's
 *   organism/workspace structure, asks the user's own OpenRouter model to reason about the note's
 *   intent and propose an ordered plan of enrichment steps that EXPAND the note before it is filed.
 *   Server-side because the OpenRouter key is decrypted here (shared resolution in notebook-ai.ts);
 *   the steps themselves are executed client-side (no-SSR) — see public/js/services/notebook-plan.js.
 *   Phase 1 supports two self-fulfilled step kinds: `llm_reason` and `librarian_assess`. The model
 *   only ever produces those; unknown kinds are dropped defensively (same spirit as classify's
 *   resolveTarget).
 * @structure
 *   - planNote() — load key → build context → prompt → OpenRouter → parse → validated plan
 * @usage const result = await planNote(storage, config, { gaii, ownerName, viewerGaii, text });
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial (Phase 1): reason + librarian-assess planning over OpenRouter.
 *   v1.1.0 — 2026-06-21 — Phase 2: `delegate` step kind + offer catalogue grounding (the client passes a
 *     compact catalogue of the owner's agent offers; delegate steps are validated against it).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { stripCodeblock } from './llm-strip.js';
import { NotebookAiError, resolveOwnerModel, completeOwner } from './notebook-ai.js';
import { buildPlacementContext, type PlacementOrganism } from './notebook-classify.js';
import { NOTEBOOK_PLAN_SYSTEM, NOTEBOOK_PLAN_TEMPLATE } from './notebook-plan-prompt.js';
import { logger } from '../utils/logger.js';

/** Step kinds the planner is allowed to emit (and the client can execute). `delegate` hands work to a
 *  fleet agent offer (async task); the others are self-run over OpenRouter + the librarian. */
export const PLAN_STEP_KINDS = ['llm_reason', 'librarian_assess', 'delegate'] as const;
export type PlanStepKind = typeof PLAN_STEP_KINDS[number];

/** One compact offer the client passes so the planner can ground its delegate choices. */
export interface CatalogueOffer { agent: string; offerId: string; title?: string; ask?: string; latency?: string; cost?: string }

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  rationale: string;
  kind: PlanStepKind;
  mode: 'sync' | 'async';
  gate: boolean;
  query: string;
  /** delegate-only: the chosen fleet agent + offer (validated against the catalogue). */
  agent?: string;
  offerId?: string;
  status: 'proposed';
}
export interface NotebookPlan {
  id: string;
  summary: string;
  confidence: number;
  steps: PlanStep[];
  createdAt: string;
}
export interface PlanResult {
  plan: NotebookPlan;
  context: { organisms: PlacementOrganism[] };
  model: string;
}

const MAX_STEPS = 5;

/** The planner prompt template — the operator-managed `notebook-plan` system prompt if present and
 *  active, else the code fallback (same text; they share one source). */
async function loadPlanTemplate(storage: Storage): Promise<string> {
  try {
    const rec = await storage.getSystemPrompt('notebook-plan');
    if (rec && rec.active && typeof rec.content === 'string' && rec.content.trim()) return rec.content;
  } catch (err) { logger.warn('loadPlanTemplate: fall through to the code default', { error: String(err) }); }
  return NOTEBOOK_PLAN_TEMPLATE;
}

const MAX_CATALOGUE = 60;

/** Normalise + bound the client-supplied offer catalogue (defensive: it comes from the request body). */
function normaliseCatalogue(raw: unknown): CatalogueOffer[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogueOffer[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const agent = typeof r?.agent === 'string' ? r.agent : '';
    const offerId = typeof r?.offerId === 'string' ? r.offerId : '';
    if (!agent || !offerId) continue;
    out.push({
      agent, offerId,
      title: typeof r?.title === 'string' ? r.title : undefined,
      ask: typeof r?.ask === 'string' ? r.ask : undefined,
      latency: typeof r?.latency === 'string' ? r.latency : undefined,
      cost: typeof r?.cost === 'string' ? r.cost : undefined,
    });
    if (out.length >= MAX_CATALOGUE) break;
  }
  return out;
}

function fillPrompt(template: string, context: PlacementOrganism[], catalogue: CatalogueOffer[], text: string): string {
  return template
    .split('{{structure}}').join(JSON.stringify({ organisms: context }, null, 2))
    .split('{{capabilities}}').join(JSON.stringify({ offers: catalogue }, null, 2))
    .split('{{note}}').join(text);
}

interface RawStep { id?: unknown; title?: unknown; description?: unknown; rationale?: unknown; kind?: unknown; gate?: unknown; query?: unknown; agent?: unknown; offerId?: unknown }

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

/** Keep only steps with a known kind and a non-empty query; assign stable ids + defaults. A `delegate`
 *  step is dropped unless its agent+offerId exist in the catalogue (no hallucinated agents). */
function resolveSteps(raw: unknown, catalogue: CatalogueOffer[]): PlanStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: PlanStep[] = [];
  for (const r of raw as RawStep[]) {
    const kind = r?.kind;
    if (typeof kind !== 'string' || !PLAN_STEP_KINDS.includes(kind as PlanStepKind)) continue;
    const query = str(r?.query);
    if (!query) continue;

    let agent: string | undefined;
    let offerId: string | undefined;
    if (kind === 'delegate') {
      agent = str(r?.agent);
      offerId = str(r?.offerId);
      const known = catalogue.some(o => o.agent === agent && o.offerId === offerId);
      if (!known) continue;   // drop ungrounded delegate steps
    }

    const defaultTitle = kind === 'librarian_assess' ? 'Assess my material'
      : kind === 'delegate' ? `Delegate to ${agent}` : 'Reason about this';
    steps.push({
      id: str(r?.id, `s${steps.length + 1}`),
      title: str(r?.title, defaultTitle),
      description: str(r?.description),
      rationale: str(r?.rationale),
      kind: kind as PlanStepKind,
      mode: kind === 'delegate' ? 'async' : 'sync',
      gate: typeof r?.gate === 'boolean' ? r.gate : true,
      query,
      ...(kind === 'delegate' ? { agent, offerId } : {}),
      status: 'proposed',
    });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

export async function planNote(
  storage: Storage,
  config: AimeatConfig,
  opts: { gaii: string; ownerName: string; viewerGaii: string; text: string; catalogue?: unknown },
): Promise<PlanResult> {
  const text = opts.text.trim();
  if (!text) throw new NotebookAiError('INVALID_INPUT', 'text is required');

  const owner = await resolveOwnerModel(storage, config, opts.gaii);
  const context = await buildPlacementContext(storage, config, { ownerName: opts.ownerName, viewerGaii: opts.viewerGaii });
  const catalogue = normaliseCatalogue(opts.catalogue);
  const prompt = fillPrompt(await loadPlanTemplate(storage), context, catalogue, text);

  // Slightly higher temperature than classify: planning benefits from a little exploration.
  const result = await completeOwner(owner, prompt, NOTEBOOK_PLAN_SYSTEM, { temperature: 0.4 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeblock(result.content).trim());
  } catch {
    throw new NotebookAiError('PARSE_ERROR', 'The model did not return valid JSON. Try again.', 502);
  }

  const steps = resolveSteps(parsed.steps, catalogue);
  const plan: NotebookPlan = {
    id: `plan-${Date.now()}`,
    summary: str(parsed.summary, steps.length ? 'Enrichment plan' : 'No enrichment needed'),
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    steps,
    createdAt: new Date().toISOString(),
  };
  return { plan, context: { organisms: context }, model: result.model };
}
