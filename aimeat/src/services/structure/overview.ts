/**
 * @file src/services/structure/overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Deterministic OKF-style (Open Knowledge Format) STRUCTURE OVERVIEW of an organism or a
 *   single workspace, rendered as Markdown + YAML frontmatter. It is a *projection of live state* —
 *   never persisted as a record — so it cannot drift: the same workspace content always yields the
 *   same Markdown. Two granularities, one collector:
 *     - Organism overview  — SHALLOW: each workspace's space breakdown + per-space counts + totals.
 *       Lets an agent (or a human) grasp the whole organism in one read and decide where to drill in.
 *     - Workspace overview — DEEP: per space the last N record/document titles + ids + counts, so the
 *       next targeted MCP/REST read goes straight to the right id without a discovery sweep.
 *   Bounded by size: at most MAX_ITEMS recent entries per space are listed; the TOTAL is always shown
 *   (no silent truncation), so a consumer knows to page deeper. Access mirrors GET /:id/workspace —
 *   the manifest is the single read gate; a workspace the viewer can't read is listed by name only.
 * @structure
 *   - MAX_ITEMS — recent entries listed per space
 *   - collectWorkspaceSummary() — walk one workspace's keys → { readable, spaces, totals }
 *   - buildWorkspaceOverview() — DEEP Markdown for one workspace
 *   - buildOrganismOverview() — SHALLOW Markdown for the whole organism
 * @usage
 *   import { buildOrganismOverview, buildWorkspaceOverview } from './overview.js';
 *   const md = await buildOrganismOverview(storage, config, { orgId, viewerGaii });
 * @version-history
 *   2026-11-24 — The workspace overview lists the newest ANSWER_PAGE_DEFAULT entries of a space, and
 *     says how to read the rest; it listed every entry, over 100 000 characters for 1040 records.
 *   v1.0.0 — 2026-06-13 — Initial: OKF-style organism + workspace structure overview (Markdown).
 *   v1.1.0 — 2026-06-13 — Organism overview is now the workspace overviews COMPOSED at the same
 *     fidelity (each workspace a ## section with its spaces' recent ids+titles) instead of a
 *     count-only breakdown — shared spaceLines() renders both, so the org view is navigable to a
 *     record id, not a lossy splat.
 *   v1.2.0 — 2026-06-23 — Measurability: a workspace manifest's `objectives[]` are surfaced in the
 *     summary + rendered as an "Objectives" block (KPI current vs target). A `from:'records'` KPI's
 *     `current` is computed from the workspace's own published records via kpi-rollup; a string-recipe
 *     KPI shows its declared `current`. Design: docs/internal/2026-06-23-organism-measurability-design.md.
 *   v1.3.0 — 2026-06-23 — spaceLines() now renders each space's recent entries as a 3-column Markdown
 *     TABLE (Title · ID · Updated) instead of an inline "title · id · date" run-on, so the structure
 *     overview reads as aligned columns (human + agent). Pipe-safe titles via cell().
 *   v1.4.0 — 2026-06-26 — Organism archive: archived workspaces are excluded by default (listed only
 *     with includeArchived) and summarised as a count + footer; per-workspace archived-record counts
 *     surfaced; archived org/workspace flagged with a 🗄️ marker.
 *   v1.5.0 — 2026-07-06 — Workspace-scope SKILLS (skills registry) surfaced in both overviews as a
 *     "Skills (loadable expertise)" table with ready-to-use ws:{org}/{ws}/{name} refs — an agent
 *     reading the map sees available expertise without a separate listing call.
 *   v1.6.0 — 2026-07-07 — collectWorkspaceSummary takes an itemLimit; the DEEP workspace overview now
 *     lists EVERY instance id (uncapped) so a big space exposes all ids for a targeted batch read
 *     (the SHALLOW organism overview keeps the MAX_ITEMS cap). entryTitle exported for the
 *     aimeat_workspace_read index to title instances the same way.
 *   v1.7.0 — 2026-07-16 — collectWorkspaceSummary's scan excludes `.version.N` rows in SQL
 *     (excludeVersionRows): the overview never renders history, so its full-copy values were loaded
 *     only to be skipped by the role filter.
 *   v1.8.0 — 2026-09-24 — collectWorkspaceSummary gates on, and summarises, the copies of the manifest
 *     and readme that count (services/workspace-meta.ts), not the first copy the scan returned.
 *   v1.9.0 — 2026-09-29 — collectWorkspaceSummary loads through services/workspace-content.ts, the one
 *     workspace loader: the read is decided by decideWorkspaceRead (membership and managers included)
 *     and the records pass the caller's classification reader, which every overview now takes
 *     (TARGET-082). A non-member's summary is the name the caller already had.
 *   2026-11-01 — collectWorkspaceSummary reads a record's id from the end of its key (spaceRowAt), so
 *     a record whose id holds a dot is listed and counted under its whole id; it was left out
 *     (secaudit2026oct31w2 round 10b, dotted record ids).
 *   2026-11-21 — The organism's own objectives (organism.<id>.meta.manifest) in the organism overview,
 *     as an "Organism objectives" block and in the answer; a KPI whose source names a workspace
 *     (source.ws) is computed from that workspace's records when the viewer may read it
 *     (collectOrganismObjectives). An objective's level, serves and until reach both overviews, in
 *     the summary and the Markdown lines (summarizeObjectives, one builder for both levels)
 *     (wish-suunta-n-kyviin-organismin-manifestin-tavoitteet-ja-tasot-yl).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountOf } from '../../utils/gaii.js';
import { isMemoryBackedSpace } from '../workspace/meta.js';
import { loadWorkspaceContent } from '../workspace/content.js';
import type { ContentReader } from '../classification/reader.js';
import { isRecordsSource, evaluateRecordsKpi, type RecordsKpiSource } from '../kpi-rollup.js';
import { readOrganismMetaValue } from '../organism/record-helpers.js';
import { spacePrefixesOf, spaceRowAt } from '../workspace/record-key.js';
import { logger } from '../../utils/logger.js';
import { ANSWER_PAGE_DEFAULT } from '../../models/answer-budget.js';

/** Recent entries listed per space in either overview. The total is always reported alongside. */
export const MAX_ITEMS = 10;

interface SpaceEntry { id: string; title: string; updatedAt: string }
interface SpaceSummary {
  name: string;
  namespace: string;
  mode: 'records' | 'document';
  total: number;
  recent: SpaceEntry[];   // up to MAX_ITEMS, most-recently-updated first
}
/** One KPI, with `current` resolved: computed from records (when `source` is `from:'records'`) or the
 *  declared value otherwise. `target`/`unit`/`kind` echo the manifest declaration. */
export interface KpiSummary {
  name: string;
  kind?: string;
  unit?: string;
  target?: { op?: string; value?: number; values?: number[] };
  current: number | null;
  computed: boolean;             // true → `current` came from a records rollup; false → declared/absent
  measuredAt?: string;
}
export interface ObjectiveSummary {
  id: string;
  statement?: string;
  why?: string;
  status?: string;
  /** How much the objective weighs: main | important | background (decision
   *  decision-situatedai-p-tavoite-organismin-manifestin-objectives-kent-s). */
  level?: string;
  /** The objectives of other organisms (or of this one) this objective serves. */
  serves?: Array<{ organism: string; objective: string }>;
  /** The date the objective is meant to hold until. */
  until?: string;
  kpis: KpiSummary[];
}
/** One workspace-scope skill (skills registry), surfaced in the overview so an agent reading the
 *  map immediately knows which expertise it can load (ref `ws:{org}/{ws}/{name}`) — no extra
 *  listing call needed. */
export interface WsSkillSummary {
  name: string;
  description: string;
  version: string;
  updatedAt: string;
}
export interface WorkspaceSummary {
  ws: string;
  name: string;
  readme: string | null;
  readable: boolean;
  spaces: SpaceSummary[];
  /** Workspace-scope skills (skills registry) — loadable expertise, not content spaces. */
  skills: WsSkillSummary[];
  objectives: ObjectiveSummary[];   // measurability convention (empty when the manifest declares none)
  totalRecords: number;
  totalDocuments: number;
  lastActivity: string | null;   // ISO of the most-recently-updated content key, deterministic
  /** Whether THIS workspace is itself archived (registry marker). The overview lists archived
   *  workspaces only when explicitly asked (includeArchived); otherwise they are summarised as a count. */
  archived: boolean;
  /** Count of archived (hidden-from-AI) memory rows under this workspace — surfaced as a hint so a
   *  reader/agent knows there is archived content to ask for, without it polluting the working set. */
  archivedCount: number;
}

type ObjType = { name?: unknown; namespace?: unknown; mode?: unknown; kind?: unknown; backing?: unknown };
type RawKpi = { name?: unknown; kind?: unknown; unit?: unknown; target?: unknown; source?: unknown; current?: unknown; measuredAt?: unknown };
type RawObjective = { id?: unknown; statement?: unknown; why?: unknown; status?: unknown; level?: unknown; serves?: unknown; until?: unknown; kpis?: unknown };

/**
 * A manifest's `objectives[]` as the overviews show them, for a workspace manifest and the organism's
 * own alike. `computedOf` answers a `from:'records'` KPI's value from records the reader may read,
 * or null; a KPI without one keeps its declared `current`. The fields pass through as written:
 * `level`, `serves` and `until` are the reader's to weigh, not the overview's.
 */
export function summarizeObjectives(
  raw: unknown,
  computedOf: (source: RecordsKpiSource, objectiveIndex: number, kpiIndex: number) => number | null,
): ObjectiveSummary[] {
  const out: ObjectiveSummary[] = [];
  if (!Array.isArray(raw)) return out;
  (raw as RawObjective[]).forEach((o, oi) => {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string') return;
    const kpis: KpiSummary[] = [];
    ((Array.isArray(o.kpis) ? o.kpis : []) as RawKpi[]).forEach((k, ki) => {
      if (!k || typeof k.name !== 'string') return;
      const computed = isRecordsSource(k.source) ? computedOf(k.source, oi, ki) : null;
      kpis.push({
        name: k.name,
        kind: typeof k.kind === 'string' ? k.kind : undefined,
        unit: typeof k.unit === 'string' ? k.unit : undefined,
        target: (k.target && typeof k.target === 'object') ? k.target as KpiSummary['target'] : undefined,
        current: computed ?? (typeof k.current === 'number' ? k.current : null),
        computed: computed !== null,
        measuredAt: typeof k.measuredAt === 'string' ? k.measuredAt : undefined,
      });
    });
    const serves = Array.isArray(o.serves)
      ? (o.serves as Array<{ organism?: unknown; objective?: unknown }>).flatMap(s =>
        (s && typeof s.organism === 'string' && typeof s.objective === 'string') ? [{ organism: s.organism, objective: s.objective }] : [])
      : [];
    out.push({
      id: o.id,
      statement: typeof o.statement === 'string' ? o.statement : undefined,
      why: typeof o.why === 'string' ? o.why : undefined,
      status: typeof o.status === 'string' ? o.status : undefined,
      ...(typeof o.level === 'string' ? { level: o.level } : {}),
      ...(serves.length ? { serves } : {}),
      ...(typeof o.until === 'string' ? { until: o.until } : {}),
      kpis,
    });
  });
  return out;
}

/** The `from:'records'` KPIs of an organism manifest's objectives that name a workspace
 *  (`source.ws`), grouped by that workspace: only there can they be computed. */
function organismKpiPlan(raw: unknown): Map<string, Array<{ key: string; source: RecordsKpiSource }>> {
  const plan = new Map<string, Array<{ key: string; source: RecordsKpiSource }>>();
  if (!Array.isArray(raw)) return plan;
  (raw as RawObjective[]).forEach((o, oi) => {
    ((o && Array.isArray(o.kpis) ? o.kpis : []) as RawKpi[]).forEach((k, ki) => {
      const ws = isRecordsSource(k?.source) ? (k.source as { ws?: unknown }).ws : undefined;
      if (typeof ws !== 'string' || !ws) return;
      const list = plan.get(ws) ?? [];
      list.push({ key: `${oi}.${ki}`, source: k.source as RecordsKpiSource });
      plan.set(ws, list);
    });
  });
  return plan;
}

/**
 * The organism's own objectives (`organism.<id>.meta.manifest`, the copy a creator or admin wrote
 * last, as the gate policy reads it). A KPI whose source names a workspace (`{ from:'records', ws,
 * space, agg }`) is computed from that workspace's records when the viewer may read it, and keeps
 * its declared value otherwise. `visit` lets the organism overview compute them during the
 * workspace pass it makes anyway; without it the named workspaces are read here.
 * No organism manifest, or one without objectives, answers [].
 */
export async function collectOrganismObjectives(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; viewerGaii: string; reader: ContentReader },
  raw?: unknown,
  values?: Map<string, number | null>,
  visited?: Set<string>,
): Promise<ObjectiveSummary[]> {
  const objectives = raw === undefined ? await readOrganismObjectives(storage, opts.orgId) : raw;
  const computed = values ?? new Map<string, number | null>();
  for (const [ws, entries] of organismKpiPlan(objectives)) {
    if (visited?.has(ws)) continue;
    await collectWorkspaceSummary(storage, config, {
      orgId: opts.orgId, ws, viewerGaii: opts.viewerGaii, reader: opts.reader, itemLimit: 0,
      onItems: kpiVisitor(entries, computed),
    });
  }
  return summarizeObjectives(objectives, (_s, oi, ki) => computed.get(`${oi}.${ki}`) ?? null);
}

/** The organism manifest's objectives array, or [] (services/organism/record-helpers.ts reads the copy). */
async function readOrganismObjectives(storage: Storage, orgId: string): Promise<unknown[]> {
  const manifest = await readOrganismMetaValue(storage, orgId, 'meta.manifest');
  return Array.isArray(manifest?.objectives) ? manifest.objectives as unknown[] : [];
}

type ItemsVisitor = (items: MemoryRecord[], objectTypes: ObjType[], root: string) => void;
function kpiVisitor(entries: Array<{ key: string; source: RecordsKpiSource }>, into: Map<string, number | null>): ItemsVisitor {
  return (items, objectTypes, root) => {
    for (const e of entries) into.set(e.key, evaluateRecordsKpi(items, objectTypes, root, e.source));
  };
}

/** A short, human display title for a record/document value (best-effort, schema-agnostic).
 *  Exported so the workspace-read index (aimeat_workspace_read) titles instances the SAME way the
 *  OKF overview does — one title convention across the map and the index. */
export function entryTitle(value: unknown, fallbackId: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const k of ['title', 'name', 'label', 'summary', 'heading']) {
      const s = v[k];
      if (typeof s === 'string' && s.trim()) return clip(s.trim(), 80);
    }
    const md = v.markdown;
    if (typeof md === 'string') { const h = firstHeading(md); if (h) return clip(h, 80); }
  } else if (typeof value === 'string' && value.trim()) {
    return clip(firstHeading(value) || value.trim(), 80);
  }
  return fallbackId || '(untitled)';
}

function firstHeading(md: string): string | null {
  for (const line of md.split('\n')) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
    if (line.trim()) return line.trim();   // first non-empty line if no heading
  }
  return null;
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

/** A one-line summary of a readme/markdown blob: the first prose line, skipping a leading title
 *  heading (a readme that opens with "# Name" — the heading just echoes the workspace name); falls
 *  back to the heading text if there is no prose. */
function oneLine(md: unknown): string | null {
  if (typeof md !== 'string') return null;
  const lines = md.split('\n').map(l => l.trim()).filter(Boolean);
  for (const l of lines) if (!/^#{1,6}\s/.test(l)) return clip(l, 120);
  return lines[0] ? clip(lines[0].replace(/^#{1,6}\s+/, ''), 120) : null;
}

/** Walk ONE workspace's memory keys and summarise its spaces. Mirrors the read authorization of
 *  GET /:id/workspace: the manifest is the single gate — if the viewer can read it they see all
 *  content; otherwise `readable:false` and the spaces are empty (the caller renders name-only). */
export async function collectWorkspaceSummary(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    orgId: string; ws: string; name?: string; viewerGaii: string; archived?: boolean; itemLimit?: number; reader: ContentReader;
    /** Called with the workspace's records when the viewer may read them: the organism's own KPIs
     *  that name this workspace are computed here, from the same read, under the same rule. */
    onItems?: ItemsVisitor;
  },
): Promise<WorkspaceSummary> {
  const { orgId, ws, viewerGaii } = opts;
  const itemLimit = opts.itemLimit ?? MAX_ITEMS;
  const root = `organism.${orgId}.w.${ws}`;
  const summary: WorkspaceSummary = {
    ws, name: opts.name || ws, readme: null, readable: false,
    spaces: [], skills: [], objectives: [], totalRecords: 0, totalDocuments: 0, lastActivity: null,
    archived: opts.archived ?? false, archivedCount: 0,
  };
  // The one loader (services/workspace/content.ts): it loads (version rows excluded in SQL), decides
  // the read with decideWorkspaceRead and passes the classification reader. A member who may not read
  // the workspace sees its name and readme; anyone else sees what the caller already knew.
  const got = await loadWorkspaceContent({ storage, config }, opts.reader,
    { sub: viewerGaii, ownerName: localAccountOf(viewerGaii) ?? undefined, accessorGaii: viewerGaii }, { organismId: orgId, ws });
  if (!got.ok || !got.descriptor.manifest) return summary;   // not a member / empty / non-existent workspace
  // Hint count of archived rows under this workspace (cheap aggregate; default-excluded everywhere else).
  try { summary.archivedCount = (await storage.countArchivedByKeyPrefix(`${root}.`)).archived; } catch (err) { logger.warn('collectWorkspaceSummary: best-effort', { error: String(err) }); }

  const manifest = got.descriptor.manifest.value as { name?: unknown; objectTypes?: ObjType[]; objectives?: RawObjective[] } | null;
  if (typeof manifest?.name === 'string') summary.name = manifest.name;
  summary.readme = oneLine(got.descriptor.readme?.value);
  summary.readable = got.canRead;
  if (!got.canRead) return summary;
  const items = got.items;
  opts.onItems?.(items, manifest?.objectTypes ?? [], root);
  const prefixes = spacePrefixesOf(root, manifest?.objectTypes);

  for (const ot of manifest?.objectTypes ?? []) {
    const name = typeof ot.name === 'string' ? ot.name : undefined;
    const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
    if (!name || !namespace || !isMemoryBackedSpace(ot)) continue;
    const mode: 'records' | 'document' = ot.mode === 'document' || (!ot.mode && ot.kind === 'document') ? 'document' : 'records';

    // Collapse each instance to its current value (latest ?? bare); drafts + version history are
    // not part of the published structure overview.
    const nsPrefix = `${root}.${namespace}.`;
    const current = new Map<string, MemoryRecord>();
    for (const r of items) {
      // The id is read from the end of the key (spaceRowAt), so a record whose id holds a dot is in
      // the overview under its whole id (secaudit2026oct31w2 round 10b).
      const row = spaceRowAt(r.key, nsPrefix, prefixes);
      if (row?.copy === 'bare' || row?.copy === 'latest') {
        const prev = current.get(row.id);
        // Prefer a `.latest` over a bare write; otherwise keep what we have.
        if (!prev || row.copy === 'latest') current.set(row.id, r);
      }
    }

    const entries: SpaceEntry[] = [...current.entries()]
      .map(([id, r]) => ({ id, title: entryTitle(r.value, id), updatedAt: r.updatedAt }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));

    summary.spaces.push({ name, namespace, mode, total: entries.length, recent: entries.slice(0, itemLimit) });
    if (mode === 'document') summary.totalDocuments += entries.length; else summary.totalRecords += entries.length;
    const newest = entries[0]?.updatedAt;
    if (newest && (!summary.lastActivity || newest > summary.lastActivity)) summary.lastActivity = newest;
  }
  // Stable space order: most-populated first, then by name — deterministic regardless of manifest order.
  summary.spaces.sort((a, b) => (b.total - a.total) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Workspace-scope SKILLS (skills registry, keys `{root}.skills.{name}.manifest`) — loadable
  // expertise, surfaced in the map so agents see it without a separate listing call. Multi-member
  // republish copies collapse freshest-wins (same rule as the registry resolver).
  const skillManifestRe = new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.skills\\.([a-z0-9-]+)\\.manifest$`);
  const freshestSkill = new Map<string, MemoryRecord>();
  for (const r of items) {
    if (!skillManifestRe.test(r.key)) continue;
    const prev = freshestSkill.get(r.key);
    if (!prev || String(r.updatedAt) > String(prev.updatedAt)) freshestSkill.set(r.key, r);
  }
  summary.skills = [...freshestSkill.values()]
    .map(r => {
      const v = r.value as { name?: unknown; description?: unknown; version?: unknown } | null;
      return {
        name: typeof v?.name === 'string' ? v.name : (r.key.match(skillManifestRe)?.[1] ?? ''),
        description: typeof v?.description === 'string' ? clip(v.description, 140) : '',
        version: typeof v?.version === 'string' ? v.version : '?',
        updatedAt: r.updatedAt,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  // Objectives + KPIs (measurability convention). A `from:'records'` KPI's `current` is computed from
  // this workspace's published records (the `items` already read above — no extra storage hit, same
  // authorization); a string-recipe / other source falls back to the declared `current`.
  const objectTypes = manifest?.objectTypes ?? [];
  summary.objectives = summarizeObjectives(manifest?.objectives, source => evaluateRecordsKpi(items, objectTypes, root, source));
  return summary;
}

/** Read the organism's workspace registry, aggregated across every member's record (a workspace is
 *  registered under its creator's own GHII), deduped by id. */
export async function listWorkspaces(storage: Storage, orgId: string): Promise<Array<{ id: string; name?: string; archived: boolean }>> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  // `include` so an archived organism's registry (cascade-archived with it) is still listable here.
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000, archived: 'include' });
  const seen = new Map<string, { id: string; name?: string; archived: boolean }>();
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = (rec.value as { workspaces?: Array<{ id?: string; name?: string; archived?: boolean }> } | null)?.workspaces ?? [];
    for (const w of list) if (typeof w?.id === 'string' && !seen.has(w.id)) seen.set(w.id, { id: w.id, name: w.name, archived: w.archived === true });
  }
  return [...seen.values()];
}

function fm(lines: Record<string, string | number>): string {
  const body = Object.entries(lines).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : v}`).join('\n');
  return `---\n${body}\n---\n`;
}

function date(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

/** DEEP overview of one workspace: per space, the newest ANSWER_PAGE_DEFAULT entries' id + title and
 *  the total (the agent's table of contents for a targeted batch read). */
export async function buildWorkspaceOverview(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; ws: string; name?: string; viewerGaii: string; reader: ContentReader },
): Promise<{ markdown: string; readable: boolean; summary: WorkspaceSummary }> {
  // DEEP view of ONE workspace: more entries per space than the SHALLOW organism overview's
  // MAX_ITEMS, so a space of 40 documents shows all its ids. It listed EVERY entry until 2026-11-24,
  // on the reasoning that titles stay small: a space of 1040 records made a map of over 100 000
  // characters, more than a client accepts in one answer (models/answer-budget.ts). The rest of a
  // space is read in pages, or found by title, with aimeat_workspace_read.
  const s = await collectWorkspaceSummary(storage, config, { ...opts, itemLimit: ANSWER_PAGE_DEFAULT });
  const out: string[] = [];
  out.push(fm({
    okf_type: 'workspace-structure-overview',
    organism_id: opts.orgId,
    workspace_id: s.ws,
    title: s.name,
    records: s.totalRecords,
    documents: s.totalDocuments,
    last_activity: date(s.lastActivity),
  }));
  out.push(`# ${s.name} — structure overview\n`);
  if (!s.readable) {
    out.push('> _You do not have read access to this workspace._\n');
    return { markdown: out.join('\n'), readable: false, summary: s };
  }
  if (s.archived) out.push('> 🗄️ _This workspace is **archived** (read-only)._\n');
  if (s.readme) out.push(`> ${s.readme}\n`);
  out.push(`> ${s.totalRecords} records · ${s.totalDocuments} documents · ${s.spaces.length} spaces${s.archivedCount ? ` · ${s.archivedCount} archived` : ''} · last activity ${date(s.lastActivity)}\n`);
  out.push(...objectiveLines(s.objectives, '##'));
  if (!s.spaces.length) out.push('_No spaces with content yet._\n');
  for (const sp of s.spaces) out.push(...spaceLines(sp, '##'));
  if (s.spaces.some(sp => sp.total > sp.recent.length)) {
    out.push('> A space with more entries than it shows lists its newest. Read the rest in pages with `aimeat_workspace_read` (`space`, then `cursor`), or find one record by its title with `q`.\n');
  }
  out.push(...skillLines(opts.orgId, s.ws, s.skills, '##'));
  return { markdown: out.join('\n'), readable: true, summary: s };
}

/** Render a workspace's registry skills: loadable expertise with ready-to-use refs. An agent copies
 *  the ref straight into aimeat_skill_get / aimeat_skill_link — the map answers "what expertise is
 *  here" without a separate listing call. */
function skillLines(orgId: string, ws: string, skills: WsSkillSummary[], hashes: string): string[] {
  if (!skills.length) return [];
  const lines = [`${hashes} Skills (loadable expertise) — ${skills.length}`, ''];
  lines.push('| Skill | Ref | v | Description |', '|---|---|---|---|');
  for (const sk of skills) {
    lines.push(`| **${cell(sk.name)}** | \`ws:${orgId}/${ws}/${sk.name}\` | ${sk.version} | ${cell(sk.description)} |`);
  }
  lines.push('');
  return lines;
}

/** A title is rendered into a Markdown table CELL — the table parser splits on raw `|`, so a pipe in
 *  the title would break the row. Swap it for a look-alike broken bar (titles are already single-line
 *  via clip()). */
function cell(title: string): string {
  return title.replace(/\|/g, '¦');
}

/** Render one space as Markdown lines: a heading (`{hashes} name (mode) — total`) + a 3-column TABLE
 *  of its most-recent entries (Title · ID · Updated) up to MAX_ITEMS, with a "N of M shown" hint when
 *  more exist. The table renders as aligned columns (vs the old inline "title · id · date" run-on),
 *  so a human scans down a column and an agent still reads the same fields. Shared by the workspace
 *  overview (## spaces) and the organism overview (### spaces under each ## workspace) so BOTH carry
 *  the same per-entry detail — the organism view is the workspace views composed, not a lossy splat. */
function spaceLines(sp: SpaceSummary, hashes: string): string[] {
  const lines = [`${hashes} ${sp.name} (${sp.mode}) — ${sp.total}`, ''];
  if (sp.total === 0) { lines.push('_empty_', ''); return lines; }
  lines.push('| Title | ID | Updated |', '|---|---|---|');
  for (const e of sp.recent) lines.push(`| **${cell(e.title)}** | \`${e.id}\` | ${date(e.updatedAt)} |`);
  lines.push('');
  if (sp.total > sp.recent.length) lines.push(`_… ${sp.recent.length} of ${sp.total} shown — open the space for the rest_`, '');
  return lines;
}

/** "≤ 5" / "< 80000" / "between 2 and 4" — a human rendering of a KPI target. */
function targetText(t: ObjectiveSummary['kpis'][number]['target']): string | null {
  if (!t || typeof t.op !== 'string') return null;
  if (t.op === 'between' && Array.isArray(t.values) && t.values.length === 2) return `between ${t.values[0]} and ${t.values[1]}`;
  const sym = t.op === '<=' ? '≤' : t.op === '>=' ? '≥' : t.op === '==' ? '=' : t.op;
  return typeof t.value === 'number' ? `${sym} ${t.value}` : null;
}

/** Does `current` meet the target? null when undecidable (no current / no target). */
function meetsTarget(current: number | null, t: ObjectiveSummary['kpis'][number]['target']): boolean | null {
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

/** Render a workspace's objectives as Markdown lines: each objective a bullet with its KPIs as
 *  "current vs target" sub-bullets (✅ met · ⚠️ off-target · — not yet measured). */
function objectiveLines(objectives: ObjectiveSummary[], hashes: string, title = 'Objectives'): string[] {
  if (!objectives.length) return [];
  const lines = [`${hashes} ${title}`, ''];
  for (const o of objectives) {
    // The level first, because it says how much the objective weighs; the date it holds until and a
    // status other than active after it.
    const tags = [o.level, o.until ? `until ${o.until}` : undefined, o.status && o.status !== 'active' ? o.status : undefined].filter(Boolean);
    const tag = tags.length ? ` _(${tags.join(' · ')})_` : '';
    lines.push(`- **${o.statement || o.id}**${tag}`);
    if (o.serves?.length) lines.push(`  - serves: ${o.serves.map(s => `${s.organism} / ${s.objective}`).join(', ')}`);
    for (const k of o.kpis) {
      const cur = k.current === null ? '—' : String(k.current);
      const tgt = targetText(k.target);
      const ok = meetsTarget(k.current, k.target);
      const mark = ok === null ? '' : ok ? ' ✅' : ' ⚠️';
      const unit = k.unit ? ` ${k.unit}` : '';
      const vs = tgt ? ` (target ${tgt})` : '';
      const src = k.computed ? '' : ' _·declared_';
      lines.push(`  - ${k.name}: ${cur}${unit}${vs}${mark}${src}`);
    }
  }
  lines.push('');
  return lines;
}

/** Overview of a whole organism — its workspaces COMPOSED at the same fidelity as a single workspace
 *  overview: each workspace is a `##` section with its spaces (`###`) and the same recent entries
 *  (ids + titles). Not a count-only splat — a reader (human or agent) can navigate straight to a
 *  specific record's id from the organism view. Bounded by MAX_ITEMS per space (totals always shown). */
export async function buildOrganismOverview(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; viewerGaii: string; includeArchived?: boolean; reader: ContentReader },
): Promise<{ markdown: string; workspaces: number; archivedWorkspaces: number; objectives: ObjectiveSummary[] }> {
  const { orgId, viewerGaii, includeArchived } = opts;
  const org = await storage.getOrganism(orgId);
  const allWss = await listWorkspaces(storage, orgId);
  // Active workspaces drive the AI working set; archived ones are summarised as a count (or listed
  // only when includeArchived is set) so they stay out of the materials yet remain discoverable.
  const archivedWss = allWss.filter(w => w.archived);
  const wss = includeArchived ? allWss : allWss.filter(w => !w.archived);
  // The organism's own objectives: their KPIs that name a workspace are computed during the
  // workspace pass below, from the read it makes anyway, so the overview reads no workspace twice.
  const rawObjectives = await readOrganismObjectives(storage, orgId);
  const plan = organismKpiPlan(rawObjectives);
  const kpiValues = new Map<string, number | null>();
  const visited = new Set<string>();
  const summaries: WorkspaceSummary[] = [];
  for (const w of wss) {
    const entries = plan.get(w.id);
    summaries.push(await collectWorkspaceSummary(storage, config, {
      orgId, ws: w.id, name: w.name, viewerGaii, archived: w.archived, reader: opts.reader,
      ...(entries ? { onItems: kpiVisitor(entries, kpiValues) } : {}),
    }));
    visited.add(w.id);
  }
  const objectives = await collectOrganismObjectives(storage, config, { orgId, viewerGaii, reader: opts.reader }, rawObjectives, kpiValues, visited);

  const totalRecords = summaries.reduce((n, s) => n + s.totalRecords, 0);
  const totalDocs = summaries.reduce((n, s) => n + s.totalDocuments, 0);
  const orgName = org?.name || orgId;

  const out: string[] = [];
  out.push(fm({
    okf_type: 'organism-structure-overview',
    organism_id: orgId,
    title: orgName,
    workspaces: summaries.length,
    records: totalRecords,
    documents: totalDocs,
  }));
  out.push(`# ${orgName} — structure overview\n`);
  if (org?.archived) out.push('> 🗄️ _This organism is **archived** (read-only)._\n');
  if (org?.description) out.push(`> ${clip(org.description, 200)}\n`);
  const activeCount = summaries.filter(s => !s.archived).length;
  out.push(`> ${activeCount} workspaces · ${totalRecords} records · ${totalDocs} documents${archivedWss.length && !includeArchived ? ` · ${archivedWss.length} archived` : ''}\n`);
  // The direction of the whole organism, before the workspaces that serve it.
  out.push(...objectiveLines(objectives, '##', 'Organism objectives'));
  if (!summaries.length) out.push(includeArchived ? '_No workspaces yet._\n' : '_No active workspaces._\n');
  for (const s of summaries) {
    out.push(`## ${s.name}  ·  \`${s.ws}\`${s.archived ? '  🗄️ _archived_' : ''}`);
    if (!s.readable) { out.push('_no read access_\n'); continue; }
    if (s.readme) out.push(`> ${s.readme}`);
    const arch = s.archivedCount ? ` · ${s.archivedCount} archived` : '';
    out.push(`> ${s.totalRecords} records · ${s.totalDocuments} documents${arch} · last activity ${date(s.lastActivity)}\n`);
    out.push(...objectiveLines(s.objectives, '###'));
    if (!s.spaces.length && !s.objectives.length && !s.skills.length) { out.push('_no content yet_\n'); continue; }
    for (const sp of s.spaces) out.push(...spaceLines(sp, '###'));
    out.push(...skillLines(orgId, s.ws, s.skills, '###'));
  }
  // Footer: name the archived workspaces (not their content) so a reader knows what to ask for.
  if (archivedWss.length && !includeArchived) {
    out.push(`\n---\n_🗄️ ${archivedWss.length} archived workspace${archivedWss.length === 1 ? '' : 's'}: ${archivedWss.map(w => `**${w.name || w.id}**`).join(', ')}. Add \`?includeArchived=true\` to include them._`);
  }
  // `workspaces` = the number actually rendered in THIS view (active-only by default; active+archived
  // when includeArchived). `archivedWorkspaces` is always the archived count regardless of the view.
  return { markdown: out.join('\n'), workspaces: summaries.length, archivedWorkspaces: archivedWss.length, objectives };
}
