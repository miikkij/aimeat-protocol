/**
 * @file organism-search.ts
 * @description Content search across an organism's workspaces. Backed by the INDEXED full-text
 *   primitive (storage.searchText — SQLite FTS5 / Mongo text), key-prefix-scoped to
 *   `organism.{id}.` (or one workspace), so it stays fast as workspaces grow instead of scanning
 *   every key. Candidates are then access-gated per workspace (the same manifest read gate as the
 *   workspace read), resolved to their {workspace, space, instance} via the manifest's declared
 *   namespaces, de-duplicated (latest over bare), ranked by relevance, and returned with a snippet.
 *   Shared by the REST route (GET /v1/organisms/:id/search) and the MCP tool (aimeat_organism_search).
 * @structure searchOrganismContent(storage, config, organism, callerGaii, q, onlyWs?) -> { results, truncated }
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: extracted from the search route so the MCP tool can reuse it.
 *   v1.1.0 -- 2026-06-22 -- Indexed FTS backing (searchText + keyPrefix) instead of an O(n) per-workspace
 *     scan; hits now carry `namespace` (for deep-linking to the record) and `score` (relevance order).
 */
import type { Storage, MemoryRecord, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner } from '../utils/gaii.js';

export interface OrganismSearchHit {
  ws: string;
  wsName?: string;
  space: string;
  namespace: string;
  id: string;
  title: string;
  snippet: string;
  score: number;
}

const MAX_RESULTS = 100;
const CANDIDATES = 400;   // FTS candidates to gate/resolve before capping at MAX_RESULTS

/** Parse `organism.{id}.w.{ws}.{rest}` → { ws, rest } (rest is the namespace.instance[.role] tail). */
function parseWsKey(key: string, orgId: string): { ws: string; rest: string } | null {
  const root = `organism.${orgId}.w.`;
  if (!key.startsWith(root)) return null;
  const after = key.slice(root.length);
  const dot = after.indexOf('.');
  if (dot < 0) return null;
  return { ws: after.slice(0, dot), rest: after.slice(dot + 1) };
}

export async function searchOrganismContent(
  storage: Storage,
  config: AimeatConfig,
  organism: OrganismRecord,
  callerGaii: string,
  q: string,
  onlyWs?: string,
): Promise<{ results: OrganismSearchHit[]; truncated: boolean }> {
  const id = organism.id;
  const needle = q.toLowerCase();

  // Workspace registry (owner-agnostic prefix scan) — for names + the onlyWs filter.
  const regKey = `organism.${id}.meta.workspaces`;
  const regScan = await storage.listAllMemory({ prefix: regKey, limit: 50 });
  const wsName = new Map<string, string>();
  for (const rec of regScan.items) {
    if (rec.key !== regKey) continue;
    for (const w of ((rec.value as { workspaces?: Array<{ id: string; name?: string }> } | undefined)?.workspaces ?? [])) {
      if (w?.id && w.name && !wsName.has(w.id)) wsName.set(w.id, w.name);
    }
  }

  // Indexed full-text candidates, scoped to the organism (or one workspace).
  const keyPrefix = onlyWs ? `organism.${id}.w.${onlyWs}.` : `organism.${id}.w.`;
  const hits = await storage.searchText(q, { keyPrefix, maxFlags: 0, limit: CANDIDATES });

  // Per-workspace manifest + read-permission cache (resolved once per workspace).
  const wsMeta = new Map<string, { canRead: boolean; types: Array<{ name: string; ns: string }> } | null>();
  const resolveWs = async (ws: string) => {
    if (wsMeta.has(ws)) return wsMeta.get(ws);
    const nsRoot = `organism.${id}.w.${ws}.`;
    const manScan = await storage.listAllMemory({ prefix: `${nsRoot}meta.manifest`, limit: 5 });
    const manRec = manScan.items.find(r => r.key === `${nsRoot}meta.manifest`);
    if (!manRec) { wsMeta.set(ws, null); return null; }
    let canRead = manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii);
    if (!canRead) {
      const decision = await authorizeRead(storage, config, {
        ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
        visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
      });
      canRead = decision.allowed;
    }
    const manifest = manRec.value as { objectTypes?: Array<Record<string, unknown>> } | undefined;
    const types = (manifest?.objectTypes ?? [])
      .map(ot => ({ name: String(ot.name ?? ''), ns: String(ot.namespace ?? '') }))
      .filter(t => t.name && t.ns)
      .sort((a, b) => b.ns.length - a.ns.length);
    const meta = { canRead, types };
    wsMeta.set(ws, meta);
    return meta;
  };

  const snippetOf = (text: string): string => {
    const i = text.toLowerCase().indexOf(needle);
    if (i < 0) {
      // Multi-token query: fall back to the first individual token's position, else the head.
      const tok = needle.split(/\s+/).find(t => t && text.toLowerCase().includes(t));
      const j = tok ? text.toLowerCase().indexOf(tok) : -1;
      if (j < 0) return text.slice(0, 160).trim() + (text.length > 160 ? '…' : '');
      const s = Math.max(0, j - 60), e = j + (tok as string).length + 100;
      return (s > 0 ? '…' : '') + text.slice(s, e).trim() + (e < text.length ? '…' : '');
    }
    const start = Math.max(0, i - 60), end = i + needle.length + 100;
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  };

  // Collapse to one hit per (space, instance): prefer the published .latest over a bare write; skip
  // drafts + version history + meta. Keep the best score seen for the instance.
  const byInstance = new Map<string, { ws: string; space: string; namespace: string; id: string; rec: MemoryRecord; role: string; score: number }>();
  for (const hit of hits) {
    const parsed = parseWsKey(hit.record.key, id);
    if (!parsed) continue;
    if (parsed.rest.startsWith('meta.')) continue;
    const meta = await resolveWs(parsed.ws);
    if (!meta || !meta.canRead) continue;
    const ot = meta.types.find(t => parsed.rest.startsWith(t.ns + '.'));
    if (!ot) continue;
    const tail = parsed.rest.slice(ot.ns.length + 1);
    const dot = tail.indexOf('.');
    const instanceId = dot < 0 ? tail : tail.slice(0, dot);
    const role = dot < 0 ? '' : tail.slice(dot + 1);
    if (role === 'draft' || role.startsWith('version.')) continue;
    const k = `${parsed.ws}/${ot.name}/${instanceId}`;
    const prev = byInstance.get(k);
    // Prefer latest over bare; otherwise keep the higher-scoring hit.
    const better = !prev || (role === 'latest' && prev.role !== 'latest') || (role === prev.role && hit.score > prev.score);
    if (better) byInstance.set(k, { ws: parsed.ws, space: ot.name, namespace: ot.ns, id: instanceId, rec: hit.record, role, score: hit.score });
  }

  const results: OrganismSearchHit[] = [...byInstance.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(h => {
      const v = h.rec.value as Record<string, unknown> | string | undefined;
      const obj = (v && typeof v === 'object') ? v as Record<string, unknown> : { value: v };
      const title = String(obj.title ?? obj.name ?? obj.label ?? obj.summary ?? h.id);
      const snippet = snippetOf(typeof obj.markdown === 'string' ? obj.markdown : JSON.stringify(obj));
      return { ws: h.ws, wsName: wsName.get(h.ws), space: h.space, namespace: h.namespace, id: h.id, title, snippet, score: h.score };
    });

  return { results, truncated: byInstance.size > MAX_RESULTS };
}
