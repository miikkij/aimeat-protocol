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
 *   v1.1.0 -- 2026-06-10 -- Backing gate (the invisible-documents bug happened through THIS path):
 *     _create normalizes objectTypes (rejects backing 'storage'/'knowledge', infers mode:'document'
 *     from kind:'document'); _write refuses non-memory spaces and honours kind:'document' on old
 *     manifests instead of silently falling into records mode.
 *   v1.2.0 -- 2026-07-07 -- _read is index-first (mirrors src/mcp/workspaces.ts): shapes the REST full
 *     response into a lightweight INDEX by default (per space: id/title/updated/version/bytes, no
 *     bodies), and returns full values only for the ids passed in `ids` — so the MCP payload stays
 *     small instead of dumping every object in one blob.
 *   v1.3.0 -- 2026-07-11 -- TARGET-028: _member_grant / _member_revoke (multi-workspace, REST-wrapped) +
 *     _members; _access decide passes an optional `role`. Parity with the server MCP surface.
 *   v1.4.0 -- 2026-07-25 -- _create backfills the whole manifest envelope (manifestVersion/id/name/kind/
 *     status) via backfillManifestEnvelope() instead of only id+status, matching the server MCP fix so a
 *     create supplying just objectTypes validates first try over the connector too.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { normalizeObjectTypes, isMemoryBackedSpace, WorkspaceMetaError, backfillManifestEnvelope } from '../../../../services/workspace-meta.js';
import { entryTitle } from '../../../../services/structure-overview.js';

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
    // eslint-disable-next-line aimeat/no-silent-catch -- leave as string → schema rejects
    if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') v = p; } catch { /* leave as string → schema rejects */ } }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as Record<string, unknown>), id } : v;
  };
  /** Parse a possibly-JSON-stringified object param (manifest / schemas) back to an object. */
  const parseObj = (v: unknown): unknown => {
    // eslint-disable-next-line aimeat/no-silent-catch -- leave as-is
    if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') return p; } catch { /* leave as-is */ } }
    return v;
  };

  mcp.tool('aimeat_workspace_list', descriptionFor('aimeat_workspace_list'),
    { organism_id: z.string().describe('Organism id') },
    annotationsFor('aimeat_workspace_list'),
    async ({ organism_id }) => {
      // Membership-gated discovery route (aggregates the registry across all members + resolves access
      // by owner). A raw /v1/memory prefix read is caller-scoped → a sub-agent would see an empty list.
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspaces`);
      if (resp.ok === false) return text(resp.error ?? resp, true);
      const workspaces = (resp.data as { workspaces?: unknown[] } | undefined)?.workspaces ?? [];
      return text({ organism_id, workspaces });
    });

  mcp.tool('aimeat_workspace_read', descriptionFor('aimeat_workspace_read'),
    { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list)'),
      ids: z.array(z.string()).optional().describe('Batch-open: return the FULL value of ONLY these instance ids (from the index). Omit for the lightweight index.'),
      space: z.string().optional().describe('With `ids`: optionally restrict the lookup to this space (objectType NAME or namespace).'),
      include_archived: z.boolean().optional().describe('Include archived (hidden) content. Default false.') },
    annotationsFor('aimeat_workspace_read'),
    async ({ organism_id, ws, ids, space, include_archived }) => {
      // The REST read returns the whole workspace (manifest + every object's full value); that round-trip
      // is local (loopback daemon → node), so it is cheap. We shape it HERE — index by default, full
      // values only for the requested ids — so the MCP payload the LLM receives stays small (mirrors the
      // server's src/mcp/workspaces.ts). Version history (.version.N) never reaches this path (REST omits it).
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}${include_archived ? '&archived=include' : ''}`);
      if (resp.ok === false) return text(resp.error ?? resp, true);
      const data = (resp.data ?? resp) as { manifest?: { objectTypes?: { name: string; namespace?: string }[] }; objects?: Record<string, Record<string, unknown>[]>; drafts?: Record<string, Record<string, unknown>[]>; apps?: unknown[] };
      const manifest = data.manifest ?? null;
      const objects = data.objects ?? {};
      const drafts = data.drafts ?? {};
      const idOf = (v: Record<string, unknown>): string => String(v.id ?? '');
      const byteLen = (v: unknown): number => (typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length);
      // The REST value carries _createdAt/_updatedAt/_version merged in; split them back out.
      const splitMeta = (v: Record<string, unknown>) => {
        const { _createdAt, _updatedAt, _version, ...value } = v;
        return { value, _createdAt, _updatedAt, _version };
      };
      // Resolve a space arg (name OR namespace) to the object-type NAME used to key objects/drafts.
      const resolveSpace = (s?: string): string | undefined => s
        ? ((manifest?.objectTypes ?? []).find(o => o.name === s || o.namespace === s)?.name ?? s)
        : undefined;

      // ── BATCH-OPEN: full value of the requested ids only. ──
      if (ids && ids.length) {
        const want = new Set(ids.map(String));
        const scopedName = resolveSpace(space);
        const names = scopedName ? [scopedName] : [...new Set([...Object.keys(objects), ...Object.keys(drafts)])];
        const found: unknown[] = [];
        const seen = new Set<string>();
        for (const id of want) {
          for (const name of names) {
            const pub = (objects[name] ?? []).find(v => idOf(v) === id);
            const drf = (drafts[name] ?? []).find(v => idOf(v) === id);
            if (!pub && !drf) continue;
            const cur = splitMeta((pub ?? drf) as Record<string, unknown>);
            found.push({ space: name, id, value: cur.value, published: !!pub, _version: cur._version, _createdAt: cur._createdAt, _updatedAt: cur._updatedAt, ...(drf ? { draft: splitMeta(drf).value } : {}) });
            seen.add(id); break;
          }
        }
        const missing = [...want].filter(id => !seen.has(id));
        return text({ organism_id, ws, mode: 'content', items: found, ...(missing.length ? { missing } : {}) });
      }

      // ── INDEX (default): titles + ids, NO bodies. ──
      const names = [...new Set([...Object.keys(objects), ...Object.keys(drafts)])];
      const index: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};
      for (const name of names) {
        const merged = new Map<string, { pub?: Record<string, unknown>; drf?: Record<string, unknown> }>();
        for (const v of objects[name] ?? []) { const id = idOf(v); const slot = merged.get(id) ?? {}; slot.pub = v; merged.set(id, slot); }
        for (const v of drafts[name] ?? []) { const id = idOf(v); const slot = merged.get(id) ?? {}; slot.drf = v; merged.set(id, slot); }
        const entries = [...merged.entries()]
          .map(([id, slot]) => {
            const cur = slot.pub ?? slot.drf!;
            return { id, title: entryTitle(splitMeta(cur).value, id), updated: String(cur._updatedAt ?? ''), version: Number(cur._version ?? 0), bytes: byteLen(splitMeta(cur).value), published: !!slot.pub, has_draft: !!slot.drf };
          })
          .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : 1));
        index[name] = entries;
        counts[name] = entries.length;
      }
      return text({ organism_id, ws, mode: 'index', manifest, apps: data.apps ?? [], counts, index,
        hint: 'Titles only. Open the ones you need with aimeat_workspace_read(ids:["<id>", ...]) to get their full values.' });
    });

  mcp.tool('aimeat_workspace_overview', descriptionFor('aimeat_workspace_overview'),
    { organism_id: z.string().describe('Organism identifier.'), ws: z.string().describe('Workspace id (from aimeat_workspace_list).') },
    annotationsFor('aimeat_workspace_overview'),
    async ({ organism_id, ws }) => {
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace/overview?ws=${encodeURIComponent(ws)}`);
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_write', descriptionFor('aimeat_workspace_write'),
    {
      organism_id: z.string(), ws: z.string(),
      space: z.string().describe("The objectType (space) NAME — e.g. 'feature' or 'notes'. The tool resolves records vs document."),
      // z.any() so a JSON-stringified object param is parsed back (a z.record/union breaks the MCP SDK).
      value: z.any().describe('The content as a JSON OBJECT (not a string). Records: the record (matching its schema). Documents: { title, markdown }.'),
      id: z.string().optional().describe('Instance id. Required for records (or include id in value); auto-generated for documents.'),
      section: z.string().optional().describe('Document spaces only: section id/name to file the document under.'),
    },
    annotationsFor('aimeat_workspace_write'),
    async ({ organism_id, ws, space, value, id, section }) => {
      const wsResp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace?ws=${encodeURIComponent(ws)}`);
      const ot = ((wsResp.data as { manifest?: { objectTypes?: { name: string; namespace?: string; mode?: string; backing?: string; kind?: string }[] } } | undefined)?.manifest?.objectTypes ?? []).find(o => o.name === space || o.namespace === space);
      if (!ot || !ot.namespace) return text({ error: `No space named "${space}" in this workspace.` }, true);
      // A non-memory space's data does not live in workspace records — writing here would store
      // memory keys no read surface ever lists (the invisible-documents bug). Refuse loudly.
      if (!isMemoryBackedSpace(ot)) {
        return text({ error: ot.backing === 'tasks'
          ? `Space "${ot.name}" is backed by the task system (backing:'tasks') — create tasks with the task tools, not workspace writes.`
          : `Space "${ot.name}" has backing '${ot.backing}', which workspace writes do not support. Update the space to backing:'memory' (aimeat_workspace_update); files and knowledge packages attach via workspace Sources or embedded document images.` }, true);
      }
      // Old manifests declared documents as kind:'document' without a mode — honour the intent.
      const isDoc = ot.mode === 'document' || (!ot.mode && ot.kind === 'document');
      const v0 = parseObj(value);
      let instanceId = (id && String(id).trim()) || (v0 && typeof v0 === 'object' && !Array.isArray(v0) ? String((v0 as Record<string, unknown>).id ?? '').trim() : '');
      if (!instanceId && isDoc) instanceId = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      if (!instanceId) return text({ error: 'A records write needs an id (pass id, or include id in value).' }, true);
      const v = coerceValue(v0, instanceId);
      const key = `${root(organism_id, ws)}.${ot.namespace}.${instanceId}.draft`;
      const wr = await client.post('/v1/memory', { key, value: v, visibility: 'private' });
      if (wr.ok === false) return text(wr.error ?? wr, true);
      if (isDoc && section) {
        const secKey = `${root(organism_id, ws)}.meta.sections.${ot.name}`;
        const secResp = await client.get(`/v1/memory?prefix=${encodeURIComponent(secKey)}`);
        const sections = (secResp.data as { items?: { key: string; value?: { sections?: { id: string; name?: string; documents?: string[] }[] } }[] } | undefined)?.items?.find(i => i.key === secKey)?.value?.sections ?? [];
        const target = sections.find(s => s.id === section || s.name === section);
        if (target) { target.documents = [...(target.documents ?? []).filter(d => d !== instanceId), instanceId]; await client.post('/v1/memory', { key: secKey, value: { sections }, visibility: 'private' }); }
      }
      return text({ written: key, id: instanceId, space, mode: isDoc ? 'document' : 'records', section: section ?? null });
    });

  mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
    { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
    annotationsFor('aimeat_workspace_publish'),
    async ({ organism_id, ws, namespace, id }) => {
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/publish`, { ws, namespace, id });
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_revert_to_draft', descriptionFor('aimeat_workspace_revert_to_draft'),
    { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
    annotationsFor('aimeat_workspace_revert_to_draft'),
    async ({ organism_id, ws, namespace, id }) => {
      const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/revert`, { ws, namespace, id });
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  mcp.tool('aimeat_workspace_update', descriptionFor('aimeat_workspace_update'),
    {
      organism_id: z.string(), ws: z.string(),
      name: z.string().optional().describe('New workspace name (synced to manifest + registry)'),
      readme: z.string().optional().describe('New markdown readme/intro (replaces the current one)'),
      add_spaces: z.any().optional().describe('ADDITIVE (safe): an ARRAY of objectTypes to UNION into the manifest — the server keeps everything else and skips any whose name/namespace already exists. Pass just { name, namespace, mode } (+ a schema in `schemas`); defaults are filled. Prefer this over `manifest` to add spaces. Cannot remove/rename.'),
      manifest: z.any().optional().describe('FULL replacement manifest (objectTypes + policy/gate + settings) as a JSON OBJECT. For genuine restructuring (rename/remove a space, change policy.alwaysGate). Read the workspace first; the id is preserved.'),
      schemas: z.any().optional().describe('Map of namespace → JSON Schema (object) to lock (strict) for a records space.'),
    },
    annotationsFor('aimeat_workspace_update'),
    async ({ organism_id, ws, name, readme, add_spaces, manifest, schemas }) => {
      const body: { name?: string; readme?: string; add_spaces?: unknown; manifest?: unknown; schemas?: unknown } = {};
      if (typeof name === 'string') body.name = name;
      if (typeof readme === 'string') body.readme = readme;
      const add = parseObj(add_spaces); if (Array.isArray(add)) body.add_spaces = add;
      const man = parseObj(manifest); if (man !== undefined) body.manifest = man;
      const sch = parseObj(schemas); if (sch !== undefined) body.schemas = sch;
      if (body.name === undefined && body.readme === undefined && body.add_spaces === undefined && body.manifest === undefined && body.schemas === undefined) return text({ error: 'Provide a name, readme, add_spaces, manifest and/or schemas.' }, true);
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
      // Prefix `${base}` (no trailing dot) catches the bare un-suffixed key too — workspace_read
      // surfaces it as the current value, so it must be deletable. The per-row guard excludes
      // sibling ids (`${base}0`). limit=200 is the REST cap; for an instance with a very large
      // version history (e.g. after a runaway), re-run — the tool is idempotent.
      const listed = await client.get(`/v1/memory?prefix=${encodeURIComponent(base)}&limit=200`);
      const items = (listed.data as { items?: { key: string }[] } | undefined)?.items ?? [];
      let deleted = 0;
      for (const it of items) {
        if (it.key !== base && !it.key.startsWith(base + '.')) continue;  // exclude sibling ids
        const role = it.key === base ? '' : it.key.slice(base.length + 1);
        if (role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
          const dr = await client.delete(`/v1/memory/${encodeURIComponent(it.key)}`);
          if (dr.ok !== false) deleted++;
        }
      }
      if (deleted === 0) return text({ error: `Nothing to delete at ${base} (no record/draft/latest/version).` }, true);
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
      // Gate: reject unsupported backings + infer mode from kind BEFORE anything is written, so a
      // misdeclared space fails the very first call instead of becoming invisible data.
      try {
        man.objectTypes = normalizeObjectTypes(man.objectTypes as Array<Record<string, unknown>>);
      } catch (e) {
        if (e instanceof WorkspaceMetaError) return text({ error: e.message }, true);
        throw e;
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
      // Backfill the envelope the model routinely omits (manifestVersion/id/name/kind/status) so a
      // create with just objectTypes validates on the first call (mirrors the server MCP _create).
      const manifestValue = backfillManifestEnvelope(man, { orgId: organism_id, fallbackName: name });
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

  mcp.tool('aimeat_workspace_access', descriptionFor('aimeat_workspace_access'),
    {
      organism_id: z.string(), ws: z.string(),
      action: z.enum(['request', 'list', 'decide']).describe("'request' = ask the creator for access · 'list' = (creator/admin) see pending requests + members · 'decide' = (creator/admin) approve/deny one"),
      message: z.string().optional().describe("action='request': a note to the creator"),
      requester: z.string().optional().describe("action='decide': the requester's owner name"),
      decision: z.string().optional().describe("action='decide': 'approve' (default) or 'deny'"),
      role: z.enum(['viewer', 'contributor']).optional().describe("action='decide' approve: 'viewer' (read) or 'contributor' (read+write). Omit for the default (contributor)."),
    },
    annotationsFor('aimeat_workspace_access'),
    async ({ organism_id, ws, action, message, requester, decision, role }) => {
      const orgPath = `/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access`;
      let resp;
      if (action === 'list') {
        resp = await client.get(`${orgPath}?ws=${encodeURIComponent(ws)}`);
      } else if (action === 'decide') {
        if (!requester) return text({ error: "action='decide' needs a requester." }, true);
        const body: Record<string, unknown> = { ws, requester, decision: decision === 'deny' ? 'deny' : 'approve' };
        if (role) body.role = role;
        resp = await client.post(`${orgPath}/decision`, body);
      } else if (action === 'request') {
        const body: Record<string, unknown> = { ws };
        if (message != null) body.message = message;
        resp = await client.post(orgPath, body);
      } else {
        return text({ error: "action must be 'request', 'list' or 'decide'." }, true);
      }
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });

  // Normalize a single `ws` and/or `workspaces` array into a de-duplicated list (order preserved).
  const wsList = (ws?: string, workspaces?: string[]): string[] => {
    const out: string[] = [];
    for (const w of [...(ws ? [ws] : []), ...(Array.isArray(workspaces) ? workspaces : [])]) {
      const t = String(w ?? '').trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  };

  mcp.tool('aimeat_workspace_member_grant', descriptionFor('aimeat_workspace_member_grant'),
    {
      organism_id: z.string(),
      ws: z.string().optional().describe('A single workspace id. Use this OR `workspaces` (or both).'),
      workspaces: z.array(z.string()).optional().describe('MANY workspace ids to grant in one call.'),
      grantee: z.string().describe('Owner name, GHII, or GAII to grant (applies to the owner — agents inherit).'),
      role: z.enum(['viewer', 'contributor']).describe("'viewer' (read) or 'contributor' (read+write)."),
    },
    annotationsFor('aimeat_workspace_member_grant'),
    async ({ organism_id, ws, workspaces, grantee, role }) => {
      const targets = wsList(ws, workspaces);
      if (!targets.length) return text({ error: 'Provide `ws` and/or `workspaces`.' }, true);
      const orgPath = `/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access/grant`;
      const results: Array<{ ws: string; status: string; role?: string }> = [];
      for (const w of targets) {
        const r = await client.post(orgPath, { ws: w, grantee, role });
        results.push(r.ok === false ? { ws: w, status: 'forbidden_or_not_found' } : { ws: w, status: 'granted', role });
      }
      return text({ grantee, role, granted: results.filter(r => r.status === 'granted').length, total: targets.length, results });
    });

  mcp.tool('aimeat_workspace_member_revoke', descriptionFor('aimeat_workspace_member_revoke'),
    {
      organism_id: z.string(),
      ws: z.string().optional().describe('A single workspace id. Use this OR `workspaces` (or both).'),
      workspaces: z.array(z.string()).optional().describe('MANY workspace ids to revoke in one call.'),
      grantee: z.string().describe('Owner name, GHII, or GAII to revoke.'),
    },
    annotationsFor('aimeat_workspace_member_revoke'),
    async ({ organism_id, ws, workspaces, grantee }) => {
      const targets = wsList(ws, workspaces);
      if (!targets.length) return text({ error: 'Provide `ws` and/or `workspaces`.' }, true);
      const orgPath = `/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access/revoke`;
      const results: Array<{ ws: string; status: string; revoked?: number }> = [];
      for (const w of targets) {
        const r = await client.post(orgPath, { ws: w, grantee });
        if (r.ok === false) { results.push({ ws: w, status: 'forbidden_or_not_found' }); continue; }
        const n = Number((r.data as { revoked?: number } | undefined)?.revoked ?? 0);
        results.push({ ws: w, status: n > 0 ? 'revoked' : 'not_a_member', revoked: n });
      }
      return text({ grantee, revoked: results.filter(r => r.status === 'revoked').length, total: targets.length, results });
    });

  mcp.tool('aimeat_workspace_members', descriptionFor('aimeat_workspace_members'),
    { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list).') },
    annotationsFor('aimeat_workspace_members'),
    async ({ organism_id, ws }) => {
      const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace-access?ws=${encodeURIComponent(ws)}`);
      if (resp.ok === false) return text(resp.error ?? resp, true);
      const members = (resp.data as { members?: unknown[] } | undefined)?.members ?? [];
      return text({ ws, members });
    });

  mcp.tool('aimeat_workspace_transfer', descriptionFor('aimeat_workspace_transfer'),
    {
      organism_id: z.string(),
      direction: z.enum(['export', 'import']).describe("'export' a workspace to a base64 ZIP, or 'import' a base64 ZIP as a NEW workspace"),
      ws: z.string().optional().describe("direction='export': the workspace id to export"),
      zip_base64: z.string().optional().describe("direction='import': the base64 ZIP from a prior export"),
    },
    annotationsFor('aimeat_workspace_transfer'),
    async ({ organism_id, direction, ws, zip_base64 }) => {
      let resp;
      if (direction === 'export') {
        if (!ws) return text({ error: "direction='export' needs a ws." }, true);
        resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace/export?ws=${encodeURIComponent(ws)}&format=base64`);
      } else if (direction === 'import') {
        if (!zip_base64) return text({ error: "direction='import' needs zip_base64." }, true);
        resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace/import`, { zip_base64 });
      } else {
        return text({ error: "direction must be 'export' or 'import'." }, true);
      }
      return text(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), resp.ok === false);
    });
}
