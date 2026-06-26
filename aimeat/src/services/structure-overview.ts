/**
 * @file structure-overview.ts
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
 *   import { buildOrganismOverview, buildWorkspaceOverview } from '../services/structure-overview.js';
 *   const md = await buildOrganismOverview(storage, config, { orgId, viewerGaii });
 * @version-history
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
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner } from '../utils/gaii.js';
import { isMemoryBackedSpace } from './workspace-meta.js';
import { isRecordsSource, evaluateRecordsKpi } from './kpi-rollup.js';

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
  kpis: KpiSummary[];
}
export interface WorkspaceSummary {
  ws: string;
  name: string;
  readme: string | null;
  readable: boolean;
  spaces: SpaceSummary[];
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
type RawObjective = { id?: unknown; statement?: unknown; why?: unknown; status?: unknown; kpis?: unknown };

/** A short, human display title for a record/document value (best-effort, schema-agnostic). */
function entryTitle(value: unknown, fallbackId: string): string {
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
  opts: { orgId: string; ws: string; name?: string; viewerGaii: string; archived?: boolean },
): Promise<WorkspaceSummary> {
  const { orgId, ws, viewerGaii } = opts;
  const root = `organism.${orgId}.w.${ws}`;
  const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000 });

  const manRec = items.find(r => r.key === `${root}.meta.manifest`);
  const summary: WorkspaceSummary = {
    ws, name: opts.name || ws, readme: null, readable: false,
    spaces: [], objectives: [], totalRecords: 0, totalDocuments: 0, lastActivity: null,
    archived: opts.archived ?? false, archivedCount: 0,
  };
  if (!manRec) return summary;   // empty / non-existent workspace
  // Hint count of archived rows under this workspace (cheap aggregate; default-excluded everywhere else).
  try { summary.archivedCount = (await storage.countArchivedByKeyPrefix(`${root}.`)).archived; } catch { /* best-effort */ }

  let readable = manRec.ownerGaii === viewerGaii || isSameOwner(manRec.ownerGaii, viewerGaii);
  if (!readable) {
    const d = await authorizeRead(storage, config, {
      ownerGaii: manRec.ownerGaii, accessorGaii: viewerGaii, resourceKey: manRec.key,
      visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
    });
    readable = d.allowed;
  }
  const manifest = manRec.value as { name?: unknown; objectTypes?: ObjType[]; objectives?: RawObjective[] } | null;
  if (typeof manifest?.name === 'string') summary.name = manifest.name;
  summary.readme = oneLine(items.find(r => r.key === `${root}.meta.readme`)?.value);
  summary.readable = readable;
  if (!readable) return summary;

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
      if (!r.key.startsWith(nsPrefix)) continue;
      const rest = r.key.slice(nsPrefix.length).split('.');
      const id = rest[0];
      const role = rest.slice(1).join('.');
      if (role === '' || role === 'latest') {
        const prev = current.get(id);
        // Prefer a `.latest` over a bare write; otherwise keep what we have.
        if (!prev || role === 'latest') current.set(id, r);
      }
    }

    const entries: SpaceEntry[] = [...current.entries()]
      .map(([id, r]) => ({ id, title: entryTitle(r.value, id), updatedAt: r.updatedAt }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));

    summary.spaces.push({ name, namespace, mode, total: entries.length, recent: entries.slice(0, MAX_ITEMS) });
    if (mode === 'document') summary.totalDocuments += entries.length; else summary.totalRecords += entries.length;
    const newest = entries[0]?.updatedAt;
    if (newest && (!summary.lastActivity || newest > summary.lastActivity)) summary.lastActivity = newest;
  }
  // Stable space order: most-populated first, then by name — deterministic regardless of manifest order.
  summary.spaces.sort((a, b) => (b.total - a.total) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Objectives + KPIs (measurability convention). A `from:'records'` KPI's `current` is computed from
  // this workspace's published records (the `items` already read above — no extra storage hit, same
  // authorization); a string-recipe / other source falls back to the declared `current`.
  const objectTypes = manifest?.objectTypes ?? [];
  for (const o of manifest?.objectives ?? []) {
    if (!o || typeof o.id !== 'string') continue;
    const kpis: KpiSummary[] = [];
    for (const k of (Array.isArray(o.kpis) ? o.kpis : []) as RawKpi[]) {
      if (!k || typeof k.name !== 'string') continue;
      let current = typeof k.current === 'number' ? k.current : null;
      let computed = false;
      if (isRecordsSource(k.source)) {
        const v = evaluateRecordsKpi(items, objectTypes, root, k.source);
        if (v !== null) { current = v; computed = true; }
      }
      kpis.push({
        name: k.name,
        kind: typeof k.kind === 'string' ? k.kind : undefined,
        unit: typeof k.unit === 'string' ? k.unit : undefined,
        target: (k.target && typeof k.target === 'object') ? k.target as KpiSummary['target'] : undefined,
        current, computed,
        measuredAt: typeof k.measuredAt === 'string' ? k.measuredAt : undefined,
      });
    }
    summary.objectives.push({
      id: o.id,
      statement: typeof o.statement === 'string' ? o.statement : undefined,
      why: typeof o.why === 'string' ? o.why : undefined,
      status: typeof o.status === 'string' ? o.status : undefined,
      kpis,
    });
  }
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

/** DEEP overview of one workspace: per space, the last MAX_ITEMS entries with ids + titles. */
export async function buildWorkspaceOverview(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; ws: string; name?: string; viewerGaii: string },
): Promise<{ markdown: string; readable: boolean; summary: WorkspaceSummary }> {
  const s = await collectWorkspaceSummary(storage, config, opts);
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
  return { markdown: out.join('\n'), readable: true, summary: s };
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
function objectiveLines(objectives: ObjectiveSummary[], hashes: string): string[] {
  if (!objectives.length) return [];
  const lines = [`${hashes} Objectives`, ''];
  for (const o of objectives) {
    const tag = o.status && o.status !== 'active' ? ` _(${o.status})_` : '';
    lines.push(`- **${o.statement || o.id}**${tag}`);
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
  opts: { orgId: string; viewerGaii: string; includeArchived?: boolean },
): Promise<{ markdown: string; workspaces: number; archivedWorkspaces: number }> {
  const { orgId, viewerGaii, includeArchived } = opts;
  const org = await storage.getOrganism(orgId);
  const allWss = await listWorkspaces(storage, orgId);
  // Active workspaces drive the AI working set; archived ones are summarised as a count (or listed
  // only when includeArchived is set) so they stay out of the materials yet remain discoverable.
  const archivedWss = allWss.filter(w => w.archived);
  const wss = includeArchived ? allWss : allWss.filter(w => !w.archived);
  const summaries: WorkspaceSummary[] = [];
  for (const w of wss) summaries.push(await collectWorkspaceSummary(storage, config, { orgId, ws: w.id, name: w.name, viewerGaii, archived: w.archived }));

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
  if (!summaries.length) out.push(includeArchived ? '_No workspaces yet._\n' : '_No active workspaces._\n');
  for (const s of summaries) {
    out.push(`## ${s.name}  ·  \`${s.ws}\`${s.archived ? '  🗄️ _archived_' : ''}`);
    if (!s.readable) { out.push('_no read access_\n'); continue; }
    if (s.readme) out.push(`> ${s.readme}`);
    const arch = s.archivedCount ? ` · ${s.archivedCount} archived` : '';
    out.push(`> ${s.totalRecords} records · ${s.totalDocuments} documents${arch} · last activity ${date(s.lastActivity)}\n`);
    out.push(...objectiveLines(s.objectives, '###'));
    if (!s.spaces.length && !s.objectives.length) { out.push('_no content yet_\n'); continue; }
    for (const sp of s.spaces) out.push(...spaceLines(sp, '###'));
  }
  // Footer: name the archived workspaces (not their content) so a reader knows what to ask for.
  if (archivedWss.length && !includeArchived) {
    out.push(`\n---\n_🗄️ ${archivedWss.length} archived workspace${archivedWss.length === 1 ? '' : 's'}: ${archivedWss.map(w => `**${w.name || w.id}**`).join(', ')}. Add \`?includeArchived=true\` to include them._`);
  }
  // `workspaces` = the number actually rendered in THIS view (active-only by default; active+archived
  // when includeArchived). `archivedWorkspaces` is always the archived count regardless of the view.
  return { markdown: out.join('\n'), workspaces: summaries.length, archivedWorkspaces: archivedWss.length };
}
