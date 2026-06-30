/**
 * @file secretary-workbrief.ts
 * @description Build a WORK BRIEF — the artifact that makes a Builder (a connected big AI via the appdev
 *   MCP tools, e.g. Claude Desktop) succeed at HEAVY work the cheap Secretary must NOT do itself. This
 *   RELOCATES the grounding that secretary-authoring.ts used to feed a cheap one-shot model (the Current
 *   picture, real Discovery sources, the exact JSON Schemas, the strategy focus) OUT of a cheap-model prompt
 *   and INTO a brief handed to a capable model. The Secretary detects a structural gap (assessGaps) and
 *   proposes a brief; it never authors the content. The Builder executes the brief via MCP — server-side
 *   schema validation keeps it honest — either by the owner pasting the brief into Claude Desktop or by a
 *   connected Builder agent picking up a queued task (POST /v1/secretary/brief/:id/dispatch).
 *
 *   Brief assembly is DETERMINISTIC (no AI) so it stays firmly "light": gaps + overview + sources + schemas
 *   are real data. An optional `phrase` seam lets the caller refine the one-line objective with a single
 *   cheap completion (explicitly told NOT to author facts); omit it for a fully deterministic brief.
 * @structure WorkBrief · BRIEF_KEY_PREFIX · renderBriefMarkdown (pure) · buildWorkBrief · saveWorkBrief
 * @usage import { buildWorkBrief, saveWorkBrief } from './secretary-workbrief.js';
 * @version-history
 *   v0.1.0 — 2026-07-01 — Initial: deterministic Work Brief builder (objective + current picture + real
 *     Discovery sources + exact record schemas + MCP playbook + definition-of-done + boundaries),
 *     persisted as secretary.brief.{id}; replaces the cheap one-shot authoring as the heavy-work path.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { buildWorkspaceOverview, buildOrganismOverview, collectWorkspaceSummary, type WorkspaceSummary } from './structure-overview.js';
import { buildDiscoveryRegistry, runDiscovery, type DiscoveryContext } from './discovery/index.js';
import { logger } from '../utils/logger.js';
import { assessGaps, gapKey, type WorkspaceGap } from './secretary-worktier.js';

/** Memory key prefix for persisted Work Briefs (mirrors secretary.clarify.* / secretary.trigger.*). */
export const BRIEF_KEY_PREFIX = 'secretary.brief.';

/** A Discovery citation the Builder should ground its work in. */
export interface BriefSource { type: string; title: string; description?: string }

/** A persisted Work Brief — proposed by the Secretary, executed by a Builder. */
export interface WorkBrief {
  id: string;
  contextId: string;
  contextName: string;
  organismId: string;
  ws?: string;
  wsName?: string;
  /** Briefs are heavy by definition (that's why they exist). */
  tier: 'heavy';
  status: 'proposed' | 'dispatched' | 'done';
  /** One-sentence objective in the owner's language. */
  objective: string;
  /** The structural gaps this brief addresses (for de-dup + UI). */
  gaps: WorkspaceGap[];
  /** The full markdown brief handed to the Builder (paste into Claude Desktop, or a task description). */
  brief: string;
  /** Real things that exist, cited as sources (Discovery scope=own). */
  sources: BriefSource[];
  /** The exact appdev MCP tool sequence the Builder should follow. */
  mcpHints: string[];
  createdAt: string;
  updatedAt: string;
  /** Set when dispatched to a connected Builder agent. */
  dispatchedTo?: string;
  taskId?: string;
}

/** Minimal structural view of the Secretary context the brief is built from. */
export interface BriefContext {
  id: string;
  name?: string;
  organismId?: string | null;
  brain?: { purpose?: string };
  strategy?: {
    enabled?: boolean; current?: string; target?: string; principles?: string[];
    milestones?: Array<{ title?: string; enables?: string; status?: string }>;
  };
}

/** The parts a brief markdown is rendered from — separated so rendering is pure + unit-testable. */
export interface BriefParts {
  objective: string;
  ownerName: string;
  contextName: string;
  organismId: string;
  ws?: string;
  wsName?: string;
  whyLines: string[];                 // open goals + focus milestone
  currentPicture: string;             // workspace/organism overview markdown
  sources: BriefSource[];
  recordSchemas: Array<{ space: string; namespace: string; schema: Record<string, unknown> }>;
  gaps: WorkspaceGap[];
  mcpHints: string[];
}

/** Derive a deterministic one-line objective from the gaps (the `phrase` seam may refine it later). */
export function deriveObjective(gaps: WorkspaceGap[], wsName: string | undefined): string {
  const where = wsName ? `workspace "${wsName}"` : 'this organism';
  const kinds = new Set(gaps.map((g) => g.kind));
  if (kinds.has('empty-workspace')) return `Build out ${where}: create the structure it needs and fill it with real, grounded content.`;
  if (kinds.has('empty-space')) {
    const names = gaps.filter((g) => g.kind === 'empty-space' && g.spaceName).map((g) => `"${g.spaceName}"`);
    return `Fill the empty space${names.length === 1 ? '' : 's'} in ${where} with real data: ${names.join(', ') || 'the empty spaces'}.`;
  }
  if (kinds.has('kpi-off-target')) {
    const names = gaps.filter((g) => g.kind === 'kpi-off-target' && g.kpiName).map((g) => `"${g.kpiName}"`);
    return `Move the off-target KPI${names.length === 1 ? '' : 's'} in ${where} toward target: ${names.join(', ')}.`;
  }
  if (kinds.has('stale')) return `Review and refresh ${where} — its content has gone stale; bring it up to date.`;
  return `Improve ${where}.`;
}

/** Build the MCP playbook hints appropriate to the gap kinds present. */
export function deriveMcpHints(gaps: WorkspaceGap[], organismId: string, ws: string | undefined): string[] {
  const kinds = new Set(gaps.map((g) => g.kind));
  const hints: string[] = [];
  hints.push(`Start: \`aimeat_organism_overview({ organism_id: "${organismId}" })\` to see the whole picture.`);
  if (ws) hints.push(`Read the target: \`aimeat_workspace_read({ organism_id: "${organismId}", ws: "${ws}" })\` — manifest + existing objects.`);
  if (kinds.has('empty-workspace')) {
    hints.push(`If the workspace needs more structure: \`aimeat_workspace_update({ organism_id, ws, add_spaces: [...] })\` (additive) or \`aimeat_workspace_create({ organism_id, name, manifest, schemas })\` for a new one.`);
  }
  hints.push(`Write each item as a DRAFT: \`aimeat_workspace_write({ organism_id, ws, space, value, id? })\` — the space is the objectType NAME. The write is validated against the locked schema; fix and re-write on any error.`);
  hints.push(`Publish when ready: \`aimeat_workspace_publish({ organism_id, ws, namespace, id })\` (skip if a publish gate requires human approval — leave drafts).`);
  hints.push(`Records spaces: write ONLY real, grounded entries. If there is no real data for a space, leave it empty — do not invent.`);
  return hints;
}

/**
 * Render the brief markdown PURELY from its parts (no storage/AI) so it unit-tests directly. This is the
 * exact text a Builder receives — objective, why, current picture, real sources, target schemas, the MCP
 * playbook, definition-of-done, and the one load-bearing boundary ("leave a records space empty rather than
 * invent"). The cheap Secretary never executes any of this; it only assembles it from real data.
 */
export function renderBriefMarkdown(p: BriefParts): string {
  const out: string[] = [];
  out.push(`# Work brief — ${p.objective}`);
  out.push('');
  out.push(`_For: ${p.ownerName} · context "${p.contextName}"${p.wsName ? ` · workspace "${p.wsName}"` : ''} · organism \`${p.organismId}\`${p.ws ? ` · ws \`${p.ws}\`` : ''}_`);
  out.push('');
  out.push('## Objective');
  out.push(p.objective);
  out.push('');
  if (p.whyLines.length) {
    out.push('## Why / context');
    for (const l of p.whyLines) out.push(`- ${l}`);
    out.push('');
  }
  out.push('## Current picture');
  out.push(p.currentPicture.trim() || '_(empty)_');
  out.push('');
  if (p.sources.length) {
    out.push('## Real sources — ground your work in these (cite by title; do not reinvent what already exists)');
    for (const s of p.sources) out.push(`- [${s.type}] ${s.title}${s.description ? ` — ${s.description}` : ''}`);
    out.push('');
  } else {
    out.push('## Real sources');
    out.push('_No existing material was found for this. If you cannot ground the work in something real, ask the owner for the facts rather than inventing them._');
    out.push('');
  }
  if (p.recordSchemas.length) {
    out.push('## Exact record schemas (each record MUST satisfy its schema)');
    for (const rs of p.recordSchemas) out.push(`- space **"${rs.space}"** (namespace \`${rs.namespace}\`):\n  \`\`\`json\n  ${JSON.stringify(rs.schema)}\n  \`\`\``);
    out.push('');
  }
  out.push('## How (appdev MCP playbook)');
  for (const h of p.mcpHints) out.push(`- ${h}`);
  out.push('');
  out.push('## Definition of done');
  out.push('- The gaps below are closed with real, grounded content (documents = your reasoning/plans; records = real data only).');
  out.push('- Each write passed schema validation; published items where no publish gate blocks it, drafts otherwise.');
  out.push('- You verified your output against the sources and flagged any assumption explicitly.');
  out.push('');
  if (p.gaps.length) {
    out.push('### Gaps this brief addresses');
    for (const g of p.gaps) out.push(`- ${g.detail}`);
    out.push('');
  }
  out.push('## Boundaries');
  out.push('- Stay inside this workspace\'s purpose; do not pull other areas\' topics in.');
  out.push('- Do NOT fabricate facts, numbers, names, dates or record entries. Leave a records space empty rather than invent.');
  return out.join('\n');
}

/**
 * Build a Work Brief for a set of gaps in ONE workspace (or organism-level when `ws` is omitted). Collects
 * the Current picture (overview), real Discovery sources, and the exact record schemas for any empty record
 * spaces, then renders the brief markdown. Deterministic unless `phrase` is supplied to refine the objective.
 * Does NOT persist — the caller (route/tick) persists via saveWorkBrief so it controls the write list.
 */
export async function buildWorkBrief(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    owner: string;               // owner GHII (viewer)
    ownerName: string;
    active: BriefContext;
    ws?: string;                 // target workspace id (omit for organism-level)
    wsName?: string;
    gaps: WorkspaceGap[];
    openGoals?: Array<Record<string, unknown>>;
    /** Optional cheap refinement of the one-line objective (told NOT to author facts). Omit = deterministic. */
    phrase?: (objective: string) => Promise<string>;
    now?: string;                // ISO; defaults to new Date().toISOString()
  },
): Promise<WorkBrief> {
  const { owner, ownerName, active, ws, gaps } = opts;
  const organismId = String(active.organismId || '');
  const now = opts.now ?? new Date().toISOString();

  // 1) Objective (deterministic; optionally refined by a single cheap call).
  let objective = deriveObjective(gaps, opts.wsName);
  if (opts.phrase) {
    try { const refined = (await opts.phrase(objective)).trim(); if (refined) objective = refined.slice(0, 300); }
    catch (e) { logger.warn('[secretary] brief phrase failed, using deterministic objective', { error: (e as Error)?.message }); }
  }

  // 2) Why / context — open goals + the strategy focus milestone.
  const whyLines: string[] = [];
  for (const g of (opts.openGoals ?? [])) {
    const title = String((g as { title?: unknown }).title || '').trim();
    if (title) whyLines.push(`Goal: ${title}${(g as { why?: unknown }).why ? ` (why: ${String((g as { why?: unknown }).why)})` : ''}`);
  }
  const strat = active.strategy;
  if (strat?.enabled) {
    const focus = (strat.milestones || []).find((m) => m && m.status !== 'reached');
    if (focus?.title) whyLines.push(`Focus milestone: ${focus.title}${focus.enables ? ` (${focus.enables})` : ''}`);
    if (strat.target) whyLines.push(`Target state: ${strat.target}`);
  }

  // 3) Current picture — the deterministic, never-stale overview of the target workspace (or organism).
  let currentPicture = '';
  try {
    if (ws) currentPicture = (await buildWorkspaceOverview(storage, config, { orgId: organismId, ws, name: opts.wsName, viewerGaii: owner })).markdown;
    else currentPicture = (await buildOrganismOverview(storage, config, { orgId: organismId, viewerGaii: owner })).markdown;
  } catch (e) { logger.warn('[secretary] brief overview failed', { error: (e as Error)?.message }); }

  // 4) Real sources — Discovery scope=own (the same grounding the old authoring used, now for the Builder).
  const sources: BriefSource[] = [];
  try {
    const registry = buildDiscoveryRegistry(storage, config);
    const q = [opts.wsName || '', strat?.target || '', ...gaps.map((g) => g.spaceName || '')].filter(Boolean).join(' ').slice(0, 200);
    const discCtx: DiscoveryContext = {
      caller: { ownerName, sub: ownerName, gaii: owner, isOwnerSession: true, scopes: [] },
      scope: 'own', filters: { q, limit: 12 }, nodeId: config.nodeId,
    };
    for (const e of (await runDiscovery(registry, discCtx)).slice(0, 12)) {
      sources.push({ type: String(e.type), title: String(e.title), description: e.description ? String(e.description).replace(/\s+/g, ' ').slice(0, 160) : undefined });
    }
  } catch (e) { logger.warn('[secretary] brief discovery failed', { error: (e as Error)?.message }); }

  // 5) Exact record schemas for any empty RECORD spaces in the gaps (so the Builder conforms first shot).
  const recordSchemas: BriefParts['recordSchemas'] = [];
  if (ws) {
    const root = `organism.${organismId}.w.${ws}`;
    for (const g of gaps) {
      if (g.kind !== 'empty-space' || g.spaceMode !== 'records' || !g.namespace) continue;
      try {
        const sc = await storage.findApplicableSchema(`${root}.${g.namespace}.__probe`);
        if (sc?.schemaJson) recordSchemas.push({ space: g.spaceName || g.namespace, namespace: g.namespace, schema: sc.schemaJson as Record<string, unknown> });
      } catch { /* best-effort */ }
    }
  }

  const mcpHints = deriveMcpHints(gaps, organismId, ws);
  const brief = renderBriefMarkdown({
    objective, ownerName, contextName: active.name || 'personal', organismId, ws, wsName: opts.wsName,
    whyLines, currentPicture, sources, recordSchemas, gaps, mcpHints,
  });

  return {
    id: randomUUID(), contextId: active.id, contextName: active.name || 'personal', organismId,
    ws, wsName: opts.wsName, tier: 'heavy', status: 'proposed', objective, gaps, brief, sources, mcpHints,
    createdAt: now, updatedAt: now,
  };
}

/** Persist a Work Brief at secretary.brief.{id} (mirrors the clarify-job write). Returns the memory key. */
export async function saveWorkBrief(storage: Storage, ownerGhii: string, brief: WorkBrief): Promise<string> {
  const key = `${BRIEF_KEY_PREFIX}${brief.id}`;
  await storage.setMemory({
    key, ownerGaii: ownerGhii, value: brief as unknown as Record<string, unknown>,
    visibility: 'private', tags: ['secretary', 'brief', brief.status], ttlHours: null,
    version: 1, createdAt: brief.createdAt, updatedAt: brief.updatedAt,
  });
  return key;
}

/**
 * Detect structural gaps across a context's workspaces and propose Work Briefs for the NEW ones (deduped
 * against existing OPEN briefs by gap key), bounded. Deterministic + idempotent: repeated calls converge
 * instead of spamming. Shared by the autonomous tick (free, every run) and the setup / on-demand route, so
 * both produce identical briefs. No paid AI call (storage reads + best-effort Discovery only).
 */
export async function proposeWorkBriefs(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    ownerGhii: string;
    ownerName: string;
    active: BriefContext;
    wsList: Array<{ id: string; name: string }>;
    openGoals?: Array<Record<string, unknown>>;
    maxWs?: number;
    maxNewBriefs?: number;
    phrase?: (objective: string) => Promise<string>;
  },
): Promise<{ writes: string[]; briefs: WorkBrief[] }> {
  const { ownerGhii, ownerName, active, wsList } = opts;
  const out = { writes: [] as string[], briefs: [] as WorkBrief[] };
  if (!active.organismId || !wsList.length) return out;
  const maxWs = opts.maxWs ?? 12;
  const maxNew = opts.maxNewBriefs ?? 3;

  // Gaps already covered by an EXISTING brief in this context (proposed/dispatched, OR 'done' so a brief the
  // owner resolved/dismissed isn't re-proposed every tick) — don't re-propose. Once a gap is genuinely
  // closed (workspace filled), assessGaps no longer reports it, so this only suppresses live duplicates.
  const existing = await storage.listMemory(ownerGhii, { prefix: BRIEF_KEY_PREFIX }).catch(() => []);
  const covered = new Set<string>();
  for (const rec of existing) {
    const b = rec.value as unknown as WorkBrief | undefined;
    if (!b || b.contextId !== active.id) continue;
    for (const g of (b.gaps || [])) covered.add(gapKey(g));
  }

  // A structural summary per workspace → assess gaps (pure), minus what's already covered by an open brief.
  const summaries: WorkspaceSummary[] = [];
  const nameByWs = new Map<string, string>();
  for (const ws of wsList.slice(0, maxWs)) {
    nameByWs.set(ws.id, ws.name);
    summaries.push(await collectWorkspaceSummary(storage, config, { orgId: active.organismId, ws: ws.id, name: ws.name, viewerGaii: ownerGhii }));
  }
  const gaps = assessGaps(summaries, {}).filter((g) => !covered.has(gapKey(g)));
  if (!gaps.length) return out;

  // One brief per workspace, folding that workspace's new gaps, bounded.
  const byWs = new Map<string, WorkspaceGap[]>();
  for (const g of gaps) { const arr = byWs.get(g.ws) ?? []; arr.push(g); byWs.set(g.ws, arr); }
  let made = 0;
  for (const [ws, wsGaps] of byWs) {
    if (made >= maxNew) break;
    const brief = await buildWorkBrief(storage, config, {
      owner: ownerGhii, ownerName, active, ws, wsName: nameByWs.get(ws), gaps: wsGaps, openGoals: opts.openGoals, phrase: opts.phrase,
    });
    out.writes.push(await saveWorkBrief(storage, ownerGhii, brief));
    out.briefs.push(brief);
    made++;
  }
  return out;
}

/** Mark an existing brief dispatched/done (read-modify-write). Returns the updated brief, or null if gone. */
export async function updateBriefStatus(
  storage: Storage, ownerGhii: string, briefId: string,
  patch: { status?: WorkBrief['status']; dispatchedTo?: string; taskId?: string },
): Promise<WorkBrief | null> {
  const key = `${BRIEF_KEY_PREFIX}${briefId}`;
  const rec = await storage.getMemory(ownerGhii, key);
  if (!rec) return null;
  const brief = rec.value as unknown as WorkBrief;
  const now = new Date().toISOString();
  const next: WorkBrief = { ...brief, ...patch, updatedAt: now };
  await storage.setMemory({
    key, ownerGaii: ownerGhii, value: next as unknown as Record<string, unknown>,
    visibility: 'private', tags: ['secretary', 'brief', next.status], ttlHours: null,
    version: 1, createdAt: brief.createdAt, updatedAt: now,
  });
  return next;
}
