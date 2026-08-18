/**
 * @file dangling-refs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read-only referential-integrity scan for an organism's workspaces: finds reference
 *   fields (and prose mentions) that point to an id which no longer exists — or was archived — in the
 *   SAME workspace. It NEVER blocks a write; it only surfaces findings (the anomaliavahti / TARGET-009
 *   family philosophy: flag, don't gate). Two detectors:
 *     1. Structured refs on records — the data-convention fields `must_read`, `refs`, `born_from.docs`
 *        (arrays) and `parent_id`, `target_id`, `card_id`, `release_id` (scalars). These are client
 *        conventions, not backend schema, so the field list is plain data.
 *     2. Prose mentions in documents — id-shaped tokens in a `{title, markdown}` document body, keyed
 *        to the id PREFIXES the workspace actually uses (derived per workspace, so it stays generic
 *        across organisms) and with fenced ``` code blocks stripped first (schema placeholders like
 *        `doc-idt` live in fences and must not be flagged).
 *   Each candidate id is classified against the workspace's own id sets: present & live → OK; present
 *   only as an archived row → `archived`; absent everywhere → `dangling`.
 * @structure
 *   - scanOrganismDanglingRefs(storage, config, organism, callerGaii, onlyWs?) -> { findings, scannedWorkspaces, truncated }
 *   - DanglingRefFinding — { ws, wsName?, space, namespace, instance, title, field, kind, refId, state }
 * @usage
 *   import { scanOrganismDanglingRefs } from '../services/dangling-refs.js';
 *   const { findings } = await scanOrganismDanglingRefs(storage, config, organism, callerGaii, ws);
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Initial (TARGET-023): read-only dangling-reference scan shared by the
 *     REST route GET /v1/organisms/:id/workspace/dangling-refs. Same manifest read gate as the
 *     workspace read; structured-field + fence-stripped prose detectors; same-workspace resolution.
 *   v1.1.0 -- 2026-07-16 -- Scans exclude `.version.N` rows in SQL (excludeVersionRows) — history
 *     rows were loaded with full values then dropped by the role filter.
 */
import type { Storage, MemoryRecord, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner } from '../utils/gaii.js';

export interface DanglingRefFinding {
  ws: string;
  wsName?: string;
  space: string;        // objectType name that holds the SOURCE record
  namespace: string;    // the objectType namespace (e.g. room.target)
  instance: string;     // the SOURCE record's instance id
  title: string;        // human title of the source record
  field: string;        // which field/path carried the ref ('must_read', 'born_from.docs', 'markdown', …)
  kind: 'ref' | 'mention';   // structured pointer vs prose mention
  refId: string;        // the referenced id that failed to resolve
  state: 'dangling' | 'archived';   // absent everywhere vs present only as an archived row
}

/** Structured id-array fields (client data conventions). */
const ARRAY_REF_FIELDS = ['must_read', 'refs'] as const;
/** Nested id-array fields, expressed as a path a.b (e.g. born_from.docs). */
const NESTED_ARRAY_REF_FIELDS: ReadonlyArray<readonly [string, string]> = [['born_from', 'docs']];
/** Scalar id fields. */
const SCALAR_REF_FIELDS = ['parent_id', 'target_id', 'card_id', 'release_id'] as const;

const MAX_FINDINGS = 500;

/** Parse `organism.{id}.w.{ws}.{rest}` → { ws, rest } (rest = namespace.instance[.role]). */
function parseWsKey(key: string, orgId: string): { ws: string; rest: string } | null {
  const root = `organism.${orgId}.w.`;
  if (!key.startsWith(root)) return null;
  const after = key.slice(root.length);
  const dot = after.indexOf('.');
  if (dot < 0) return null;
  return { ws: after.slice(0, dot), rest: after.slice(dot + 1) };
}

/** Objecttypes → [{ name, ns }] sorted longest-namespace-first so nested namespaces match first. */
function manifestTypes(manRec: MemoryRecord): Array<{ name: string; ns: string; mode: string }> {
  const manifest = manRec.value as { objectTypes?: Array<Record<string, unknown>> } | undefined;
  return (manifest?.objectTypes ?? [])
    .map(ot => ({ name: String(ot.name ?? ''), ns: String(ot.namespace ?? ''), mode: String(ot.mode ?? 'records') }))
    .filter(t => t.name && t.ns)
    .sort((a, b) => b.ns.length - a.ns.length);
}

/** Resolve a workspace record key's { space, namespace, instance, role } against the manifest types. */
function resolveRecord(
  rest: string,
  types: Array<{ name: string; ns: string; mode: string }>,
): { space: string; namespace: string; instance: string; role: string; mode: string } | null {
  const ot = types.find(t => rest.startsWith(t.ns + '.'));
  if (!ot) return null;
  const tail = rest.slice(ot.ns.length + 1);
  const dot = tail.indexOf('.');
  const instance = dot < 0 ? tail : tail.slice(0, dot);
  const role = dot < 0 ? '' : tail.slice(dot + 1);
  return { space: ot.name, namespace: ot.ns, instance, role, mode: ot.mode };
}

/** The human title of a source record value. */
function titleOf(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return String(o.title ?? o.name ?? o.label ?? o.summary ?? fallback);
  }
  return fallback;
}

/** Pull the structured id refs out of one record value → [{ field, refId }]. */
function structuredRefs(value: unknown): Array<{ field: string; refId: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const o = value as Record<string, unknown>;
  const out: Array<{ field: string; refId: string }> = [];
  const pushId = (field: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push({ field, refId: v.trim() });
  };
  for (const f of ARRAY_REF_FIELDS) {
    if (Array.isArray(o[f])) for (const v of o[f] as unknown[]) pushId(f, v);
  }
  for (const [a, b] of NESTED_ARRAY_REF_FIELDS) {
    const parent = o[a];
    if (parent && typeof parent === 'object' && Array.isArray((parent as Record<string, unknown>)[b])) {
      for (const v of (parent as Record<string, unknown>)[b] as unknown[]) pushId(`${a}.${b}`, v);
    }
  }
  for (const f of SCALAR_REF_FIELDS) pushId(f, o[f]);
  return out;
}

/**
 * Prose mentions in a document body: strip fenced ``` code blocks (schema placeholders live there),
 * then extract id-shaped tokens whose PREFIX (segment before the first - or _) is one the workspace
 * actually uses. Deduped per document. Keeping this keyed to the workspace's own prefixes makes it
 * generic (no hardcoded id vocabulary) and skips unrelated tokens like `app-dev`.
 */
function proseMentions(markdown: string, knownPrefixes: Set<string>): Array<{ field: string; refId: string }> {
  const noFences = markdown.replace(/```[\s\S]*?```/g, ' ');
  const tokens = noFences.match(/\b[A-Za-z][A-Za-z0-9]*[-_][A-Za-z0-9][A-Za-z0-9_-]*\b/g) ?? [];
  const seen = new Set<string>();
  const out: Array<{ field: string; refId: string }> = [];
  for (const tok of tokens) {
    const prefix = tok.split(/[-_]/)[0];
    if (!knownPrefixes.has(prefix)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push({ field: 'markdown', refId: tok });
  }
  return out;
}

/** Scan ONE workspace. Returns findings + whether the caller could read it. */
async function scanWorkspace(
  storage: Storage,
  config: AimeatConfig,
  orgId: string,
  ws: string,
  wsName: string | undefined,
  callerGaii: string,
  budget: { left: number },
): Promise<{ readable: boolean; findings: DanglingRefFinding[] }> {
  const nsRoot = `organism.${orgId}.w.${ws}.`;

  // Live rows (archived excluded by default) + archived-only rows, in two bounded scans.
  // excludeVersionRows: the scan skips `.version.N` rows in SQL (they were loaded then discarded).
  const live = (await storage.listAllMemory({ prefix: nsRoot, limit: 5000, excludeVersionRows: true })).items;
  const manRec = live.find(r => r.key === `${nsRoot}meta.manifest`);
  if (!manRec) return { readable: false, findings: [] };

  // Same workspace-level read gate as GET /:id/workspace — the manifest is the single gate record.
  let canRead = manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii);
  if (!canRead) {
    const decision = await authorizeRead(storage, config, {
      ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
      visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
    });
    canRead = decision.allowed;
  }
  if (!canRead) return { readable: false, findings: [] };

  const archived = (await storage.listAllMemory({ prefix: nsRoot, limit: 5000, archived: 'only', excludeVersionRows: true })).items;
  const types = manifestTypes(manRec);

  // Existence sets, keyed by instance id across ALL declared namespaces (an id resolves if it exists
  // anywhere in the workspace). "Exists" = any live latest/bare/draft row; drafts count so a ref to an
  // unpublished-but-present id is not called dangling. Skip meta.* and version history.
  const existsIds = new Set<string>();
  const archivedIds = new Set<string>();
  const knownPrefixes = new Set<string>();
  const addPrefix = (id: string) => { const p = id.split(/[-_]/)[0]; if (p) knownPrefixes.add(p); };

  for (const r of live) {
    const parsed = parseWsKey(r.key, orgId);
    if (!parsed || parsed.rest.startsWith('meta.')) continue;
    const rec = resolveRecord(parsed.rest, types);
    if (!rec || rec.role.startsWith('version.')) continue;
    existsIds.add(rec.instance);
    addPrefix(rec.instance);
  }
  for (const r of archived) {
    const parsed = parseWsKey(r.key, orgId);
    if (!parsed || parsed.rest.startsWith('meta.')) continue;
    const rec = resolveRecord(parsed.rest, types);
    if (!rec || rec.role.startsWith('version.')) continue;
    archivedIds.add(rec.instance);
    addPrefix(rec.instance);
  }

  // Classify one candidate id against the workspace's own sets.
  const classify = (refId: string): 'ok' | 'dangling' | 'archived' =>
    existsIds.has(refId) ? 'ok' : (archivedIds.has(refId) ? 'archived' : 'dangling');

  const findings: DanglingRefFinding[] = [];

  // Collapse to the current value per (space, instance): prefer latest over bare; skip draft + version.
  // We scan the CURRENT published/bare value of each record (the live surface a reviewer sees).
  const current = new Map<string, { space: string; namespace: string; instance: string; rec: MemoryRecord; role: string }>();
  for (const r of live) {
    const parsed = parseWsKey(r.key, orgId);
    if (!parsed || parsed.rest.startsWith('meta.')) continue;
    const rec = resolveRecord(parsed.rest, types);
    if (!rec) continue;
    if (rec.role === 'draft' || rec.role.startsWith('version.')) continue;
    const k = `${rec.space}/${rec.instance}`;
    const prev = current.get(k);
    const better = !prev || (rec.role === 'latest' && prev.role !== 'latest');
    if (better) current.set(k, { space: rec.space, namespace: rec.namespace, instance: rec.instance, rec: r, role: rec.role });
  }

  for (const src of current.values()) {
    if (budget.left <= 0) break;
    const value = src.rec.value;
    const title = titleOf(value, src.instance);
    // Structured refs on records; prose mentions on document bodies ({title, markdown}).
    const md = (value && typeof value === 'object' && typeof (value as Record<string, unknown>).markdown === 'string')
      ? (value as Record<string, unknown>).markdown as string
      : null;
    const candidates: Array<{ field: string; refId: string; kind: 'ref' | 'mention' }> = [
      ...structuredRefs(value).map(c => ({ ...c, kind: 'ref' as const })),
      ...(md ? proseMentions(md, knownPrefixes).map(c => ({ ...c, kind: 'mention' as const })) : []),
    ];
    for (const c of candidates) {
      if (c.refId === src.instance) continue;   // self-reference is not dangling
      const state = classify(c.refId);
      if (state === 'ok') continue;
      findings.push({
        ws, wsName, space: src.space, namespace: src.namespace, instance: src.instance,
        title, field: c.field, kind: c.kind, refId: c.refId, state,
      });
      if (--budget.left <= 0) break;
    }
  }

  return { readable: true, findings };
}

export async function scanOrganismDanglingRefs(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  callerGaii: string,
  onlyWs?: string,
): Promise<{ findings: DanglingRefFinding[]; scannedWorkspaces: string[]; truncated: boolean }> {
  const id = organism.id;

  // Workspace registry (owner-agnostic prefix scan) — id list + names.
  const regKey = `organism.${id}.meta.workspaces`;
  const regScan = await storage.listAllMemory({ prefix: regKey, limit: 50 });
  const wsName = new Map<string, string>();
  const registered: string[] = [];
  for (const rec of regScan.items) {
    if (rec.key !== regKey) continue;
    for (const w of ((rec.value as { workspaces?: Array<{ id: string; name?: string }> } | undefined)?.workspaces ?? [])) {
      if (w?.id && !wsName.has(w.id)) { registered.push(w.id); if (w.name) wsName.set(w.id, w.name); }
    }
  }

  const wsList = onlyWs ? [onlyWs] : registered;
  const budget = { left: MAX_FINDINGS + 1 };   // +1 so we can detect overflow
  const findings: DanglingRefFinding[] = [];
  const scannedWorkspaces: string[] = [];
  for (const ws of wsList) {
    const { readable, findings: f } = await scanWorkspace(storage, config, id, ws, wsName.get(ws), callerGaii, budget);
    if (readable) scannedWorkspaces.push(ws);
    findings.push(...f);
    if (budget.left <= 0) break;
  }

  const truncated = findings.length > MAX_FINDINGS;
  return { findings: truncated ? findings.slice(0, MAX_FINDINGS) : findings, scannedWorkspaces, truncated };
}
