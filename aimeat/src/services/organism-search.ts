/**
 * @file organism-search.ts
 * @description Content search across an organism's workspaces. Case-insensitive substring match
 *   over the records + documents of every workspace the caller may read (or one workspace), keyed
 *   to the manifest's declared object-type namespaces so multi-segment namespaces (e.g.
 *   "shared.tasks") resolve to the right space + instance id. Honours the same workspace-level read
 *   authorization as the workspace read (manifest gate via authorizeRead). Shared by the REST route
 *   (GET /v1/organisms/:id/search) and the MCP tool (aimeat_organism_search).
 * @structure searchOrganismContent(storage, config, organism, callerGaii, q, onlyWs?) -> results
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: extracted from the search route so the MCP tool can reuse it.
 */
import type { Storage, MemoryRecord, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';
import { isSameOwner } from '../utils/gaii.js';

export interface OrganismSearchHit {
  ws: string;
  wsName?: string;
  space: string;
  id: string;
  title: string;
  snippet: string;
}

const MAX_RESULTS = 100;

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

  // Workspace registry (owner-agnostic prefix scan).
  const regKey = `organism.${id}.meta.workspaces`;
  const regScan = await storage.listAllMemory({ prefix: regKey, limit: 5 });
  const regRec = regScan.items.find(r => r.key === regKey);
  const wsList: Array<{ id: string; name?: string }> =
    (regRec?.value as { workspaces?: Array<{ id: string; name?: string }> } | undefined)?.workspaces ?? [];
  const workspaces = onlyWs ? wsList.filter(w => w.id === onlyWs) : wsList;

  const snippetOf = (text: string): string => {
    const i = text.toLowerCase().indexOf(needle);
    if (i < 0) return text.slice(0, 160);
    const start = Math.max(0, i - 60);
    const end = i + needle.length + 100;
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  };

  const results: OrganismSearchHit[] = [];

  for (const w of workspaces) {
    if (results.length >= MAX_RESULTS) break;
    const nsRoot = `organism.${id}.w.${w.id}.`;
    const { items } = await storage.listAllMemory({ prefix: nsRoot, limit: 5000 });
    const manRec = items.find(r => r.key === `${nsRoot}meta.manifest`);
    if (!manRec) continue;

    let canRead = manRec.ownerGaii === callerGaii || isSameOwner(manRec.ownerGaii, callerGaii);
    if (!canRead) {
      const decision = await authorizeRead(storage, config, {
        ownerGaii: manRec.ownerGaii, accessorGaii: callerGaii, resourceKey: manRec.key,
        visibility: manRec.visibility, groupId: manRec.groupId, action: 'read',
      });
      canRead = decision.allowed;
    }
    if (!canRead) continue;

    const manifest = manRec.value as { objectTypes?: Array<Record<string, unknown>> } | undefined;
    const types = (manifest?.objectTypes ?? [])
      .map(ot => ({ name: String(ot.name ?? ''), ns: String(ot.namespace ?? '') }))
      .filter(t => t.name && t.ns)
      .sort((a, b) => b.ns.length - a.ns.length); // longest (most specific) namespace first

    const instances = new Map<string, { space: string; instanceId: string; latest?: MemoryRecord; bare?: MemoryRecord }>();
    for (const r of items) {
      const rel = r.key.slice(nsRoot.length);
      if (rel.startsWith('meta.')) continue;
      const ot = types.find(t => rel.startsWith(t.ns + '.'));
      if (!ot) continue;
      const rest = rel.slice(ot.ns.length + 1);
      const dot = rest.indexOf('.');
      const instanceId = dot < 0 ? rest : rest.slice(0, dot);
      const role = dot < 0 ? '' : rest.slice(dot + 1);
      if (role === 'draft' || role.startsWith('version.')) continue;
      const k = `${ot.name}/${instanceId}`;
      const slot = instances.get(k) ?? { space: ot.name, instanceId };
      if (role === 'latest') slot.latest = r;
      else if (role === '') slot.bare = r;
      instances.set(k, slot);
    }
    for (const slot of instances.values()) {
      if (results.length >= MAX_RESULTS) break;
      const rec = slot.latest ?? slot.bare;
      if (!rec) continue;
      const v = rec.value as Record<string, unknown> | string | undefined;
      const obj = (v && typeof v === 'object') ? v as Record<string, unknown> : { value: v };
      const hay = JSON.stringify(obj);
      if (!hay.toLowerCase().includes(needle)) continue;
      const title = String(obj.title ?? obj.name ?? slot.instanceId);
      results.push({ ws: w.id, wsName: w.name, space: slot.space, id: slot.instanceId, title, snippet: snippetOf(typeof obj.markdown === 'string' ? obj.markdown : hay) });
    }
  }

  return { results, truncated: results.length >= MAX_RESULTS };
}
