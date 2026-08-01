/**
 * @file living-author.ts
 * @description Living Documents — AI template author (Phase 1). Turns a user's plain-language need into
 *   a reusable living-document template (title + description + charter + sections), using the caller's
 *   own OpenRouter model (shared resolution in notebook-ai.ts) and grounded by a compact catalogue of
 *   the owner's agent offers so sections can be assigned to real agents. Returns a template in the
 *   exact shape the client editor (living.js) consumes; the user can edit everything by hand after.
 * @structure authorLivingTemplate() — resolve model → prompt(need + catalogue) → chokepoint → template
 * @usage const result = await authorLivingTemplate(storage, config, { gaii, need, catalogue });
 * @version-history
 *   v1.0.0 — 2026-06-21 — Phase 1: author a living-document template from a description.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8b: the completion runs through the chokepoint, minted and
 *     metered as `living:author`.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { stripCodeblock } from './llm-strip.js';
import { NotebookAiError, resolveOwnerModel, completeOwner } from './notebook-ai.js';
import { LIVING_AUTHOR_SYSTEM, LIVING_AUTHOR_TEMPLATE } from './living-author-prompt.js';
import { logger } from '../utils/logger.js';

export interface LivingSlot { section: string; desc: string; slot: string; kind: 'derived' | 'aggregate' | 'static'; rules: { max_words?: number }; agent: string | null }
export interface LivingTemplate {
  title: string;
  description: string;
  charter: {
    scope: string; tracks: string[]; include: string[]; exclude: string[];
    cadence: 'hourly' | 'daily' | 'weekly';
    trust: { derive: 'gated' | 'auto' };
    triggers?: Array<{ kind: 'activity'; changed_gte: number }>;
    stop_when?: string;
  };
  template: LivingSlot[];
  charterReadable: string;
}
export interface AuthorResult { template: LivingTemplate; model: string }

const MAX_SLOTS = 6;
const MAX_CATALOGUE = 60;

async function loadTemplate(storage: Storage): Promise<string> {
  try {
    const rec = await storage.getSystemPrompt('living-author');
    if (rec && rec.active && typeof rec.content === 'string' && rec.content.trim()) return rec.content;
  } catch (err) { logger.warn('loadTemplate: fall through', { error: String(err) }); }
  return LIVING_AUTHOR_TEMPLATE;
}

function normaliseCatalogue(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter(r => typeof r?.agent === 'string' && typeof r?.offerId === 'string')
    .slice(0, MAX_CATALOGUE)
    .map(r => ({ agent: r.agent, offerId: r.offerId, title: r.title, ask: r.ask }));
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : []);

const KINDS = new Set(['derived', 'aggregate', 'static']);

/** Keep only known catalogue agent refs (no hallucinated agents). */
function resolveSlots(raw: unknown, catalogue: Array<Record<string, unknown>>): LivingSlot[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(catalogue.map(c => `${c.agent}/${c.offerId}`));
  const out: LivingSlot[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const section = str(r?.section);
    if (!section) continue;
    const kind = typeof r?.kind === 'string' && KINDS.has(r.kind) ? r.kind as LivingSlot['kind'] : 'derived';
    const agent = typeof r?.agent === 'string' && known.has(r.agent) ? r.agent : null;
    const maxWords = typeof (r?.rules as { max_words?: unknown })?.max_words === 'number' ? (r.rules as { max_words: number }).max_words : 150;
    out.push({
      section,
      desc: str(r?.desc),
      slot: str(r?.slot, `slot${out.length + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
      kind,
      rules: { max_words: maxWords },
      agent,
    });
    if (out.length >= MAX_SLOTS) break;
  }
  return out;
}

export async function authorLivingTemplate(
  storage: Storage,
  config: AimeatConfig,
  opts: { gaii: string; need: string; catalogue?: unknown },
): Promise<AuthorResult> {
  const need = opts.need.trim();
  if (!need) throw new NotebookAiError('INVALID_INPUT', 'need is required');

  const owner = await resolveOwnerModel(storage, config, opts.gaii, 'living:author');
  const catalogue = normaliseCatalogue(opts.catalogue);
  const prompt = (await loadTemplate(storage))
    .split('{{need}}').join(need)
    .split('{{capabilities}}').join(JSON.stringify({ offers: catalogue }, null, 2));

  const result = await completeOwner(owner, prompt, LIVING_AUTHOR_SYSTEM, { temperature: 0.4 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeblock(result.content).trim());
  } catch {
    throw new NotebookAiError('PARSE_ERROR', 'The model did not return valid JSON. Try again.', 502);
  }

  const rawCharter = (parsed.charter as Record<string, unknown>) ?? {};
  const slots = resolveSlots(parsed.template, catalogue);
  const template: LivingTemplate = {
    title: str(parsed.title, 'Living document'),
    description: str(parsed.description),
    charter: {
      scope: str(rawCharter.scope),
      tracks: strArr(rawCharter.tracks),
      include: strArr(rawCharter.include),
      exclude: strArr(rawCharter.exclude),
      cadence: (['hourly', 'weekly'].includes(String(rawCharter.cadence)) ? rawCharter.cadence : 'daily') as 'hourly' | 'daily' | 'weekly',
      trust: { derive: (rawCharter.trust as { derive?: unknown })?.derive === 'auto' ? 'auto' : 'gated' },
      ...(Array.isArray(rawCharter.triggers)
        ? { triggers: (rawCharter.triggers as Array<Record<string, unknown>>).filter(tr => tr.kind === 'activity' && Number(tr.changed_gte) > 0).map(tr => ({ kind: 'activity' as const, changed_gte: Number(tr.changed_gte) })) }
        : {}),
      ...(typeof rawCharter.stop_when === 'string' && rawCharter.stop_when.trim() ? { stop_when: rawCharter.stop_when.trim() } : {}),
    },
    template: slots.length ? slots : [{ section: 'Overview', desc: 'A short, current summary.', slot: 'overview', kind: 'derived', rules: { max_words: 150 }, agent: null }],
    charterReadable: str(parsed.charterReadable),
  };
  return { template, model: result.model };
}
