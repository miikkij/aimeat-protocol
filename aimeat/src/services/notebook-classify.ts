/**
 * @file notebook-classify.ts
 * @description Notebook slice B — AI placement classifier. Given a free-text note and the user's
 *   organism/workspace structure, asks the user's own OpenRouter model to suggest WHERE the note
 *   belongs (organism → workspace → document-space) and to draft a clean document title + markdown
 *   body. Server-side because the OpenRouter key is decrypted here; the materialize step itself runs
 *   client-side over the generic memory/organism APIs (no-SSR). The model only ever picks from ids
 *   present in the context we build, and we re-resolve names from that context so the frontend can
 *   render override dropdowns without a second round-trip.
 * @structure
 *   - buildPlacementContext() — compact {organisms:[{id,name,workspaces:[{id,name,documentSpaces}]}]}
 *   - classifyNote() — load key → build context → prompt → OpenRouter → parse → validated suggestion
 * @usage const result = await classifyNote(storage, config, { gaii, ownerName, text });
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: AI placement classifier over OpenRouter (slice B).
 *   v1.1.0 — 2026-06-21 — Key/model resolution + completion extracted to notebook-ai.ts (shared with
 *     the planner); ClassifyError now extends NotebookAiError.
 *   v1.2.0 — 2026-07-05 — B2/B3: buildPlacementContext now attaches up to 3 recent doc titles per
 *     document space as `examples` (placement bias — file beside same-type docs); MAX_CHUNKS 6→12 to
 *     match the raised distribute split ceiling.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { stripCodeblock } from './generator-prompts/strip.js';
import { collectWorkspaceSummary } from './structure-overview.js';
import { NotebookAiError, resolveOwnerModel, completeOwner } from './notebook-ai.js';
import { NOTEBOOK_CLASSIFY_SYSTEM, NOTEBOOK_CLASSIFY_TEMPLATE } from './notebook-classify-prompt.js';
import { NOTEBOOK_DISTRIBUTE_SYSTEM, NOTEBOOK_DISTRIBUTE_TEMPLATE } from './notebook-distribute-prompt.js';

export interface PlacementSpace { namespace: string; name: string; examples?: string[] }
export interface PlacementWorkspace { id: string; name: string; documentSpaces: PlacementSpace[] }
export interface PlacementOrganism { id: string; name: string; description: string; workspaces: PlacementWorkspace[] }

export interface PlacementTarget {
  organismId: string | null;
  organismName?: string;
  workspaceId: string | null;
  workspaceName?: string;
  space: string | null;
  reason?: string;
}
export interface PlacementSuggestion extends PlacementTarget {
  title: string;
  markdown: string;
  confidence: number;
}
export interface ClassifyResult {
  suggestion: PlacementSuggestion | null;
  alternatives: PlacementTarget[];
  createNew: { suggest: boolean; organismName?: string; workspaceName?: string; reason?: string } | null;
  context: { organisms: PlacementOrganism[] };
  model: string;
}

/** Raised with a stable `code` so the route can map it to the right HTTP status + envelope.
 *  Extends NotebookAiError so routes can match either with one `instanceof` check. */
export class ClassifyError extends NotebookAiError {}

const MAX_ORGS = 30;
const MAX_WS_PER_ORG = 25;

/** Build the compact organism/workspace/document-space map the model classifies against. Only the
 *  caller's readable workspaces and their DOCUMENT spaces are included (records-only spaces are not
 *  document targets). */
export async function buildPlacementContext(
  storage: Storage,
  config: AimeatConfig,
  opts: { ownerName: string; viewerGaii: string },
): Promise<PlacementOrganism[]> {
  const orgItems = await storage.listOrganisms({ member: opts.ownerName, page: 1, perPage: MAX_ORGS });
  const organisms: PlacementOrganism[] = [];

  for (const org of orgItems) {
    const regKey = `organism.${org.id}.meta.workspaces`;
    const { items: regItems } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
    const wsSeen = new Map<string, { id: string; name?: string }>();
    for (const rec of regItems) {
      if (rec.key !== regKey) continue;
      const list = (rec.value as { workspaces?: Array<{ id?: string; name?: string }> } | null)?.workspaces ?? [];
      for (const w of list) if (typeof w?.id === 'string' && !wsSeen.has(w.id)) wsSeen.set(w.id, { id: w.id, name: w.name });
    }

    const workspaces: PlacementWorkspace[] = [];
    for (const w of [...wsSeen.values()].slice(0, MAX_WS_PER_ORG)) {
      const summary = await collectWorkspaceSummary(storage, config, { orgId: org.id, ws: w.id, name: w.name, viewerGaii: opts.viewerGaii });
      if (!summary.readable) continue;
      // B2 (placement bias): carry a few recent document titles per space as "examples" so the
      // classifier can prefer the space where the SAME TYPE of material already lives, rather than
      // filing on topical keyword overlap alone. `recent` is already newest-first (collectWorkspaceSummary).
      const documentSpaces = summary.spaces
        .filter(s => s.mode === 'document')
        .map(s => {
          const examples = s.recent.slice(0, 3).map(e => e.title).filter(Boolean);
          return examples.length ? { namespace: s.namespace, name: s.name, examples } : { namespace: s.namespace, name: s.name };
        });
      workspaces.push({ id: w.id, name: summary.name, documentSpaces });
    }
    organisms.push({ id: org.id, name: org.name, description: org.description || '', workspaces });
  }
  return organisms;
}

/** The classify prompt template — the operator-managed `notebook-classify` system prompt if present
 *  and active, else the code fallback (same text; they share one source). */
async function loadClassifyTemplate(storage: Storage): Promise<string> {
  try {
    const rec = await storage.getSystemPrompt('notebook-classify');
    if (rec && rec.active && typeof rec.content === 'string' && rec.content.trim()) return rec.content;
  } catch { /* fall through to the code default */ }
  return NOTEBOOK_CLASSIFY_TEMPLATE;
}

function fillPrompt(template: string, context: PlacementOrganism[], text: string): string {
  return template
    .split('{{structure}}').join(JSON.stringify({ organisms: context }, null, 2))
    .split('{{note}}').join(text);
}

interface RawSuggestion { organismId?: unknown; workspaceId?: unknown; space?: unknown; title?: unknown; markdown?: unknown; confidence?: unknown; reason?: unknown }

/** Resolve a model's chosen ids against the real context: drop ids that don't exist, attach names. */
function resolveTarget(context: PlacementOrganism[], raw: RawSuggestion): PlacementTarget {
  const organismId = typeof raw.organismId === 'string' ? raw.organismId : null;
  const org = organismId ? context.find(o => o.id === organismId) : undefined;
  const workspaceId = org && typeof raw.workspaceId === 'string' ? raw.workspaceId : null;
  const ws = org && workspaceId ? org.workspaces.find(w => w.id === workspaceId) : undefined;
  const space = ws && typeof raw.space === 'string' && ws.documentSpaces.some(s => s.namespace === raw.space)
    ? (raw.space as string) : null;
  return {
    organismId: org ? org.id : null,
    organismName: org?.name,
    workspaceId: ws ? ws.id : null,
    workspaceName: ws?.name,
    space,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  };
}

export async function classifyNote(
  storage: Storage,
  config: AimeatConfig,
  opts: { gaii: string; ownerName: string; viewerGaii: string; text: string },
): Promise<ClassifyResult> {
  const text = opts.text.trim();
  if (!text) throw new ClassifyError('INVALID_INPUT', 'text is required');

  // Owner's own OpenRouter key + model (shared resolution; throws NO_OPENROUTER_KEY when missing).
  const owner = await resolveOwnerModel(storage, config, opts.gaii);

  const context = await buildPlacementContext(storage, config, { ownerName: opts.ownerName, viewerGaii: opts.viewerGaii });
  const prompt = fillPrompt(await loadClassifyTemplate(storage), context, text);

  const result = await completeOwner(owner, prompt, NOTEBOOK_CLASSIFY_SYSTEM, { temperature: 0.2 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeblock(result.content).trim());
  } catch {
    throw new ClassifyError('PARSE_ERROR', 'The model did not return valid JSON. Try again.', 502);
  }

  const rawSug = (parsed.suggestion as RawSuggestion) ?? {};
  const target = resolveTarget(context, rawSug);
  const suggestion: PlacementSuggestion = {
    ...target,
    title: typeof rawSug.title === 'string' && rawSug.title.trim() ? rawSug.title.trim() : 'Untitled',
    markdown: typeof rawSug.markdown === 'string' ? rawSug.markdown : text,
    confidence: typeof rawSug.confidence === 'number' ? Math.max(0, Math.min(1, rawSug.confidence)) : 0.5,
  };
  const alternatives = Array.isArray(parsed.alternatives)
    ? (parsed.alternatives as RawSuggestion[]).slice(0, 2).map(a => resolveTarget(context, a)).filter(t => t.organismId)
    : [];
  const cn = parsed.createNew as { suggest?: unknown; organismName?: unknown; workspaceName?: unknown; reason?: unknown } | undefined;
  const createNew = cn && cn.suggest
    ? {
        suggest: true,
        organismName: typeof cn.organismName === 'string' ? cn.organismName : undefined,
        workspaceName: typeof cn.workspaceName === 'string' ? cn.workspaceName : undefined,
        reason: typeof cn.reason === 'string' ? cn.reason : undefined,
      }
    : null;

  return { suggestion, alternatives, createNew, context: { organisms: context }, model: result.model };
}

// ── Distribute: split a note into placed chunks (notebook stage 3) ──

export interface DistributeChunk extends PlacementTarget {
  title: string;
  markdown: string;
  createNew?: { suggest: boolean; organismName?: string; workspaceName?: string } | null;
}
export interface DistributeResult {
  chunks: DistributeChunk[];
  context: { organisms: PlacementOrganism[] };
  model: string;
}

const MAX_CHUNKS = 12;   // B3: the distribute prompt now allows up to 12 chunks — keep the code cap in step

async function loadDistributeTemplate(storage: Storage): Promise<string> {
  try {
    const rec = await storage.getSystemPrompt('notebook-distribute');
    if (rec && rec.active && typeof rec.content === 'string' && rec.content.trim()) return rec.content;
  } catch { /* fall through to the code default */ }
  return NOTEBOOK_DISTRIBUTE_TEMPLATE;
}

interface RawChunk extends RawSuggestion { createNew?: { suggest?: unknown; organismName?: unknown; workspaceName?: unknown } }

/** Split a (typically enriched) note into self-contained chunks, each resolved to a real home (or a
 *  create-new hint). Reuses the same OpenRouter resolution + placement context + id-resolution as the
 *  classifier so the frontend can render/override homes the same way; the per-chunk materialize runs
 *  client-side over the generic memory/organism APIs (no-SSR). */
export async function distributeNote(
  storage: Storage,
  config: AimeatConfig,
  opts: { gaii: string; ownerName: string; viewerGaii: string; text: string },
): Promise<DistributeResult> {
  const text = opts.text.trim();
  if (!text) throw new ClassifyError('INVALID_INPUT', 'text is required');

  const owner = await resolveOwnerModel(storage, config, opts.gaii);
  const context = await buildPlacementContext(storage, config, { ownerName: opts.ownerName, viewerGaii: opts.viewerGaii });
  const prompt = (await loadDistributeTemplate(storage))
    .split('{{structure}}').join(JSON.stringify({ organisms: context }, null, 2))
    .split('{{note}}').join(text);

  const result = await completeOwner(owner, prompt, NOTEBOOK_DISTRIBUTE_SYSTEM, { temperature: 0.2 });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeblock(result.content).trim());
  } catch {
    throw new ClassifyError('PARSE_ERROR', 'The model did not return valid JSON. Try again.', 502);
  }

  const rawChunks = Array.isArray(parsed.chunks) ? (parsed.chunks as RawChunk[]).slice(0, MAX_CHUNKS) : [];
  const chunks: DistributeChunk[] = rawChunks.map((rc) => {
    const target = resolveTarget(context, rc);
    const cn = rc.createNew;
    const createNew = cn && cn.suggest
      ? {
          suggest: true,
          organismName: typeof cn.organismName === 'string' ? cn.organismName : undefined,
          workspaceName: typeof cn.workspaceName === 'string' ? cn.workspaceName : undefined,
        }
      : null;
    return {
      ...target,
      title: typeof rc.title === 'string' && rc.title.trim() ? rc.title.trim() : 'Untitled',
      markdown: typeof rc.markdown === 'string' ? rc.markdown : '',
      createNew,
    };
  }).filter(c => c.markdown.trim());

  return { chunks, context: { organisms: context }, model: result.model };
}
