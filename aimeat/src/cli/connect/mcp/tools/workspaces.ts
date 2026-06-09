/**
 * @file workspaces.ts
 * @description Connector MCP tools for organism WORKSPACES — the local `aimeat connect serve`
 *   counterpart to the server's src/mcp/workspaces.ts. Thin wrappers over the node's REST API
 *   (the routes enforce membership, schema validation, and the publish gate), so crewaimeat-style
 *   agents using `connect serve` get the same list/read/write_draft/publish/add_document surface.
 *   Tool names/descriptions/annotations come from the shared catalog, so they stay in lockstep with
 *   the server and the v2 surface allowlists (appdev/agent/service).
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: 5 workspace tools as REST wrappers for the connector.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerWorkspaceTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const root = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;
  const text = (obj: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
    ...(isError ? { isError: true } : {}),
  });
  /** A draft value should be an object; tolerate a JSON-string (some clients stringify object
   *  params) by parsing it, then stamp the instance id. */
  const coerceValue = (value: unknown, id: string): unknown => {
    let v = value;
    if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') v = p; } catch { /* leave as string → schema rejects */ } }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as Record<string, unknown>), id } : v;
  };
  /** Parse a possibly-JSON-stringified object param (manifest / schemas) back to an object. */
  const parseObj = (v: unknown): unknown => {
    if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') return p; } catch { /* leave as-is */ } }
    return v;
  };

  mcp.tool('aimeat_workspace_list', descriptionFor('aimeat_workspace_list'),
    { organism_id: z.string().describe('Organism id') },
    annotationsFor('aimeat_workspace_list'),
    async ({ organism_id }) => {
      const key = `organism.${organism_id}.meta.workspaces`;
      const resp = await client.get(`/v1/memory?prefix=${encodeURIComponent(key)}`);
      const items = (resp.data as { items?: { key: string; value?: { workspaces?: unknown[] } }[] } | undefined)?.items ?? [];
      const reg = items.find(i => i.key === key);
      return text({ organism_id, workspaces: reg?.value?.workspaces ?? [] });
    });

  mcp.tool('aimeat_workspace_read', descriptionFor('aimeat_workspace_read'),
    { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list)') },
    annotationsFor('aimeat_workspace_read'),
    async ({ organism_id, ws }) => {
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`);
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_write_draft', descriptionFor('aimeat_workspace_write_draft'),
    {
      organism_id: z.string(), ws: z.string(),
      namespace: z.string().describe("The objectType's namespace, e.g. shared.deliverables"),
      id: z.string().describe('Instance id (new or existing to overwrite)'),
      // coerceValue parses a JSON-stringified object so records still validate + documents store
      // correctly. (Kept as z.any() — a z.record/union here broke the MCP SDK's schema conversion.)
      value: z.any().describe('The record/document as a JSON OBJECT (not a string). Records must match the schema; documents are { id, title, markdown }.'),
    },
    annotationsFor('aimeat_workspace_write_draft'),
    async ({ organism_id, ws, namespace, id, value }) => {
      const v = coerceValue(value, id);
      const key = `${root(organism_id, ws)}.${namespace}.${id}.draft`;
      const resp = await client.post('/v1/memory', { key, value: v, visibility: 'private' });
      return text(resp.ok === false ? (resp.error ?? resp) : { written: key }, resp.ok === false);
    });

  mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
    { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
    annotationsFor('aimeat_workspace_publish'),
    async ({ organism_id, ws, namespace, id }) => {
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/publish`, { ws, namespace, id });
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_add_document', descriptionFor('aimeat_workspace_add_document'),
    {
      organism_id: z.string(), ws: z.string(),
      type: z.string().describe('Name of a document-mode objectType (a wiki space)'),
      title: z.string(), markdown: z.string(),
      section: z.string().optional().describe('Optional section id/name to file the document under'),
    },
    annotationsFor('aimeat_workspace_add_document'),
    async ({ organism_id, ws, type, title, markdown, section }) => {
      const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`);
      const manifest = (wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string; mode?: string }[] } } | undefined)?.manifest;
      const ot = (manifest?.objectTypes ?? []).find(o => o.name === type && o.mode === 'document');
      if (!ot || !ot.namespace) return text({ error: `No document space named "${type}" in this workspace.` }, true);
      const docId = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const key = `${root(organism_id, ws)}.${ot.namespace}.${docId}.draft`;
      const wr = await client.post('/v1/memory', { key, value: { id: docId, title, markdown }, visibility: 'private' });
      if (wr.ok === false) return text(wr.error ?? wr, true);
      if (section) {
        const secKey = `${root(organism_id, ws)}.meta.sections.${type}`;
        const secResp = await client.get(`/v1/memory?prefix=${encodeURIComponent(secKey)}`);
        const secItems = (secResp.data as { items?: { key: string; value?: { sections?: { id: string; name?: string; documents?: string[] }[] } }[] } | undefined)?.items ?? [];
        const sections = secItems.find(i => i.key === secKey)?.value?.sections ?? [];
        const target = sections.find(s => s.id === section || s.name === section);
        if (target) {
          target.documents = [...(target.documents ?? []).filter(d => d !== docId), docId];
          await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' });
        }
      }
      return text({ written: key, doc_id: docId, type, section: section ?? null });
    });

  mcp.tool('aimeat_workspace_update', descriptionFor('aimeat_workspace_update'),
    {
      organism_id: z.string(), ws: z.string(),
      name: z.string().optional().describe('New workspace name (synced to manifest + registry)'),
      readme: z.string().optional().describe('New markdown readme/intro (replaces the current one)'),
      manifest: z.any().optional().describe('FULL replacement manifest (objectTypes + policy/gate + settings) as a JSON OBJECT. Read the workspace first, then add/remove an objectType to add/remove a space, or set policy.alwaysGate for the publish gate. The id is preserved.'),
      schemas: z.any().optional().describe('Map of namespace → JSON Schema (object) to lock (strict) for a records space.'),
    },
    annotationsFor('aimeat_workspace_update'),
    async ({ organism_id, ws, name, readme, manifest, schemas }) => {
      const body: { name?: string; readme?: string; manifest?: unknown; schemas?: unknown } = {};
      if (typeof name === 'string') body.name = name;
      if (typeof readme === 'string') body.readme = readme;
      const man = parseObj(manifest); if (man !== undefined) body.manifest = man;
      const sch = parseObj(schemas); if (sch !== undefined) body.schemas = sch;
      if (body.name === undefined && body.readme === undefined && body.manifest === undefined && body.schemas === undefined) return text({ error: 'Provide a name, readme, manifest and/or schemas.' }, true);
      const r = await client.put(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`, body);
      if (r.ok === false) return text({ error: (r.error as { message?: string } | undefined)?.message || 'Update failed' }, true);
      return text(r.data);
    });

  mcp.tool('aimeat_workspace_object_delete', descriptionFor('aimeat_workspace_object_delete'),
    {
      organism_id: z.string(), ws: z.string(),
      namespace: z.string().describe("The objectType's namespace, e.g. shared.deliverables"),
      id: z.string().describe('The instance id to delete (draft + latest + all versions)'),
    },
    annotationsFor('aimeat_workspace_object_delete'),
    async ({ organism_id, ws, namespace, id }) => {
      const base = `${root(organism_id, ws)}.${namespace}.${id}`;
      const listed = await client.get(`/v1/memory?prefix=${encodeURIComponent(base + '.')}`);
      const items = (listed.data as { items?: { key: string }[] } | undefined)?.items ?? [];
      let deleted = 0;
      for (const it of items) {
        const role = it.key.slice(base.length + 1);
        if (role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
          const dr = await client.delete(`/v1/memory/${encodeURIComponent(it.key)}`);
          if (dr.ok !== false) deleted++;
        }
      }
      if (deleted === 0) return text({ error: `Nothing to delete at ${base} (no draft/latest/version).` }, true);
      // Best-effort: unfile the id from the document section tree (find the type by namespace).
      const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`);
      const ot = ((wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string }[] } } | undefined)?.manifest?.objectTypes ?? []).find(o => o.namespace === namespace);
      if (ot) {
        const secKey = `${root(organism_id, ws)}.meta.sections.${ot.name}`;
        const secResp = await client.get(`/v1/memory?prefix=${encodeURIComponent(secKey)}`);
        const sections = (secResp.data as { items?: { key: string; value?: { sections?: { documents?: string[] }[] } }[] } | undefined)?.items?.find(i => i.key === secKey)?.value?.sections;
        if (sections) {
          let changed = false;
          for (const s of sections) { if ((s.documents ?? []).includes(id)) { s.documents = (s.documents ?? []).filter(d => d !== id); changed = true; } }
          if (changed) await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' });
        }
      }
      return text({ deleted: base, keys: deleted });
    });

  mcp.tool('aimeat_workspace_create', descriptionFor('aimeat_workspace_create'),
    {
      organism_id: z.string(),
      name: z.string().describe('Workspace name'),
      manifest: z.any().describe('The workspace manifest (objectTypes + policy) as a JSON OBJECT, not a string.'),
      schemas: z.any().optional().describe('Map of namespace → JSON Schema for records types, as a JSON OBJECT.'),
      readme: z.string().optional().describe('Optional markdown intro'),
    },
    annotationsFor('aimeat_workspace_create'),
    async ({ organism_id, name, manifest, schemas, readme }) => {
      const man = parseObj(manifest) as Record<string, unknown> | undefined;
      if (!man || typeof man !== 'object' || !Array.isArray(man.objectTypes)) {
        return text({ error: 'manifest must be an object with an objectTypes array.' }, true);
      }
      const schemaMap = (parseObj(schemas) ?? {}) as Record<string, Record<string, unknown>>;
      const wsId = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const base = root(organism_id, wsId);
      const now = new Date().toISOString();
      // Lock schemas (best-effort: an agent token may lack permission — PUT schema is owner/operator-only —
      // so failures are reported, not fatal; the owner can lock them later).
      const schemaResults: { namespace: string; locked: boolean; error?: string }[] = [];
      for (const [namespace, schema] of Object.entries(schemaMap)) {
        if (!schema || typeof schema !== 'object') continue;
        const r = await client.put(`/v1/memory/${encodeURIComponent(`${base}.${namespace}`)}/schema`, { schema, apply_to: 'prefix', schema_mode: 'strict' });
        schemaResults.push({ namespace, locked: r.ok !== false, error: r.ok === false ? r.error?.message : undefined });
      }
      const manifestValue = { ...man, id: organism_id, status: man.status || 'active' };
      const mr = await client.post('/v1/memory', { key: `${base}.meta.manifest`, value: manifestValue, visibility: 'private' });
      if (mr.ok === false) return text(mr.error ?? mr, true);
      const summary = man.summary;
      await client.post('/v1/memory', { key: `${base}.meta.readme`, value: readme || `# ${String(man.name || name)}\n\n${typeof summary === 'string' ? summary : ''}`, visibility: 'private' });
      const regKey = `organism.${organism_id}.meta.workspaces`;
      const regResp = await client.get(`/v1/memory?prefix=${encodeURIComponent(regKey)}`);
      const workspaces = ((regResp.data as { items?: { key: string; value?: { workspaces?: unknown[] } }[] } | undefined)?.items?.find(i => i.key === regKey)?.value?.workspaces) ?? [];
      await client.post('/v1/memory', { key: regKey, value: { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now }] }, visibility: 'private' });
      return text({ created: true, ws: wsId, types: (man.objectTypes as { name: string }[]).map(o => o.name), schemas: schemaResults });
    });

  mcp.tool('aimeat_workspace_request_access', descriptionFor('aimeat_workspace_request_access'),
    { organism_id: z.string(), ws: z.string(), message: z.string().optional() },
    annotationsFor('aimeat_workspace_request_access'),
    async ({ organism_id, ws, message }) => {
      const body: Record<string, unknown> = { ws };
      if (message != null) body.message = message;
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access`, body);
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_list_requests', descriptionFor('aimeat_workspace_list_requests'),
    { organism_id: z.string(), ws: z.string() },
    annotationsFor('aimeat_workspace_list_requests'),
    async ({ organism_id, ws }) => {
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access?ws=${encodeURIComponent(ws)}`);
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_approve_access', descriptionFor('aimeat_workspace_approve_access'),
    { organism_id: z.string(), ws: z.string(), requester: z.string(), decision: z.string().optional() },
    annotationsFor('aimeat_workspace_approve_access'),
    async ({ organism_id, ws, requester, decision }) => {
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access/decision`, { ws, requester, decision: decision === 'deny' ? 'deny' : 'approve' });
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_export', descriptionFor('aimeat_workspace_export'),
    { organism_id: z.string(), ws: z.string() },
    annotationsFor('aimeat_workspace_export'),
    async ({ organism_id, ws }) => {
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace/export?ws=${encodeURIComponent(ws)}&format=base64`);
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_import', descriptionFor('aimeat_workspace_import'),
    { organism_id: z.string(), zip_base64: z.string().describe('Workspace export ZIP, base64-encoded') },
    annotationsFor('aimeat_workspace_import'),
    async ({ organism_id, zip_base64 }) => {
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace/import`, { zip_base64 });
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });
}
