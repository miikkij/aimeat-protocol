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
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner } from '../utils/gaii.js';
import { isMemoryBackedSpace } from './workspace-meta.js';

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
export interface WorkspaceSummary {
  ws: string;
  name: string;
  readme: string | null;
  readable: boolean;
  spaces: SpaceSummary[];
  totalRecords: number;
  totalDocuments: number;
  lastActivity: string | null;   // ISO of the most-recently-updated content key, deterministic
}

type ObjType = { name?: unknown; namespace?: unknown; mode?: unknown; kind?: unknown; backing?: unknown };

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
  opts: { orgId: string; ws: string; name?: string; viewerGaii: string },
): Promise<WorkspaceSummary> {
  const { orgId, ws, viewerGaii } = opts;
  const root = `organism.${orgId}.w.${ws}`;
  const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000 });

  const manRec = items.find(r => r.key === `${root}.meta.manifest`);
  const summary: WorkspaceSummary = {
    ws, name: opts.name || ws, readme: null, readable: false,
    spaces: [], totalRecords: 0, totalDocuments: 0, lastActivity: null,
  };
  if (!manRec) return summary;   // empty / non-existent workspace

  let readable = manRec.ownerGaii === viewerGaii || isSameOwner(manRec.ownerGaii, viewerGaii);
  if (!readable) {
    const d = await authorizeRead(storage, config, {
      ownerGaii: manRec.ownerGaii, accessorGaii: viewerGaii, resourceKey: manRec.key,
      visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
    });
    readable = d.allowed;
  }
  const manifest = manRec.value as { name?: unknown; objectTypes?: ObjType[] } | null;
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
  return summary;
}

/** Read the organism's workspace registry, aggregated across every member's record (a workspace is
 *  registered under its creator's own GHII), deduped by id. */
async function listWorkspaces(storage: Storage, orgId: string): Promise<Array<{ id: string; name?: string }>> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  const seen = new Map<string, { id: string; name?: string }>();
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = (rec.value as { workspaces?: Array<{ id?: string; name?: string }> } | null)?.workspaces ?? [];
    for (const w of list) if (typeof w?.id === 'string' && !seen.has(w.id)) seen.set(w.id, { id: w.id, name: w.name });
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
  if (s.readme) out.push(`> ${s.readme}\n`);
  out.push(`> ${s.totalRecords} records · ${s.totalDocuments} documents · ${s.spaces.length} spaces · last activity ${date(s.lastActivity)}\n`);
  if (!s.spaces.length) out.push('_No spaces with content yet._\n');
  for (const sp of s.spaces) {
    out.push(`## ${sp.name} (${sp.mode}) — ${sp.total}\n`);
    for (const e of sp.recent) out.push(`- **${e.title}**  ·  \`${e.id}\`  ·  ${date(e.updatedAt)}`);
    if (sp.total > sp.recent.length) out.push(`- _… showing ${sp.recent.length} most recent of ${sp.total} — read the space for the rest_`);
    out.push('');
  }
  return { markdown: out.join('\n'), readable: true, summary: s };
}

/** SHALLOW overview of a whole organism: each workspace's space breakdown + counts + totals. */
export async function buildOrganismOverview(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; viewerGaii: string },
): Promise<{ markdown: string; workspaces: number }> {
  const { orgId, viewerGaii } = opts;
  const org = await storage.getOrganism(orgId);
  const wss = await listWorkspaces(storage, orgId);
  const summaries: WorkspaceSummary[] = [];
  for (const w of wss) summaries.push(await collectWorkspaceSummary(storage, config, { orgId, ws: w.id, name: w.name, viewerGaii }));

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
  if (org?.description) out.push(`> ${clip(org.description, 200)}\n`);
  out.push(`> ${summaries.length} workspaces · ${totalRecords} records · ${totalDocs} documents\n`);
  out.push('## Workspaces\n');
  if (!summaries.length) out.push('_No workspaces yet._\n');
  for (const s of summaries) {
    out.push(`### ${s.name}  ·  \`${s.ws}\``);
    if (!s.readable) { out.push('_no read access_\n'); continue; }
    if (s.readme) out.push(s.readme);
    const breakdown = s.spaces.length
      ? s.spaces.map(sp => `${sp.name} (${sp.total})`).join(' · ')
      : '_no content yet_';
    out.push(`**${s.totalRecords + s.totalDocuments} items** — ${breakdown}`);
    out.push(`_last activity ${date(s.lastActivity)}_\n`);
  }
  return { markdown: out.join('\n'), workspaces: summaries.length };
}
