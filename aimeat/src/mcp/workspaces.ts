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
 *   v (2026-07-07) -- TARGET-009 S1: _publish takes expected_version (optimistic lock) and runs
 *     the write guards via validateMemoryWrite ctx; _object_delete refuses append-only records.
 *   v1.0.0 -- 2026-06-08 -- Initial: 5 workspace tools wrapping the manifest/draft/publish convention.
 *   v1.1.0 -- 2026-06-08 -- write_draft coerces a JSON-stringified value (clients stringify untyped
 *     object params); add _delete (retract an object) and _create (bootstrap a workspace from a
 *     custom manifest + per-namespace schemas, locked under the owner GHII).
 *   v1.2.0 -- 2026-06-08 -- Per-workspace access: _request_access / _list_requests / _approve_access
 *     (consent-backed, creator-controlled). _read now aggregates across member identities + the
 *     consent guard, so a granted member reads a shared workspace over MCP.
 *   v1.3.0 -- 2026-06-09 -- _export / _import (full-fidelity ZIP backup/restore as base64; size-capped
 *     inline). Reuses services/workspace-export + workspace-import.
 *   v1.3.1 -- 2026-06-09 -- _list aggregates the workspace registry across ALL member identities (was
 *     reading only the caller's own GHII record), so a member who didn't create a workspace no longer
 *     sees an empty list. Matches findWsEntry / _read.
 *   v1.3.2 -- 2026-06-09 -- _write / _object_delete read the manifest via a new readManifest() that
 *     aggregates across members (was caller-GHII only → "No space named X" for non-creator members),
 *     and _write accepts the objectType NAME or its NAMESPACE (small models often pass the namespace).
 *   v1.4.0 -- 2026-06-09 -- Same-owner workspace access: _read/_publish/_object_delete treat same-owner
 *     records as the caller's own (isSameOwner), so a sub-agent uses its owner's workspace and the owner
 *     sees the sub-agent's writes. _write now enforces canWriteWs (creator or granted member) so the
 *     MCP-serve write path matches the REST workspaceAccessMiddleware gate (was looser — wrote ungated).
 *   v1.5.0 -- 2026-06-09 -- Every mutating tool (_write/_publish/_update/_object_delete/_create/_access
 *     request+decide/_transfer import) now emitChange('organisms') so an open workspace view live-updates
 *     over SSE when an agent changes it (the REST org routes already emit; the MCP path was silent).
 *   v1.6.0 -- 2026-06-09 -- Attribution: content drafts + published versions are authored under the
 *     calling AGENT's GAII (writerGaii), not ownerGhii — so the activity feed + participants attribute
 *     an agent's work to the agent. Meta (manifest/registry/schemas/sections) stays under ownerGhii;
 *     writes reuse an existing record's owner (findByKey) to avoid a duplicate under a second identity.
 *   v1.7.0 -- 2026-06-09 -- Member roles: _access decide grants a creator-owned viewer|contributor role
 *     (setWsRole/revokeWsRole), and canWriteWs requires the 'contributor' role only (revocable) instead
 *     of the requester's own contribution consent. _access list now returns members + their roles.
 *   v1.8.0 -- 2026-06-09 -- _read is workspace-level: authorize once on the manifest, then return ALL
 *     content (not per record), so every member of a shared workspace sees each other's contributions.
 *   v1.9.0 -- 2026-06-10 -- Backing gate (the invisible-documents bug): _create normalizes objectTypes
 *     (rejects backing 'storage'/'knowledge', infers mode:'document' from kind:'document'); _write
 *     refuses non-memory spaces instead of silently writing records no read path lists; _read uses
 *     the shared isMemoryBackedSpace() predicate (missing backing = memory) instead of its own filter.
 *   v1.10.0 -- 2026-06-13 -- _organism_overview / _workspace_overview: read-only OKF-style structure
 *     maps (Markdown) so an agent grasps an organism / workspace in one call and navigates straight to
 *     the id it needs. Reuse services/structure-overview.ts; viewer = owner GHII (matches _read).
 *   v1.11.0 -- 2026-07-01 -- _publish change-guard + versioned flag: an unchanged re-publish (contract
 *     agents re-publish the same draft every poll cycle) now returns { skipped:true } instead of
 *     appending a byte-identical .version.N; and publish honours the objectType's `versioned` flag
 *     (default true) so a `versioned:false` space keeps only .latest (no per-publish history).
 *   v1.12.0 -- 2026-07-02 -- Workspace app bindings: _update accepts `apps` (FULL replace, [] clears —
 *     pins published apps {owner, filename} to the workspace via updateWorkspaceMeta) and _read
 *     returns the pinned `apps` list alongside the manifest.
 *   v1.13.0 -- 2026-07-07 -- _read is index-first: DEFAULT returns a lightweight INDEX (per space, each
 *     instance's id/title/updated/version/bytes — titles only, no bodies) instead of every object's full
 *     value in one blob (which grew to 100s of KB, too big for an MCP round-trip). Pass `ids` to
 *     batch-open the FULL value of just those instances. Version history is never surfaced by _read.
 *   v1.14.0 -- 2026-07-11 -- _write + _publish normalize embedded document image URLs (raw /v1/storage
 *     → owner-addressed /v1/pub) and scope those files to the workspace (members-only) via
 *     services/doc-images — MCP-authored docs no longer store images that load for nobody.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII, isSameOwner } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { checkDeleteGuard } from '../services/write-guards.js';
import { authorizeRead } from '../services/access-guard.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { buildOrganismOverview, buildWorkspaceOverview, entryTitle } from '../services/structure-overview.js';
import { importWorkspace } from '../services/workspace-import.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { updateWorkspaceMeta, WorkspaceMetaError, normalizeObjectTypes, isMemoryBackedSpace, listOrganismWorkspaceEntries } from '../services/workspace-meta.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { emitChange, emitMemoryWritten } from '../services/event-bus.js';
import { updateOrganismStructure } from '../services/structure-snapshot.js';
import { normalizeDocValueImages } from '../services/doc-images.js';

type ObjType = { name: string; namespace?: string; backing?: string; mode?: string; kind?: string; versioned?: boolean };
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
    // The identity that AUTHORS content: an agent's own GAII when an agent is calling (so the activity
    // feed + participants attribute the work to the AGENT, not its owner — the MCP-serve path used to
    // write everything under ownerGhii, collapsing every agent action onto the owner), else the owner
    // GHII. Workspace META (manifest / registry / schemas / sections) stays under ownerGhii.
    const writerGaii = parsed ? agentGaii : ownerGhii;
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

    /** Pick the freshest of two records for the same key: higher version wins, then newer updatedAt.
     *  Guards every workspace read/write against a key that has forked into duplicate-owner copies. */
    const fresher = (a: MemoryRecord | null | undefined, b: MemoryRecord): MemoryRecord => {
        if (!a) return b;
        if (b.version !== a.version) return b.version > a.version ? b : a;
        return (b.updatedAt ?? '') >= (a.updatedAt ?? '') ? b : a;
    };
    /** Find the FRESHEST existing record at an EXACT key, whichever identity owns it. Memory is keyed by
     *  (ownerGaii, key); a key ever written under two identities (a GHII and an agent GAII) has duplicate
     *  copies — carry the freshest forward and collapse the rest (see collapseTo). */
    const findByKey = async (key: string): Promise<MemoryRecord | null> => {
        const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
        return items.filter(r => r.key === key).reduce<MemoryRecord | null>((best, r) => fresher(best, r), null);
    };
    /** Delete every copy of `key` NOT owned by `keepOwner` — collapses a forked key back to one owner. */
    const collapseTo = async (key: string, keepOwner: string): Promise<void> => {
        const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
        await Promise.all(items
            .filter(r => r.key === key && r.ownerGaii !== keepOwner)
            .map(r => storage.deleteMemory(r.ownerGaii, r.key).catch(() => { /* best-effort collapse */ })));
    };
    /** Write workspace CONTENT under the member's GHII — ONE owner per key, so a record never forks into
     *  per-agent duplicates that the read path then has to disambiguate. Author/attribution is preserved
     *  on the immutable `.version.N` records (writerGaii) and the activity timeline, so collapsing the
     *  current-state owner onto the GHII costs no attribution. `owner` is overridable only for META that
     *  must stay under a specific identity. A legacy copy under a different identity is collapsed away. */
    const writeRecord = async (key: string, value: unknown, prev: MemoryRecord | null, owner: string = ownerGhii): Promise<void> => {
        const now = new Date().toISOString();
        await storage.setMemory({
            key, ownerGaii: owner, value, visibility: prev?.visibility ?? 'private', tags: prev?.tags ?? [], ttlHours: null,
            version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
        });
        if (prev && prev.ownerGaii !== owner) await collapseTo(key, owner);
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
    /** Read a workspace's manifest from whichever member created it (aggregates across registries), so a
     *  member who didn't create the workspace can still resolve its spaces to write/delete records. */
    const readManifest = async (orgId: string, ws: string): Promise<Manifest | null> => {
        const key = `${wsRoot(orgId, ws)}.meta.manifest`;
        const { items } = await storage.listAllMemory({ prefix: key, limit: 100 });
        const rec = items.find(r => r.key === key);
        return rec ? (rec.value as Manifest) : null;
    };
    /** Active membership role of the agent's owner in an org, or null. */
    const roleOf = async (orgId: string): Promise<string | null> => {
        const m = await storage.getMembership(orgId, ownerName);
        return m && m.status === 'active' ? m.role : null;
    };
    /** May the caller WRITE this workspace's content? The creator's own owner (incl. its agents) always
     *  can; another member needs a granted workspace-contribution consent. Mirrors workspaceAccessMiddleware
     *  so the MCP-serve write path enforces the SAME per-workspace gate as the REST path (no looser side). */
    const canWriteWs = async (orgId: string, ws: string): Promise<boolean> => {
        const entry = await findWsEntry(orgId, ws);
        if (!entry) return true;                              // no registry yet (bootstrap) — membership already checked
        if (entry.createdBy === ownerName) return true;      // the workspace's own creator (or its agent)
        // Write requires the creator's 'contributor' role grant — and ONLY that, so the creator can
        // revoke write by removing the grant. A 'viewer' grant gives read only (not matched here). The
        // role is granted to the OWNER (recipient ghii:owner@node), so all the owner's agents inherit it.
        const creatorGhii = `${entry.createdBy}@${config.nodeId}`;
        const myRecipient = `ghii:${ownerName}@${config.nodeId}`;
        const pattern = `organism.${orgId}.w.${ws}.**`;
        const grants = await storage.listConsents(creatorGhii, { status: 'active' });
        return grants.some(c => c.purpose === 'workspace-contributor' && c.dataPattern === pattern && c.recipient === myRecipient);
    };
    /** Create a consent grant if no equivalent active one exists (idempotent). */
    const ensureConsent = async (owner: string, dataPattern: string, recipient: string, purpose: string): Promise<void> => {
        const existing = await storage.listConsents(owner, { status: 'active' });
        if (existing.some(c => c.dataPattern === dataPattern && c.recipient === recipient)) return;
        const now = new Date().toISOString();
        await storage.createConsent({ id: randomUUID(), ownerGaii: owner, dataPattern, recipient, purpose, scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
    };
    // ── Workspace member roles (mirrors the REST routes): viewer = read, contributor = read+write,
    //    as a consent the workspace CREATOR owns on organism.{id}.w.{ws}.**. See the routes for the model. ──
    const WS_ROLE_PURPOSES = ['workspace-viewer', 'workspace-contributor', 'workspace-access'];
    const setWsRole = async (creatorGhii: string, orgId: string, ws: string, granteeOwner: string, role: 'viewer' | 'contributor'): Promise<void> => {
        const recipient = `ghii:${granteeOwner}@${config.nodeId}`;
        const pattern = `organism.${orgId}.w.${ws}.**`;
        const now = new Date().toISOString();
        const prior = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
        for (const g of prior) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
        await storage.createConsent({ id: randomUUID(), ownerGaii: creatorGhii, dataPattern: pattern, recipient, purpose: role === 'contributor' ? 'workspace-contributor' : 'workspace-viewer', scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null });
    };
    const revokeWsRole = async (creatorGhii: string, orgId: string, ws: string, granteeOwner: string): Promise<void> => {
        const recipient = `ghii:${granteeOwner}@${config.nodeId}`;
        const pattern = `organism.${orgId}.w.${ws}.**`;
        const now = new Date().toISOString();
        const grants = (await storage.listConsents(creatorGhii, { status: 'active' })).filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
        for (const g of grants) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
    };

    // ── aimeat_workspace_list ──
    mcp.tool('aimeat_workspace_list', descriptionFor('aimeat_workspace_list'),
        { organism_id: z.string().describe('Organism id') },
        annotationsFor('aimeat_workspace_list'),
        async ({ organism_id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            // Each workspace is registered under its CREATOR's own GHII registry record — aggregate
            // across all members via the shared helper (also used by organism export).
            const workspaces = await listOrganismWorkspaceEntries(storage, organism_id);
            return ok({ organism_id, workspaces });
        });

    // ── aimeat_workspace_read ──
    // Two modes, one tool. DEFAULT (no `ids`) → the INDEX: per space, every instance's id + title +
    // updated + version + byte-size — titles only, NO bodies — plus the manifest + pinned apps. This
    // stays small no matter how many/large the documents are (the old "return every object's full value
    // in one blob" grew to 100s of KB — too big for an MCP round-trip). BATCH-OPEN (`ids` given) →
    // the FULL value of only the requested instances. So the flow is: read the index → pick the ids
    // that likely hold what you need → read those ids. Both calls are size-bounded.
    mcp.tool('aimeat_workspace_read', descriptionFor('aimeat_workspace_read'),
        { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list)'),
          ids: z.array(z.string()).optional().describe('Batch-open: return the FULL value of ONLY these instance ids (from the index). Omit to get the lightweight index (titles + ids, no bodies).'),
          space: z.string().optional().describe('With `ids`: optionally restrict the lookup to this space (objectType NAME or namespace). Ignored for the index.'),
          include_archived: z.boolean().optional().describe('Include archived (hidden) content. Default false — archived content is excluded from normal reads.') },
        annotationsFor('aimeat_workspace_read'),
        async ({ organism_id, ws, ids, space, include_archived }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const root = wsRoot(organism_id, ws);
            // A workspace is SHARED: authorization is at the workspace level, not per record. If the caller
            // can read the manifest (creator / same-owner agent / a viewer|contributor grant), they see ALL
            // of the workspace's content whoever wrote it — so a contributor's writes are visible to the
            // creator + other members. Otherwise nothing (org membership alone is discovery-only).
            const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000, archived: include_archived ? 'include' : undefined });
            const manRec = items.find(r => r.key === `${root}.meta.manifest`);
            let canRead = false;
            if (manRec) {
                canRead = manRec.ownerGaii === ownerGhii || isSameOwner(manRec.ownerGaii, ownerGhii);
                if (!canRead) {
                    const d = await authorizeRead(storage, config, { ownerGaii: manRec.ownerGaii, accessorGaii: ownerGhii, resourceKey: manRec.key, visibility: manRec.visibility, groupId: manRec.groupId, action: 'read' });
                    canRead = d.allowed;
                }
            }
            if (!manRec || !canRead) return fail(`No manifest at ${root}.meta.manifest — empty workspace, wrong ws id, or no access (request access with aimeat_workspace_access).`);
            const manifest = manRec.value as Manifest;

            // Collapse each space's instances to their freshest { latest, draft } ONCE — reused by both
            // the index and the batch-open. `latest` wins over a bare (un-suffixed) write; fresher()
            // guards a key forked into duplicate-owner copies. Version history (.version.N) is never
            // surfaced here (it is the main bloat source) — read a specific version via the memory API.
            type Slot = { latest?: MemoryRecord; draft?: MemoryRecord };
            const spaces = new Map<string, { ot: ObjType; inst: Map<string, Slot> }>();
            for (const ot of manifest.objectTypes ?? []) {
                if (!ot.namespace || !isMemoryBackedSpace(ot)) continue;
                const nsPrefix = `${root}.${ot.namespace}.`;
                const inst = new Map<string, Slot>();
                for (const r of items) {
                    if (!r.key.startsWith(nsPrefix)) continue;
                    const parts = r.key.slice(nsPrefix.length).split('.');
                    const role = parts.slice(1).join('.');
                    const slot = inst.get(parts[0]) ?? {};
                    if (role === '' || role === 'latest') slot.latest = fresher(slot.latest, r);
                    else if (role === 'draft') slot.draft = fresher(slot.draft, r);
                    inst.set(parts[0], slot);
                }
                spaces.set(ot.name, { ot, inst });
            }
            const byteLen = (v: unknown): number => (typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length);

            // ── BATCH-OPEN: the full value of the requested ids only. ──
            if (ids && ids.length) {
                const scoped = space ? [...spaces.values()].filter(s => s.ot.name === space || s.ot.namespace === space) : [...spaces.values()];
                const found: unknown[] = [];
                const missing: string[] = [];
                for (const id of new Set(ids.map(String))) {
                    let hit = false;
                    for (const s of scoped) {
                        const slot = s.inst.get(id);
                        const cur = slot?.latest ?? slot?.draft;
                        if (!slot || !cur) continue;
                        found.push({
                            space: s.ot.name, id, value: cur.value,
                            published: !!slot.latest, _version: cur.version, _createdAt: cur.createdAt, _updatedAt: cur.updatedAt,
                            ...(slot.draft ? { draft: slot.draft.value } : {}),
                        });
                        hit = true; break;
                    }
                    if (!hit) missing.push(id);
                }
                return ok({ organism_id, ws, mode: 'content', items: found, ...(missing.length ? { missing } : {}) });
            }

            // ── INDEX (default): titles + ids, NO bodies. Every instance (uncapped). ──
            const apps = ((items.find(r => r.key === `${root}.meta.apps`)?.value as { apps?: unknown[] } | undefined)?.apps) ?? [];
            const index: Record<string, unknown[]> = {};
            const counts: Record<string, number> = {};
            for (const [name, s] of spaces) {
                const entries = [...s.inst.entries()]
                    .map(([id, slot]) => {
                        const cur = slot.latest ?? slot.draft!;
                        return { id, title: entryTitle(cur.value, id), updated: cur.updatedAt, version: slot.latest?.version ?? 0, bytes: byteLen(cur.value), published: !!slot.latest, has_draft: !!slot.draft };
                    })
                    .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id < b.id ? -1 : 1));
                index[name] = entries;
                counts[name] = entries.length;
            }
            return ok({ organism_id, ws, mode: 'index', manifest, apps, counts, index,
                hint: 'Titles only. Open the ones you need with aimeat_workspace_read(ids:["<id>", ...]) to get their full values.' });
        });

    // ── aimeat_organism_overview ── (OKF-style structure map of the whole organism)
    mcp.tool('aimeat_organism_overview', descriptionFor('aimeat_organism_overview'),
        { organism_id: z.string().describe('Organism id'),
          include_archived: z.boolean().optional().describe('Include archived workspaces. Default false — archived workspaces are summarised as a count.') },
        annotationsFor('aimeat_organism_overview'),
        async ({ organism_id, include_archived }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const { markdown } = await buildOrganismOverview(storage, config, { orgId: organism_id, viewerGaii: ownerGhii, includeArchived: include_archived });
            return { content: [{ type: 'text', text: markdown }] };
        });

    // ── aimeat_workspace_overview ── (OKF-style structure map of ONE workspace)
    mcp.tool('aimeat_workspace_overview', descriptionFor('aimeat_workspace_overview'),
        { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list)') },
        annotationsFor('aimeat_workspace_overview'),
        async ({ organism_id, ws }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const { markdown } = await buildWorkspaceOverview(storage, config, { orgId: organism_id, ws, viewerGaii: ownerGhii });
            return { content: [{ type: 'text', text: markdown }] };
        });

    // ── aimeat_workspace_write_draft ──
    mcp.tool('aimeat_workspace_write', descriptionFor('aimeat_workspace_write'),
        {
            organism_id: z.string(), ws: z.string(),
            space: z.string().describe("The objectType (space) NAME — e.g. 'feedback' or 'task' (the manifest's objectTypes[].name, NOT its namespace like 'shared.feedback'). The tool resolves whether it is a records or document space."),
            // z.any(): some clients JSON-stringify an object param — coerceValue parses it back so records
            // validate and documents aren't stored corrupt. (A z.record/union here breaks the MCP SDK.)
            value: z.any().describe('The content as a JSON OBJECT (not a string). For a records space, the record (matching its schema). For a document space, { title, markdown }.'),
            id: z.string().optional().describe('Instance id. Required for a records space (or include id in value); auto-generated for a document.'),
            section: z.string().optional().describe('Document spaces only: section id/name to file the document under.'),
        },
        annotationsFor('aimeat_workspace_write'),
        async ({ organism_id, ws, space, value, id, section }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            if (!(await canWriteWs(organism_id, ws))) return fail('You are not approved to write to this workspace. Request access with aimeat_workspace_access(action:"request") and wait for the creator to approve.');
            const root = wsRoot(organism_id, ws);
            // Aggregate the manifest across members so a member who didn't create the workspace can write,
            // and accept either the space NAME or its namespace (small models often pass the namespace).
            const man = await readManifest(organism_id, ws);
            const types = (man?.objectTypes ?? []);
            const ot = types.find(o => o.name === space || o.namespace === space);
            if (!ot || !ot.namespace) {
                const names = types.map(o => o.name).filter(Boolean).join(', ');
                return fail(`No space named "${space}" in this workspace. Available spaces: ${names || '(none)'}. Pass the space NAME, not its namespace.`);
            }
            // A non-memory space's data does NOT live in workspace records — writing it here would
            // store memory keys that no read surface (workspace_read / REST / the UI) ever lists.
            // That silent black hole is exactly how 16 published documents once went invisible.
            if (!isMemoryBackedSpace(ot)) {
                return fail(ot.backing === 'tasks'
                    ? `Space "${ot.name}" is backed by the task system (backing:'tasks') — create tasks with the task tools (aimeat_task_create), not workspace writes.`
                    : `Space "${ot.name}" has backing '${ot.backing}', which workspace writes do not support. Update the space to backing:'memory' (aimeat_workspace_update); files and knowledge packages attach via workspace Sources or embedded document images.`);
            }
            // Old manifests declared documents as kind:'document' without a mode (the open envelope
            // swallowed the unknown field) — honour the intent instead of falling into records mode.
            const isDoc = ot.mode === 'document' || (!ot.mode && ot.kind === 'document');
            let instanceId = (id && String(id).trim()) || (value && typeof value === 'object' && !Array.isArray(value) ? String((value as Record<string, unknown>).id ?? '').trim() : '');
            if (!instanceId && isDoc) instanceId = 'doc-' + Math.random().toString(36).slice(2, 9);
            if (!instanceId) return fail('A records write needs an id (pass `id`, or include `id` in `value`).');
            const key = `${root}.${ot.namespace}.${instanceId}.draft`;
            let v = coerceValue(value, instanceId);
            // Rewrite embedded image URLs to the owner-addressed /v1/pub form and scope those files to
            // THIS workspace (members-only). MCP-authored docs otherwise store raw /v1/storage URLs that
            // load for nobody but the file owner — the exact reason chat-written docs showed broken images.
            if (isDoc) v = await normalizeDocValueImages(storage, config, v, ownerName, `${organism_id}/${ws}`);
            const valid = await validateMemoryWrite(key, v, storage);
            if (!valid.valid) return fail('Draft rejected by schema: ' + JSON.stringify(valid.errors));
            await writeRecord(key, v, await findByKey(key));   // content → authored by the calling agent
            if (isDoc && section) {
                const secKey = `${root}.meta.sections.${ot.name}`;
                const secRec = await findByKey(secKey);
                const sections = ((secRec?.value as { sections?: { id: string; name?: string; documents?: string[] }[] } | undefined)?.sections) ?? [];
                const target = sections.find(s => s.id === section || s.name === section);
                if (target) { target.documents = [...(target.documents ?? []).filter(d => d !== instanceId), instanceId]; await writeRecord(secKey, { sections }, secRec, ownerGhii); }  // section tree = creator meta
            }
            emitChange('organisms');
            return ok({ written: key, id: instanceId, space, mode: isDoc ? 'document' : 'records', section: section ?? null });
        });

    // ── aimeat_workspace_publish ──
    mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
        // expected_version: the publisher's optimistic lock — REQUIRED by namespaces whose manifest
        // sets requires_expected_version (TARGET-009 S1); pass the version you read.
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string(), expected_version: z.number().optional() },
        annotationsFor('aimeat_workspace_publish'),
        async ({ organism_id, ws, namespace, id, expected_version }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const cfg = await storage.getMemory(ownerGhii, `organism.${organism_id}.meta.config`);
            const gate = (cfg?.value as { gates?: { publish?: { enabled?: boolean } } } | undefined)?.gates?.publish?.enabled;
            if (gate) return fail('Publishing requires human approval (the publish gate is on). Leave it as a draft for the owner to review and publish.');
            const base = `${wsRoot(organism_id, ws)}.${namespace}.${id}`;
            const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
            // The draft may have been written by a sibling agent of the same owner (shell/REST path
            // stores under the agent's own GAII), so accept any same-owner draft, not just ownerGhii's.
            const draft = items.filter(r => r.key === `${base}.draft` && (r.ownerGaii === ownerGhii || isSameOwner(r.ownerGaii, ownerGhii)))
                .reduce<MemoryRecord | null>((best, r) => fresher(best, r), null);
            if (!draft) return fail(`No draft at ${base}.draft`);
            // Safety net for drafts written before the write-path normalizer (or by other clients): scope
            // embedded images to this workspace + rewrite to /v1/pub before they become the published copy.
            const draftValue = await normalizeDocValueImages(storage, config, draft.value, ownerName, `${organism_id}/${ws}`);
            const valid = await validateMemoryWrite(`${base}.latest`, draftValue, storage, { viaPublish: true, expectedVersion: expected_version ?? null });
            if (!valid.valid) return fail('Publish refused: ' + JSON.stringify(valid.errors));
            let maxN = 0;
            for (const r of items) { if (r.key.startsWith(`${base}.version.`)) { const s = r.key.slice(`${base}.version.`.length); if (/^\d+$/.test(s)) maxN = Math.max(maxN, parseInt(s, 10)); } }
            const now = new Date().toISOString();
            const tags = draft.tags ?? [];
            const existingLatest = items.filter(r => r.key === `${base}.latest`).reduce<MemoryRecord | null>((best, r) => fresher(best, r), null);
            // Change-guard: an unchanged re-publish (a contract agent re-publishes the same draft on every
            // poll/status cycle) must NOT append a byte-identical .version.N. Consume the draft and return
            // without touching .latest or firing the Tracked-Response/structure side effects.
            if (existingLatest && JSON.stringify(existingLatest.value) === JSON.stringify(draftValue)) {
                await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
                emitChange('organisms');
                return ok({ published: base, version: maxN, skipped: true });
            }
            // Honour the manifest's `versioned` flag (default true): a transient space (e.g. a request queue)
            // declared `versioned:false` keeps only .latest — no immutable per-publish history.
            const publishOt = (await readManifest(organism_id, ws))?.objectTypes?.find(o => o.namespace === namespace);
            const versioned = publishOt?.versioned !== false;
            const n = maxN + 1;
            // Attribution: the immutable .version.N snapshot is authored by the PUBLISHER (writerGaii).
            // The .latest pointer (current state) is owned by a member's GHII — ONE owner per key, so it
            // never forks into per-agent duplicates that a read then has to disambiguate. Preserve the
            // record's existing owner (normalised to their GHII — never a raw agent GAII); a brand-new
            // record is owned by the caller's GHII. collapseTo removes any copy left under another identity.
            const latestOwner = existingLatest ? `${bareOwner(existingLatest.ownerGaii)}@${config.nodeId}` : ownerGhii;
            if (versioned) await storage.setMemory({ key: `${base}.version.${n}`, ownerGaii: writerGaii, value: draftValue, visibility: draft.visibility, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now });
            await storage.setMemory({ key: `${base}.latest`, ownerGaii: latestOwner, value: draftValue, visibility: draft.visibility, tags, ttlHours: null, version: (existingLatest?.version ?? 0) + 1, createdAt: existingLatest?.createdAt ?? now, updatedAt: now });
            await collapseTo(`${base}.latest`, latestOwner);
            await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
            emitChange('organisms');
            // Memory Contracts (reactive): publishing a watched record (e.g. a bug → status:done)
            // fires Tracked Response evaluation. Gated O(1) on the track-registry in the subscriber.
            emitMemoryWritten(latestOwner, `${base}.latest`);
            void updateOrganismStructure(storage, config, organism_id, { event: 'content published', actor: writerGaii }).catch(() => { /* timeline best-effort */ });
            return ok({ published: base, version: n });
        });

    // ── aimeat_workspace_revert_to_draft ──
    mcp.tool('aimeat_workspace_revert_to_draft', descriptionFor('aimeat_workspace_revert_to_draft'),
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
        annotationsFor('aimeat_workspace_revert_to_draft'),
        async ({ organism_id, ws, namespace, id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const base = `${wsRoot(organism_id, ws)}.${namespace}.${id}`;
            const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000 });
            if (items.find(r => r.key === `${base}.draft`)) return fail(`A draft already exists at ${base}.draft — edit it directly instead of reopening.`);
            // The published current state is the FRESHEST .latest (guarding a forked key), or the bare key.
            const latest = items.filter(r => r.key === `${base}.latest`).reduce<MemoryRecord | null>((best, r) => fresher(best, r), null)
                ?? items.find(r => r.key === base) ?? null;
            if (!latest) return fail(`No published record at ${base}.latest to reopen.`);
            const now = new Date().toISOString();
            // Draft (current-state) owned by the member's GHII — one owner per key (see writeRecord).
            await storage.setMemory({ key: `${base}.draft`, ownerGaii: ownerGhii, value: latest.value, visibility: latest.visibility, tags: latest.tags ?? [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
            emitChange('organisms');
            return ok({ reopened: base });
        });

    // ── aimeat_workspace_update ──
    mcp.tool('aimeat_workspace_update', descriptionFor('aimeat_workspace_update'),
        {
            organism_id: z.string(),
            ws: z.string(),
            name: z.string().optional().describe('New workspace name (synced to the manifest + the registry)'),
            readme: z.string().optional().describe('New markdown readme/intro (replaces the current one)'),
            add_spaces: z.any().optional().describe('ADDITIVE (safe): an ARRAY of objectTypes to UNION into the manifest — the server keeps everything else and skips any whose name/namespace already exists. Pass just { name, namespace, mode } (+ a schema in `schemas`); defaults are filled. Use this to provision spaces instead of sending the whole manifest. Cannot remove/rename — use `manifest` for that.'),
            manifest: z.any().optional().describe('FULL replacement manifest (objectTypes + policy/gate + settings) as a JSON OBJECT. For genuine restructuring (rename/remove a space, change policy.alwaysGate). Read the workspace first; the id is preserved. To only ADD spaces, prefer `add_spaces`.'),
            schemas: z.any().optional().describe('Map of namespace → JSON Schema (object) to lock (strict) for a records space.'),
            apps: z.any().optional().describe('FULL replacement list of apps pinned to this workspace ([] clears). ARRAY of { owner, filename, label? } referencing published apps (/v1/apps). Pinning is launch-context/presentation only — workspace data access stays gated per call. Creator/admin only.'),
        },
        annotationsFor('aimeat_workspace_update'),
        async ({ organism_id, ws, name, readme, add_spaces, manifest, schemas, apps }): Promise<TextResult> => {
            const role = await roleOf(organism_id);
            if (!role) return fail('You are not a member of this organism.');
            try {
                const addParsed = parseObj(add_spaces);
                const appsParsed = parseObj(apps);
                const result = await updateWorkspaceMeta(storage, config, {
                    orgId: organism_id, ws, callerOwner: ownerName,
                    isAdmin: role === 'admin' || role === 'creator', name, readme,
                    addObjectTypes: Array.isArray(addParsed) ? addParsed as Array<Record<string, unknown>> : undefined,
                    manifest: parseObj(manifest) as Record<string, unknown> | undefined,
                    schemas: parseObj(schemas) as Record<string, Record<string, unknown>> | undefined,
                    apps: Array.isArray(appsParsed) ? appsParsed as Array<Record<string, unknown>> : undefined,
                });
                emitChange('organisms');
                void updateOrganismStructure(storage, config, organism_id, { event: 'workspace updated', actor: writerGaii }).catch(() => { /* timeline best-effort */ });
                return ok(result);
            } catch (e) {
                if (e instanceof WorkspaceMetaError) return fail(e.message);
                return fail((e as Error).message || 'Update failed');
            }
        });

    // ── aimeat_workspace_object_delete ──
    mcp.tool('aimeat_workspace_object_delete', descriptionFor('aimeat_workspace_object_delete'),
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
        annotationsFor('aimeat_workspace_object_delete'),
        async ({ organism_id, ws, namespace, id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const root = wsRoot(organism_id, ws);
            const base = `${root}.${namespace}.${id}`;
            // TARGET-009 S1/S3: an append-only namespace (manifest create_only) refuses record
            // deletion on every path — existing events can never be erased.
            const delGuard = await checkDeleteGuard(`${base}.latest`, storage);
            if (!delGuard.valid) return fail('Delete refused: ' + (delGuard.errors?.[0]?.message ?? 'append-only namespace'));
            // List the WHOLE instance: the bare key `${base}` (an un-suffixed write — which
            // workspace_read surfaces as the current value) AND every role-suffixed key
            // (`.latest` / `.draft` / `.version.N`). Prefix `${base}` (no trailing dot) catches the
            // bare key too; the per-row guard then excludes sibling instances like `${base}0` /
            // `${base}-x` so we only ever touch this exact id. (Earlier this listed `${base}.` only,
            // so a bare-key object survived delete yet kept showing in workspace_read.)
            const { items } = await storage.listAllMemory({ prefix: base, limit: 5000 });
            let deleted = 0;
            for (const r of items) {
                if (r.key !== base && !r.key.startsWith(`${base}.`)) continue;  // exclude sibling ids
                // Own + same-owner records (a sibling agent's writes) are deletable; cross-owner are not.
                if (r.ownerGaii !== ownerGhii && !isSameOwner(r.ownerGaii, ownerGhii)) continue;
                const role = r.key === base ? '' : r.key.slice(base.length + 1);   // '' = bare
                if (role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role)) {
                    if (await storage.deleteMemory(r.ownerGaii, r.key)) deleted++;
                }
            }
            if (deleted === 0) return fail(`Nothing to delete at ${base} (no record/draft/latest/version).`);
            // Best-effort: unfile the id from the document section tree (find the type by namespace).
            const man = await readManifest(organism_id, ws);
            const ot = (man?.objectTypes ?? []).find(o => o.namespace === namespace);
            if (ot) {
                const secKey = `${root}.meta.sections.${ot.name}`;
                const secRec = await storage.getMemory(ownerGhii, secKey);
                const sections = (secRec?.value as { sections?: { documents?: string[] }[] } | undefined)?.sections;
                if (sections) {
                    let changed = false;
                    for (const s of sections) {
                        if ((s.documents ?? []).includes(id)) { s.documents = (s.documents ?? []).filter(d => d !== id); changed = true; }
                    }
                    if (changed) await writeRecord(secKey, { sections }, secRec, ownerGhii);  // section tree = creator meta
                }
            }
            emitChange('organisms');
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
            // Gate: reject unsupported backings + infer mode from kind BEFORE anything is written,
            // so a misdeclared space fails the very first call instead of becoming invisible data.
            try {
                man.objectTypes = normalizeObjectTypes(man.objectTypes as Array<Record<string, unknown>>) as ObjType[];
            } catch (e) {
                if (e instanceof WorkspaceMetaError) return fail(e.message);
                throw e;
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
            await writeRecord(mkey, manifestValue, null, ownerGhii);          // manifest = creator meta
            // 3. Readme.
            const summary = (man as Record<string, unknown>).summary;
            await writeRecord(`${root}.meta.readme`, readme || `# ${String(man.name || name)}\n\n${typeof summary === 'string' ? summary : ''}`, null, ownerGhii);
            // 4. Register in the workspace registry.
            const regKey = `organism.${organism_id}.meta.workspaces`;
            const regRec = await storage.getMemory(ownerGhii, regKey);
            const workspaces = ((regRec?.value as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [];
            await writeRecord(regKey, { workspaces: [...workspaces, { id: wsId, name: String(name || 'Workspace').trim() || 'Workspace', createdAt: now, createdBy: ownerName }] }, regRec, ownerGhii);
            emitChange('organisms');
            void updateOrganismStructure(storage, config, organism_id, { event: 'workspace created', actor: writerGaii }).catch(() => { /* timeline best-effort */ });
            return ok({ created: true, ws: wsId, types: man.objectTypes.map(o => o.name), schemas_locked: Object.keys(schemaMap) });
        });

    // ── aimeat_workspace_request_access ──
    mcp.tool('aimeat_workspace_access', descriptionFor('aimeat_workspace_access'),
        {
            organism_id: z.string(), ws: z.string(),
            action: z.enum(['request', 'list', 'decide']).describe("'request' = ask the creator for access · 'list' = (creator/admin) see pending requests · 'decide' = (creator/admin) approve/deny one"),
            message: z.string().optional().describe("action='request': a note to the creator"),
            requester: z.string().optional().describe("action='decide': the requester's owner name"),
            decision: z.string().optional().describe("action='decide': 'approve' (default) or 'deny'"),
        },
        annotationsFor('aimeat_workspace_access'),
        async ({ organism_id, ws, action, message, requester, decision }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const entry = await findWsEntry(organism_id, ws);
            if (!entry) return fail('Workspace not found');
            const isManager = async () => { const role = await roleOf(organism_id); return entry.createdBy === ownerName || role === 'creator' || role === 'admin'; };

            if (action === 'request') {
                if (entry.createdBy === ownerName) return fail('You created this workspace.');
                await writeRecord(`organism.${organism_id}.w.${ws}.access.request.${ownerName}`, { ws, requester: ownerName, requester_gaii: ownerGhii, message: message ?? '', status: 'pending', createdAt: new Date().toISOString() }, null, ownerGhii);
                await ensureConsent(ownerGhii, `organism.${organism_id}.w.${ws}.**`, `organism.${organism_id}`, 'workspace-contribution');
                emitChange('organisms');
                return ok({ status: 'requested', ws, workspace_creator: entry.createdBy });
            }
            if (action === 'list') {
                if (!(await isManager())) return fail('Only the workspace creator or an org admin can see access requests.');
                const creatorGhii = `${entry.createdBy}@${config.nodeId}`;
                const roleByOwner = new Map<string, 'viewer' | 'contributor'>();
                for (const c of await storage.listConsents(creatorGhii, { status: 'active' })) {
                    if (c.dataPattern !== `organism.${organism_id}.w.${ws}.**` || !WS_ROLE_PURPOSES.includes(c.purpose)) continue;
                    const o = c.recipient.replace(/^ghii:/, '').split('@')[0];
                    if (c.purpose === 'workspace-contributor') roleByOwner.set(o, 'contributor');
                    else if (!roleByOwner.has(o)) roleByOwner.set(o, 'viewer');
                }
                const { items } = await storage.listAllMemory({ prefix: `organism.${organism_id}.w.${ws}.access.request.`, limit: 1000 });
                const requests = items.map(r => {
                    const v = r.value as { requester?: string; message?: string; createdAt?: string };
                    const req = v.requester ?? bareOwner(r.ownerGaii);
                    return { requester: req, message: v.message ?? '', created_at: v.createdAt, status: roleByOwner.has(req) ? 'approved' : 'pending', role: roleByOwner.get(req) ?? null };
                });
                const members = [...roleByOwner.entries()].map(([owner, role]) => ({ owner, role }));
                return ok({ ws, requests, members });
            }
            if (action === 'decide') {
                if (!requester) return fail("action='decide' needs a requester.");
                if (!(await isManager())) return fail('Only the workspace creator or an org admin can decide access.');
                // Grants are owned by the workspace CREATOR (so reads resolve via the content owner).
                const creatorGhii = `${entry.createdBy}@${config.nodeId}`;
                if (decision === 'deny') {
                    await revokeWsRole(creatorGhii, organism_id, ws, requester);
                    emitChange('organisms');
                    return ok({ status: 'denied', ws, requester });
                }
                const role = decision === 'viewer' ? 'viewer' : 'contributor';   // approve|contributor → contributor
                await setWsRole(creatorGhii, organism_id, ws, requester, role);
                emitChange('organisms');
                return ok({ status: 'approved', ws, requester, role });
            }
            return fail("action must be 'request', 'list' or 'decide'.");
        });

    // ── aimeat_workspace_export ──
    mcp.tool('aimeat_workspace_transfer', descriptionFor('aimeat_workspace_transfer'),
        {
            organism_id: z.string(),
            direction: z.enum(['export', 'import']).describe("'export' a workspace to a base64 ZIP, or 'import' a base64 ZIP as a NEW workspace"),
            ws: z.string().optional().describe("direction='export': the workspace id to export"),
            zip_base64: z.string().optional().describe("direction='import': the base64 ZIP from a prior export"),
        },
        annotationsFor('aimeat_workspace_transfer'),
        async ({ organism_id, direction, ws, zip_base64 }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            if (direction === 'export') {
                if (!ws) return fail("direction='export' needs a ws.");
                const entry = await findWsEntry(organism_id, ws);
                if (!entry) return fail('Workspace not found');
                const role = await roleOf(organism_id);
                if (entry.createdBy !== ownerName && role !== 'creator' && role !== 'admin') return fail('Only the workspace creator or an org admin can export.');
                const { buffer, filename } = await exportWorkspace(storage, config, { orgId: organism_id, ws, exporterGaii: ownerGhii, exportedAt: new Date().toISOString() });
                if (buffer.length > 1_500_000) return fail(`Workspace too large for inline export (${buffer.length} bytes) — download it from the UI/REST instead.`);
                return ok({ filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') });
            }
            if (direction === 'import') {
                if (!zip_base64) return fail("direction='import' needs zip_base64.");
                const buf = Buffer.from(zip_base64, 'base64');
                if (!buf.length) return fail('zip_base64 is empty or invalid.');
                try {
                    const result = await importWorkspace(storage, config, { orgId: organism_id, importerGaii: ownerGhii, importerOwner: ownerName, zip: buf });
                    emitChange('organisms');
                    return ok(result);
                } catch (e) {
                    if (e instanceof ZipSecurityError) {
                        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: ownerGhii, actorName: ownerName, detail: e.message, source: 'workspace_transfer_mcp', blob: buf });
                        return fail(`Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`);
                    }
                    return fail((e as Error).message || 'Import failed');
                }
            }
            return fail("direction must be 'export' or 'import'.");
        });
}
