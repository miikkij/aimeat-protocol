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
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { complete } from './openrouter.js';
import { decrypt, getEncryptionKey } from './encryption.js';
import { stripCodeblock } from './generator-prompts/strip.js';
import { collectWorkspaceSummary } from './structure-overview.js';
import { NOTEBOOK_CLASSIFY_SYSTEM, NOTEBOOK_CLASSIFY_TEMPLATE } from './notebook-classify-prompt.js';

export interface PlacementSpace { namespace: string; name: string }
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

/** Raised with a stable `code` so the route can map it to the right HTTP status + envelope. */
export class ClassifyError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

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
      const documentSpaces = summary.spaces
        .filter(s => s.mode === 'document')
        .map(s => ({ namespace: s.namespace, name: s.name }));
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

  // OpenRouter key + model (same per-owner settings the /v1/openrouter routes use).
  const [apiKeyRecord, prefsRecord] = await Promise.all([
    storage.getMemory(opts.gaii, 'openrouter.apikey'),
    storage.getMemory(opts.gaii, 'openrouter.settings'),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as string) || 'openrouter';
  const baseUrl = (prefs.baseUrl as string) || 'https://openrouter.ai/api/v1';
  const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
  let decryptedKey: string | undefined;
  if (encrypted) {
    const encKey = getEncryptionKey(config);
    if (!encKey) throw new ClassifyError('ENCRYPTION_NOT_CONFIGURED', 'Encryption key not configured on this node.', 503);
    decryptedKey = decrypt(encrypted, encKey);
  } else if (provider === 'openrouter') {
    throw new ClassifyError('NO_OPENROUTER_KEY', 'No OpenRouter API key configured. Add one in the OpenRouter settings to use AI sorting.', 400);
  }
  const model = (prefs.model as string) || (prefs.reasoningModel as string) || (prefs.executionModel as string) || 'anthropic/claude-sonnet-4';

  const context = await buildPlacementContext(storage, config, { ownerName: opts.ownerName, viewerGaii: opts.viewerGaii });
  const prompt = fillPrompt(await loadClassifyTemplate(storage), context, text);

  let result;
  try {
    result = await complete(decryptedKey, model, prompt, NOTEBOOK_CLASSIFY_SYSTEM, baseUrl, { temperature: 0.2 });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new ClassifyError('INVALID_API_KEY', 'OpenRouter rejected the API key.', 401);
    if (status === 429) throw new ClassifyError('RATE_LIMITED', 'OpenRouter rate limit hit. Try again shortly.', 429);
    throw new ClassifyError('OPENROUTER_ERROR', (e as Error).message, 502);
  }

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
