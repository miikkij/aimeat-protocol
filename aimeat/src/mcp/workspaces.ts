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
 *   v1.2.0 -- 2026-06-08 -- Per-workspace access: _request_access / _list_requests / _approve_access
 *     (consent-backed, creator-controlled). _read now aggregates across member identities + the
 *     consent guard, so a granted member reads a shared workspace over MCP.
 *   v1.3.0 -- 2026-06-09 -- _export / _import (full-fidelity ZIP backup/restore as base64; size-capped
 *     inline). Reuses services/workspace-export + workspace-import.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { authorizeRead } from '../services/access-guard.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { importWorkspace } from '../services/workspace-import.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { updateWorkspaceMeta, WorkspaceMetaError } from '../services/workspace-meta.js';
import { recordSecurityIncident } from '../services/security-incident.js';

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

    // ── workspace-access helpers (shared with the GET/POST workspace-access routes) ──
    const bareOwner = (gaii: string) => (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];
    /** Find a workspace's registry entry across every member's registry. */
    const findWsEntry = async (orgId: string, ws: string): Promise<{ createdBy: string; ownerGaii: string } | null> => {
        const regKey = `organism.${orgId}.meta.workspaces`;
        const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
        for (const rec of items) {
            if (rec.key !== regKey) continue;
            const list = (rec.value as { workspaces?: Array<{ id: string; createdBy?: string }> } | null)?.workspaces ?? [];
            const entry = list.find(w => w.id === ws);
            if (entry) return { createdBy: entry.createdBy ?? bareOwner(rec.ownerGaii), ownerGaii: rec.ownerGaii };
        }
        return null;
    };
    /** Active membership role of the agent's owner in an org, or null. */
    const roleOf = async (orgId: string): Promise<string | null> => {
        const m = await storage.getMembership(orgId, ownerName);
        return m && m.status === 'active' ? m.role : null;
    };
    /** Create a consent grant if no equivalent active one exists (idempotent). */
    const ensureConsent = async (owner: string, dataPattern: string, recipient: string, purpose: string): Promise<void> => {
        const existing = await storage.listConsents(owner, { status: 'active' });
        if (existing.some(c => c.dataPattern === dataPattern && c.recipient === recipient)) return;
        const now = new Date().toISOString();
        await storage.createConsent({ id: randomUUID(), ownerGaii: owner, dataPattern, recipient, purpose, scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
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
            // Aggregate across all member identities, then access-filter: own records pass; others go
            // through the consent guard (so a member who was granted access reads the shared workspace).
            const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000 });
            const mine: MemoryRecord[] = [];
            for (const r of items) {
                if (r.ownerGaii === ownerGhii) { mine.push(r); continue; }
                const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: ownerGhii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
                if (d.allowed) mine.push(r);
            }
            const manRec = mine.find(r => r.key === `${root}.meta.manifest`);
            if (!manRec) return fail(`No manifest at ${root}.meta.manifest — empty workspace, wrong ws id, or no access (request access with aimeat_workspace_request_access).`);
            const manifest = manRec.value as Manifest;
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

    // ── aimeat_workspace_update ──
    mcp.tool('aimeat_workspace_update', descriptionFor('aimeat_workspace_update'),
        {
            organism_id: z.string(),
            ws: z.string(),
            name: z.string().optional().describe('New workspace name (synced to the manifest + the registry)'),
            readme: z.string().optional().describe('New markdown readme/intro (replaces the current one)'),
            manifest: z.any().optional().describe('FULL replacement manifest (objectTypes + policy/gate + settings) as a JSON OBJECT. Read the workspace first, then add/remove an objectType to add/remove a space, or change policy.alwaysGate for the publish gate. The id is preserved.'),
            schemas: z.any().optional().describe('Map of namespace → JSON Schema (object) to lock (strict) for a records space.'),
        },
        annotationsFor('aimeat_workspace_update'),
        async ({ organism_id, ws, name, readme, manifest, schemas }): Promise<TextResult> => {
            const role = await roleOf(organism_id);
            if (!role) return fail('You are not a member of this organism.');
            try {
                const result = await updateWorkspaceMeta(storage, config, {
                    orgId: organism_id, ws, callerOwner: ownerName,
                    isAdmin: role === 'admin' || role === 'creator', name, readme,
                    manifest: parseObj(manifest) as Record<string, unknown> | undefined,
                    schemas: parseObj(schemas) as Record<string, Record<string, unknown>> | undefined,
                });
                return ok(result);
            } catch (e) {
                if (e instanceof WorkspaceMetaError) return fail(e.message);
                return fail((e as Error).message || 'Update failed');
            }
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

    // ── aimeat_workspace_object_delete ──
    mcp.tool('aimeat_workspace_object_delete', descriptionFor('aimeat_workspace_object_delete'),
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
        annotationsFor('aimeat_workspace_object_delete'),
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
            await writeRecord(regKey, { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now, createdBy: ownerName }] }, regRec);
            return ok({ created: true, ws: wsId, types: man.objectTypes.map(o => o.name), schemas_locked: Object.keys(schemaMap) });
        });

    // ── aimeat_workspace_request_access ──
    mcp.tool('aimeat_workspace_request_access', descriptionFor('aimeat_workspace_request_access'),
        { organism_id: z.string(), ws: z.string(), message: z.string().optional() },
        annotationsFor('aimeat_workspace_request_access'),
        async ({ organism_id, ws, message }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const entry = await findWsEntry(organism_id, ws);
            if (!entry) return fail('Workspace not found');
            if (entry.createdBy === ownerName) return fail('You created this workspace.');
            await writeRecord(`organism.${organism_id}.w.${ws}.access.request.${ownerName}`, { ws, requester: ownerName, requester_gaii: ownerGhii, message: message ?? '', status: 'pending', createdAt: new Date().toISOString() }, null);
            await ensureConsent(ownerGhii, `organism.${organism_id}.w.${ws}.**`, `organism.${organism_id}`, 'workspace-contribution');
            return ok({ status: 'requested', ws, workspace_creator: entry.createdBy });
        });

    // ── aimeat_workspace_list_requests ──
    mcp.tool('aimeat_workspace_list_requests', descriptionFor('aimeat_workspace_list_requests'),
        { organism_id: z.string(), ws: z.string() },
        annotationsFor('aimeat_workspace_list_requests'),
        async ({ organism_id, ws }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const entry = await findWsEntry(organism_id, ws);
            if (!entry) return fail('Workspace not found');
            const role = await roleOf(organism_id);
            if (entry.createdBy !== ownerName && role !== 'creator' && role !== 'admin') return fail('Only the workspace creator or an org admin can see access requests.');
            const creatorGhii = `${entry.createdBy}@${config.nodeId}`;
            const grants = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === `organism.${organism_id}.w.${ws}.**` && c.purpose === 'workspace-access');
            const approved = new Set(grants.map(c => c.recipient));
            const { items } = await storage.listAllMemory({ prefix: `organism.${organism_id}.w.${ws}.access.request.`, limit: 1000 });
            const requests = items.map(r => {
                const v = r.value as { requester?: string; message?: string; createdAt?: string };
                const requester = v.requester ?? bareOwner(r.ownerGaii);
                return { requester, message: v.message ?? '', created_at: v.createdAt, status: approved.has(`ghii:${requester}@${config.nodeId}`) ? 'approved' : 'pending' };
            });
            return ok({ ws, requests });
        });

    // ── aimeat_workspace_approve_access ──
    mcp.tool('aimeat_workspace_approve_access', descriptionFor('aimeat_workspace_approve_access'),
        { organism_id: z.string(), ws: z.string(), requester: z.string(), decision: z.string().optional() },
        annotationsFor('aimeat_workspace_approve_access'),
        async ({ organism_id, ws, requester, decision }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const entry = await findWsEntry(organism_id, ws);
            if (!entry) return fail('Workspace not found');
            const role = await roleOf(organism_id);
            if (entry.createdBy !== ownerName && role !== 'creator' && role !== 'admin') return fail('Only the workspace creator or an org admin can decide access.');
            const recipient = `ghii:${requester}@${config.nodeId}`;
            const pattern = `organism.${organism_id}.w.${ws}.**`;
            if (decision === 'deny') {
                const grants = (await storage.listConsents(ownerGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && c.purpose === 'workspace-access');
                for (const g of grants) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: new Date().toISOString() });
                return ok({ status: 'denied', ws, requester });
            }
            await ensureConsent(ownerGhii, pattern, recipient, 'workspace-access');
            return ok({ status: 'approved', ws, requester });
        });

    // ── aimeat_workspace_export ──
    mcp.tool('aimeat_workspace_export', descriptionFor('aimeat_workspace_export'),
        { organism_id: z.string(), ws: z.string() },
        annotationsFor('aimeat_workspace_export'),
        async ({ organism_id, ws }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const entry = await findWsEntry(organism_id, ws);
            if (!entry) return fail('Workspace not found');
            const role = await roleOf(organism_id);
            if (entry.createdBy !== ownerName && role !== 'creator' && role !== 'admin') return fail('Only the workspace creator or an org admin can export.');
            const { buffer, filename } = await exportWorkspace(storage, config, { orgId: organism_id, ws, exporterGaii: ownerGhii, exportedAt: new Date().toISOString() });
            if (buffer.length > 1_500_000) return fail(`Workspace too large for inline export (${buffer.length} bytes) — download it from the UI/REST instead.`);
            return ok({ filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') });
        });

    // ── aimeat_workspace_import ──
    mcp.tool('aimeat_workspace_import', descriptionFor('aimeat_workspace_import'),
        { organism_id: z.string(), zip_base64: z.string() },
        annotationsFor('aimeat_workspace_import'),
        async ({ organism_id, zip_base64 }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const buf = Buffer.from(zip_base64, 'base64');
            if (!buf.length) return fail('zip_base64 is empty or invalid.');
            try {
                const result = await importWorkspace(storage, config, { orgId: organism_id, importerGaii: ownerGhii, importerOwner: ownerName, zip: buf });
                return ok(result);
            } catch (e) {
                if (e instanceof ZipSecurityError) {
                    const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: ownerGhii, actorName: ownerName, detail: e.message, source: 'workspace_import_mcp', blob: buf });
                    return fail(`Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`);
                }
                return fail((e as Error).message || 'Import failed');
            }
        });
}
