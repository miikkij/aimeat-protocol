/**
 * @file workspaces.ts
 * @description MCP tools for organism WORKSPACES — the manifest-driven document/record spaces an
 *   organism holds (organism.{id}.w.{ws}.*). Makes the feature first-class for agents instead of
 *   requiring them to hand-construct memory keys: list workspaces, read a workspace (manifest +
 *   objects + drafts), write a draft, publish it, and add a markdown document.
 *
 *   Identity model (v1): operations run as the agent's OWNER GHII (owner@node). This is the primary
 *   case — the owner's own agent working in the owner's organism. Reads/writes therefore see exactly
 *   what the owner's UI sees. Cross-owner member edits (another owner's agent in a shared org) are a
 *   deferred edge case. Publish honours the publish gate: if it's on, the tool refuses and tells the
 *   agent to leave the draft for human review (it does not create the approval here).
 * @structure registerWorkspaceTools(mcp, storage, config, getAgentGaii, emitU, emitL)
 *   - aimeat_workspace_list / _read / _write_draft / _publish / _add_document / _delete / _create
 * @usage import { registerWorkspaceTools } from './workspaces.js';
 * @version-history
 *   v1.0.0 -- 2026-06-08 -- Initial: 5 workspace tools wrapping the manifest/draft/publish convention.
 *   v1.1.0 -- 2026-06-08 -- write_draft coerces a JSON-stringified value (clients stringify untyped
 *     object params); add _delete (retract an object) and _create (bootstrap a workspace from a
 *     custom manifest + per-namespace schemas, locked under the owner GHII).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { validateMemoryWrite } from '../services/schema-validator.js';

type ObjType = { name: string; namespace?: string; backing?: string; mode?: string };
type Manifest = { objectTypes?: ObjType[] } & Record<string, unknown>;
type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export function registerWorkspaceTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();
    const parsed = parseGAII(agentGaii);
    const ownerName = parsed ? parsed.owner : agentGaii;
    const ownerGhii = `${ownerName}@${config.nodeId}`;
    const wsRoot = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;

    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });

    /** A draft value should be an object; tolerate a JSON-string (some clients stringify object
     *  params) by parsing it, then stamp the instance id so the stored record/document carries it. */
    const coerceValue = (value: unknown, id: string): unknown => {
        let v = value;
        if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') v = p; } catch { /* leave as string → schema rejects clearly */ } }
        return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as Record<string, unknown>), id } : v;
    };

    /** Parse a possibly-JSON-stringified object param (manifest / schemas) back to an object. */
    const parseObj = (v: unknown): unknown => {
        if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') return p; } catch { /* leave as-is */ } }
        return v;
    };

    /** Membership gate — an organism agent, or the owner is an active member. Returns null if allowed. */
    async function denyReason(orgId: string): Promise<string | null> {
        const org = await storage.getOrganism(orgId);
        if (!org) return 'Organism not found';
        if (org.agentGaiis?.includes(agentGaii)) return null;
        const m = await storage.getMembership(orgId, ownerName);
        return m && m.status === 'active' ? null : 'Not an active member of this organism';
    }

    const writeRecord = async (key: string, value: unknown, prev: MemoryRecord | null): Promise<void> => {
        const now = new Date().toISOString();
        await storage.setMemory({
            key, ownerGaii: ownerGhii, value, visibility: 'private', tags: [], ttlHours: null,
            version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
        });
    };

    // ── aimeat_workspace_list ──
    mcp.tool('aimeat_workspace_list', descriptionFor('aimeat_workspace_list'),
        { organism_id: z.string().describe('Organism id') },
        annotationsFor('aimeat_workspace_list'),
        async ({ organism_id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const rec = await storage.getMemory(ownerGhii, `organism.${organism_id}.meta.workspaces`);
            const workspaces = (rec?.value as { workspaces?: unknown[] } | undefined)?.workspaces ?? [];
            return ok({ organism_id, workspaces });
        });

    // ── aimeat_workspace_read ──
    mcp.tool('aimeat_workspace_read', descriptionFor('aimeat_workspace_read'),
        { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list)') },
        annotationsFor('aimeat_workspace_read'),
        async ({ organism_id, ws }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const root = wsRoot(organism_id, ws);
            const man = await storage.getMemory(ownerGhii, `${root}.meta.manifest`);
            if (!man) return fail(`No manifest at ${root}.meta.manifest — empty workspace or wrong ws id.`);
            const manifest = man.value as Manifest;
            const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000 });
            const mine = items.filter(r => r.ownerGaii === ownerGhii);
            const objects: Record<string, unknown[]> = {};
            const drafts: Record<string, unknown[]> = {};
            for (const ot of manifest.objectTypes ?? []) {
                if (!ot.namespace || ot.backing !== 'memory') continue;
                const nsPrefix = `${root}.${ot.namespace}.`;
                const inst = new Map<string, { latest?: unknown; draft?: unknown }>();
                for (const r of mine) {
                    if (!r.key.startsWith(nsPrefix)) continue;
                    const parts = r.key.slice(nsPrefix.length).split('.');
                    const role = parts.slice(1).join('.');
                    const slot = inst.get(parts[0]) ?? {};
                    if (role === '' || role === 'latest') slot.latest = r.value;
                    else if (role === 'draft') slot.draft = r.value;
                    inst.set(parts[0], slot);
                }
                const cur: unknown[] = []; const drf: unknown[] = [];
                for (const s of inst.values()) { if (s.latest !== undefined) cur.push(s.latest); if (s.draft !== undefined) drf.push(s.draft); }
                objects[ot.name] = cur;
                if (drf.length) drafts[ot.name] = drf;
            }
            return ok({ organism_id, ws, manifest, objects, drafts });
        });

    // ── aimeat_workspace_write_draft ──
    mcp.tool('aimeat_workspace_write_draft', descriptionFor('aimeat_workspace_write_draft'),
        {
            organism_id: z.string(), ws: z.string(),
            namespace: z.string().describe("The objectType's namespace, e.g. shared.deliverables"),
            id: z.string().describe('Instance id (new or existing to overwrite)'),
            // Some clients JSON-stringify an untyped object param — the handler's coerceValue parses
            // a string back to an object so records still validate and documents aren't stored corrupt.
            // (Kept as z.any() — a z.record/union here broke the MCP SDK's schema conversion.)
            value: z.any().describe('The record/document as a JSON OBJECT (not a string). Records must match the manifest schema; documents are { id, title, markdown }.'),
        },
        annotationsFor('aimeat_workspace_write_draft'),
        async ({ organism_id, ws, namespace, id, value }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const key = `${wsRoot(organism_id, ws)}.${namespace}.${id}.draft`;
            const v = coerceValue(value, id);
            const valid = await validateMemoryWrite(key, v, storage);
            if (!valid.valid) return fail('Draft rejected by schema: ' + JSON.stringify(valid.errors));
            await writeRecord(key, v, await storage.getMemory(ownerGhii, key));
            return ok({ written: key });
        });

    // ── aimeat_workspace_publish ──
    mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
        annotationsFor('aimeat_workspace_publish'),
        async ({ organism_id, ws, namespace, id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const cfg = await storage.getMemory(ownerGhii, `organism.${organism_id}.meta.config`);
            const gate = (cfg?.value as { gates?: { publish?: { enabled?: boolean } } } | undefined)?.gates?.publish?.enabled;
            if (gate) return fail('Publishing requires human approval (the publish gate is on). Leave it as a draft for the owner to review and publish.');
            const base = `${wsRoot(organism_id, ws)}.${namespace}.${id}`;
            const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
            const draft = items.find(r => r.key === `${base}.draft` && r.ownerGaii === ownerGhii);
            if (!draft) return fail(`No draft at ${base}.draft`);
            const valid = await validateMemoryWrite(`${base}.latest`, draft.value, storage);
            if (!valid.valid) return fail('Draft does not match the schema: ' + JSON.stringify(valid.errors));
            let maxN = 0;
            for (const r of items) { if (r.key.startsWith(`${base}.version.`)) { const s = r.key.slice(`${base}.version.`.length); if (/^\d+$/.test(s)) maxN = Math.max(maxN, parseInt(s, 10)); } }
            const n = maxN + 1;
            const now = new Date().toISOString();
            const tags = draft.tags ?? [];
            await storage.setMemory({ key: `${base}.version.${n}`, ownerGaii: ownerGhii, value: draft.value, visibility: draft.visibility, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now });
            const existingLatest = items.find(r => r.key === `${base}.latest`);
            await storage.setMemory({ key: `${base}.latest`, ownerGaii: ownerGhii, value: draft.value, visibility: draft.visibility, tags, ttlHours: null, version: (existingLatest?.version ?? 0) + 1, createdAt: existingLatest?.createdAt ?? now, updatedAt: now });
            await storage.deleteMemory(ownerGhii, `${base}.draft`);
            return ok({ published: base, version: n });
        });

    // ── aimeat_workspace_add_document ──
    mcp.tool('aimeat_workspace_add_document', descriptionFor('aimeat_workspace_add_document'),
        {
            organism_id: z.string(), ws: z.string(),
            type: z.string().describe('Name of a document-mode objectType (a wiki space)'),
            title: z.string(), markdown: z.string(),
            section: z.string().optional().describe('Optional section id/name to file the document under'),
        },
        annotationsFor('aimeat_workspace_add_document'),
        async ({ organism_id, ws, type, title, markdown, section }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const root = wsRoot(organism_id, ws);
            const man = await storage.getMemory(ownerGhii, `${root}.meta.manifest`);
            const ot = ((man?.value as Manifest | undefined)?.objectTypes ?? []).find(o => o.name === type && o.mode === 'document');
            if (!ot || !ot.namespace) return fail(`No document space named "${type}" in this workspace.`);
            const docId = 'doc-' + Math.random().toString(36).slice(2, 9);
            const key = `${root}.${ot.namespace}.${docId}.draft`;
            await writeRecord(key, { id: docId, title, markdown }, null);
            if (section) {
                const secKey = `${root}.meta.sections.${type}`;
                const secRec = await storage.getMemory(ownerGhii, secKey);
                const sections = ((secRec?.value as { sections?: { id: string; name?: string; documents?: string[] }[] } | undefined)?.sections) ?? [];
                const target = sections.find(s => s.id === section || s.name === section);
                if (target) {
                    target.documents = [...(target.documents ?? []).filter(d => d !== docId), docId];
                    await writeRecord(secKey, { sections }, secRec);
                }
            }
            return ok({ written: key, doc_id: docId, type, section: section ?? null });
        });

    // ── aimeat_workspace_delete ──
    mcp.tool('aimeat_workspace_delete', descriptionFor('aimeat_workspace_delete'),
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
        annotationsFor('aimeat_workspace_delete'),
        async ({ organism_id, ws, namespace, id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const root = wsRoot(organism_id, ws);
            const base = `${root}.${namespace}.${id}`;
            const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
            let deleted = 0;
            for (const r of items) {
                if (r.ownerGaii !== ownerGhii) continue;
                const role = r.key.slice(base.length + 1);   // after `${base}.`
                if (role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
                    if (await storage.deleteMemory(ownerGhii, r.key)) deleted++;
                }
            }
            if (deleted === 0) return fail(`Nothing to delete at ${base} (no draft/latest/version).`);
            // Best-effort: unfile the id from the document section tree (find the type by namespace).
            const man = await storage.getMemory(ownerGhii, `${root}.meta.manifest`);
            const ot = ((man?.value as Manifest | undefined)?.objectTypes ?? []).find(o => o.namespace === namespace);
            if (ot) {
                const secKey = `${root}.meta.sections.${ot.name}`;
                const secRec = await storage.getMemory(ownerGhii, secKey);
                const sections = (secRec?.value as { sections?: { documents?: string[] }[] } | undefined)?.sections;
                if (sections) {
                    let changed = false;
                    for (const s of sections) {
                        if ((s.documents ?? []).includes(id)) { s.documents = (s.documents ?? []).filter(d => d !== id); changed = true; }
                    }
                    if (changed) await writeRecord(secKey, { sections }, secRec);
                }
            }
            return ok({ deleted: base, keys: deleted });
        });

    // ── aimeat_workspace_create ──
    mcp.tool('aimeat_workspace_create', descriptionFor('aimeat_workspace_create'),
        {
            organism_id: z.string(),
            name: z.string().describe('Workspace name'),
            manifest: z.any().describe('The workspace manifest (objectTypes + policy) as a JSON OBJECT, not a string.'),
            schemas: z.any().optional().describe('Map of namespace → JSON Schema for records types, as a JSON OBJECT.'),
            readme: z.string().optional().describe('Optional markdown intro'),
        },
        annotationsFor('aimeat_workspace_create'),
        async ({ organism_id, name, manifest, schemas, readme }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const man = parseObj(manifest) as Manifest | undefined;
            if (!man || typeof man !== 'object' || !Array.isArray(man.objectTypes)) {
                return fail('manifest must be an object with an objectTypes array.');
            }
            const schemaMap = (parseObj(schemas) ?? {}) as Record<string, Record<string, unknown>>;
            const wsId = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
            const root = wsRoot(organism_id, wsId);
            const now = new Date().toISOString();
            // 1. Lock the records schemas under the owner GHII (direct storage — bypasses the route's
            //    owner/operator gate, which an agent token would fail).
            for (const [namespace, schema] of Object.entries(schemaMap)) {
                if (!schema || typeof schema !== 'object') continue;
                await storage.setSchema({ keyPattern: `${root}.${namespace}`, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: ownerGhii, setAt: now, updatedAt: now });
            }
            // 2. Write the manifest (validated against the manifest meta-schema).
            const manifestValue = { ...man, id: organism_id, status: man.status || 'active' };
            const mkey = `${root}.meta.manifest`;
            const valid = await validateMemoryWrite(mkey, manifestValue, storage);
            if (!valid.valid) return fail('Manifest rejected by schema: ' + JSON.stringify(valid.errors));
            await writeRecord(mkey, manifestValue, null);
            // 3. Readme.
            const summary = (man as Record<string, unknown>).summary;
            await writeRecord(`${root}.meta.readme`, readme || `# ${String(man.name || name)}\n\n${typeof summary === 'string' ? summary : ''}`, null);
            // 4. Register in the workspace registry.
            const regKey = `organism.${organism_id}.meta.workspaces`;
            const regRec = await storage.getMemory(ownerGhii, regKey);
            const workspaces = ((regRec?.value as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [];
            await writeRecord(regKey, { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now }] }, regRec);
            return ok({ created: true, ws: wsId, types: man.objectTypes.map(o => o.name), schemas_locked: Object.keys(schemaMap) });
        });
}
