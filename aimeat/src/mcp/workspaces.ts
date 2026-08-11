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
 *   - _access (request/list/decide) + _member_grant / _member_revoke / _members (creator-managed roles)
 * @usage import { registerWorkspaceTools } from './workspaces.js';
 * @version-history
 *   v1.18.0 -- 2026-08-01 -- TARGET-058 Phase 4. aimeat_workspace_write accepts an `ai_provenance`
 *     declaration and stamps EVERY item through provenanceForWrite() (a batch of twenty records is
 *     twenty sets of bytes); aimeat_workspace_read returns the record on the batch-open branch; and
 *     aimeat_workspace_publish carries the draft's record onto `.version.N` + `.latest`. Two real
 *     losses closed: this tool wrote straight to storage, so agent-written workspace records carried
 *     no provenance at all, and publishing then produced a `.latest` — the copy the read serves and
 *     the label renders from — with none either. Two tools moved out by pure extraction to stay under
 *     max-file-lines: aimeat_workspace_access joins workspace-members.ts (it is the request half of
 *     the same membership concern) and aimeat_workspace_transfer gets workspace-transfer.ts.
 *   v1.15.0 -- 2026-07-11 -- TARGET-028: aimeat_workspace_member_grant/_revoke/_members (proactively add
 *     an existing GHII/GAII member to one or MANY workspaces as viewer|contributor, with revoke/downgrade
 *     and a members listing that shows role + grant source); _access decide gains an explicit `role`.
 *     Role logic now delegates to services/workspace-roles.ts (shared with the REST routes — unified IAM).
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
 *   v1.16.0 -- 2026-07-16 -- Version-bloat perf: _read/_revert scans exclude `.version.N` rows in SQL
 *     (they were loaded with full values then discarded), _publish computes maxN value-free and
 *     prunes history beyond the retention window (services/workspace-versions; append-only spaces
 *     are never pruned).
 *   v1.18.0 -- 2026-07-31 -- _write takes `items: [...]` (up to 50) and writes them in ONE call, so a
 *     migration costs one client approval prompt instead of one per document (an unanswered prompt
 *     left migrations half-done). All-or-nothing: every item is resolved + schema-validated before
 *     anything is written, because an id-less document gets a generated id and a retried half-batch
 *     would duplicate. Shared normalisation in services/workspace-write-items.ts (all three surfaces).
 *   v1.17.0 -- 2026-07-25 -- _create backfills the whole manifest envelope (manifestVersion/id/name/
 *     kind/status) via the shared backfillManifestEnvelope() instead of only id+status — so a create
 *     supplying just objectTypes validates on the first call (the missing manifestVersion default was
 *     the recurring "workspace create stumbles at the start" cause). The top-level `name` param now
 *     backfills manifest.name too.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { canWriteNamespaceRule, readOrganismConfig } from '../routes/organisms/shared.js';
import { registerWorkspaceCreateTool } from './workspace-create.js';
import { archivedRefusal, checkWorkspaceWriteLimits } from '../services/workspace-write-guards.js';
import { parseGAII, isSameOwner } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { checkDeleteGuard } from '../services/write-guards.js';
import { authorizeRead } from '../services/access-guard.js';
import { buildOrganismOverview, buildWorkspaceOverview, entryTitle } from '../services/structure-overview.js';
import { updateWorkspaceMeta, WorkspaceMetaError, isMemoryBackedSpace, listOrganismWorkspaceEntries } from '../services/workspace-meta.js';
import { emitChange, emitMemoryWritten } from '../services/event-bus.js';
import { updateOrganismStructure } from '../services/structure-snapshot.js';
import { normalizeDocValueImages } from '../services/doc-images.js';
import { normalizeWriteItems, resolveWriteItem, MAX_BATCH_ITEMS, type ResolvedWriteItem } from '../services/workspace-write-items.js';
import { grantWorkspaceRole, revokeWorkspaceRole as revokeWsRoleSvc, type WsRole } from '../services/workspace-roles.js';
import { listVersionRefs, maxVersionOf, pruneVersionsAfterPublish } from '../services/workspace-versions.js';
import { registerWorkspaceMemberTools } from './workspace-members.js';
import { registerWorkspaceTransferTool } from './workspace-transfer.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import { provenanceForWrite } from '../services/ai-provenance.js';
import { memoryContentBytes } from '../routes/memory/shared.js';
import { logger } from '../utils/logger.js';

type ObjType = { name: string; namespace?: string; backing?: string; mode?: string; kind?: string; versioned?: boolean; create_only?: boolean; maxVersions?: number };
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
        // eslint-disable-next-line aimeat/no-silent-catch -- leave as string → schema rejects clearly
        if (typeof v === 'string') { try { const p = JSON.parse(v); if (p && typeof p === 'object') v = p; } catch { /* leave as string → schema rejects clearly */ } }
        return (v && typeof v === 'object' && !Array.isArray(v)) ? { ...(v as Record<string, unknown>), id } : v;
    };

    /** Parse a possibly-JSON-stringified object param (manifest / schemas) back to an object. */
    const parseObj = (v: unknown): unknown => {
        // eslint-disable-next-line aimeat/no-silent-catch -- leave as-is
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

    /**
     * The caller's role in an organism, for the meta.* rule. denyReason answers "may they be here at
     * all"; this answers "may they change the structure", and the two are different questions —
     * publishing over the manifest or the config is not the same act as writing a document.
     *
     * An organism AGENT (org.agentGaiis) acts for the organism itself and is treated as a member;
     * it does not inherit creator or admin, so it cannot publish into meta.* either.
     */
    async function memberRoleOf(orgId: string): Promise<'creator' | 'admin' | 'member' | null> {
        const m = await storage.getMembership(orgId, ownerName);
        if (m && m.status === 'active') return m.role;
        const org = await storage.getOrganism(orgId);
        return org?.agentGaiis?.includes(agentGaii) ? 'member' : null;
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
            .map(r => storage.deleteMemory(r.ownerGaii, r.key).catch(err => { logger.warn('collapseTo: best-effort collapse', { error: String(err) }); })));
    };
    /** Write workspace CONTENT under the member's GHII — ONE owner per key, so a record never forks into
     *  per-agent duplicates that the read path then has to disambiguate. Author/attribution is preserved
     *  on the immutable `.version.N` records (writerGaii) and the activity timeline, so collapsing the
     *  current-state owner onto the GHII costs no attribution. `owner` is overridable only for META that
     *  must stay under a specific identity. A legacy copy under a different identity is collapsed away. */
    const writeRecord = async (
        key: string, value: unknown, prev: MemoryRecord | null, owner: string = ownerGhii,
        aiProvenanceId?: string,
    ): Promise<void> => {
        const now = new Date().toISOString();
        await storage.setMemory({
            key, ownerGaii: owner, value, visibility: prev?.visibility ?? 'private', tags: prev?.tags ?? [], ttlHours: null,
            // TARGET-058. Attached, never inherited from `prev`: a new value is new content, so
            // carrying the previous record's id forward would leave a statement standing about bytes
            // it was never about. Passed only for CONTENT writes — the section index and the other
            // meta writes below make no claim about authorship, so they carry no statement either.
            ...(aiProvenanceId ? { aiProvenanceId } : {}),
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
    // ── Workspace member roles: viewer = read, contributor = read+write, as a consent the workspace
    //    CREATOR owns on organism.{id}.w.{ws}.**. Delegates to the ONE shared service so the MCP tools,
    //    the REST routes, and the invite-accept path share a single authority path (no ad-hoc fork). ──
    const setWsRole = (creatorGhii: string, orgId: string, ws: string, grantee: string, role: WsRole, source: 'grant' | 'request', grantedBy: string) =>
        grantWorkspaceRole(storage, config, { creatorGhii, orgId, ws, grantee, role, source, grantedBy });
    const revokeWsRole = (creatorGhii: string, orgId: string, ws: string, grantee: string) =>
        revokeWsRoleSvc(storage, config, { creatorGhii, orgId, ws, grantee });
    /** Whether the caller may MANAGE access to a workspace (its creator, or an org admin/creator).
     *  Returns the workspace CREATOR's owner name (grants are owned by the creator), or null if denied. */
    const wsManager = async (orgId: string, ws: string): Promise<{ createdBy: string } | null> => {
        const entry = await findWsEntry(orgId, ws);
        if (!entry) return null;
        const role = await roleOf(orgId);
        if (entry.createdBy === ownerName || role === 'creator' || role === 'admin') return { createdBy: entry.createdBy };
        return null;
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
            // excludeVersionRows: this read never surfaces `.version.N` history — dropping those rows in
            // SQL avoids loading every historic full-copy value only to discard it below.
            const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 5000, archived: include_archived ? 'include' : undefined, excludeVersionRows: true });
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
                // TARGET-058: the provenance for everything this call is about to return, in ONE
                // query. Deliberately only on the batch-open branch — the index is titles, and an
                // agent that needs to know how something was made is opening it anyway. Attaching a
                // second, thinner shape of the same fact to every index row is how one document ends
                // up with two spellings.
                const provFor = await readProvenanceMany(storage, config, items.map(r => r.aiProvenanceId));
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
                            ...provFor(cur.aiProvenanceId),
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
            space: z.string().optional().describe("The objectType (space) NAME — e.g. 'feedback' or 'task' (the manifest's objectTypes[].name, NOT its namespace like 'shared.feedback'). The tool resolves whether it is a records or document space. With `items`, this is the default each item inherits."),
            // z.any(): some clients JSON-stringify an object param — coerceValue parses it back so records
            // validate and documents aren't stored corrupt. (A z.record/union here breaks the MCP SDK.)
            value: z.any().optional().describe('The content as a JSON OBJECT (not a string). For a records space, the record (matching its schema). For a document space, { title, markdown }. Omit when using `items`.'),
            id: z.string().optional().describe('Instance id. Required for a records space (or include id in value); auto-generated for a document.'),
            section: z.string().optional().describe('Document spaces only: section id/name to file the document under.'),
            items: z.any().optional().describe(`BATCH: an ARRAY of { value, space?, id?, section? } — up to ${MAX_BATCH_ITEMS} — written in ONE call. Each item inherits the top-level space/section unless it names its own. Use this for a migration: your client asks the human to approve every tool CALL, so twenty separate writes are twenty prompts and one missed prompt ends the job half-done. All-or-nothing: every item is checked first, and a single bad item writes nothing.`),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_workspace_write'),
        async ({ organism_id, ws, space, value, id, section, items, ai_provenance, ai_provenance_id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            if (!(await canWriteWs(organism_id, ws))) return fail('You are not approved to write to this workspace. Request access with aimeat_workspace_access(action:"request") and wait for the creator to approve.');
            const norm = normalizeWriteItems({ space, value, id, section, items });
            if ('error' in norm) return fail(norm.error);
            const batch = items !== undefined && items !== null;
            const root = wsRoot(organism_id, ws);
            // Aggregate the manifest across members so a member who didn't create the workspace can write,
            // and accept either the space NAME or its namespace (small models often pass the namespace).
            const types = (await readManifest(organism_id, ws))?.objectTypes ?? [];
            // Resolve and validate EVERY item before writing ANY of them. A document with no id gets a
            // generated one, so a batch that half-lands and is then retried would duplicate what landed.
            const planned: { key: string; v: unknown; item: ResolvedWriteItem }[] = [];
            for (const [i, want] of norm.items.entries()) {
                const item = resolveWriteItem(want, types, batch ? `items[${i}]` : undefined);
                if ('error' in item) return fail(item.error);
                const key = `${root}.${item.namespace}.${item.instanceId}.draft`;
                let v = coerceValue(item.value, item.instanceId);
                // Rewrite embedded image URLs to the owner-addressed /v1/pub form and scope those files to
                // THIS workspace (members-only). MCP-authored docs otherwise store raw /v1/storage URLs that
                // load for nobody but the file owner — the exact reason chat-written docs showed broken images.
                if (item.isDoc) v = await normalizeDocValueImages(storage, config, v, ownerName, `${organism_id}/${ws}`);
                const valid = await validateMemoryWrite(key, v, storage);
                if (!valid.valid) return fail(`${batch ? `items[${i}]: ` : ''}Draft rejected by schema: ` + JSON.stringify(valid.errors));
                planned.push({ key, v, item });
            }
            // Archived is read-only. This path had no check, so an agent kept filing drafts into a
            // workspace the owner had closed, and the view then showed fresh material in something
            // marked finished.
            const wsArchived = await archivedRefusal(storage, `${root}.`);
            if (wsArchived) return fail(wsArchived);
            // And the RECORD's own archive flag, which is a separate fact from the workspace's:
            // "this document is finished" was honoured by /v1/memory and not by a draft written here.
            for (const [i, p] of planned.entries()) {
                const rowArchived = await archivedRefusal(storage, `${root}.`, { ownerGhii, key: p.key });
                if (rowArchived) return fail(`${batch ? `items[${i}]: ` : ''}${rowArchived}`);
            }

            const overLimit = await checkWorkspaceWriteLimits(
                storage, config, ownerGhii, planned, i => (batch ? `items[${i}]: ` : ''),
            );
            if (overLimit) return fail(overLimit);
            const written: Record<string, unknown>[] = [];
            let lastProvenanceId: string | undefined;
            for (const { key, v, item } of planned) {
                // TARGET-058. A workspace record is a memory record, but this tool writes straight to
                // storage rather than through /v1/memory, so it inherited nothing: an agent's
                // workspace write carried no provenance at all. It goes through the same one decision
                // function every other write surface uses. Per ITEM, not per call — a batch of twenty
                // records is twenty different sets of bytes, and one record covering all of them
                // would be a statement about content it cannot identify.
                const provenanceId = await provenanceForWrite(storage, {
                    principal: agentGaii,
                    content: memoryContentBytes(v),
                    declaredId: ai_provenance_id,
                    declared: toDeclaredProvenance(ai_provenance),
                    pipeline: 'mcp.workspace_write',
                    // A draft lands private; publishing is what makes it readable, and the publish
                    // path re-derives the label from the record then.
                    surface: { visibility: 'private', humanAudience: true },
                    labelPolicy: config.aiLabelPublic,
                    nodeId: config.nodeId,
                    baseUrl: config.baseUrl,
                    enabled: config.aiProvenance,
                });
                lastProvenanceId = provenanceId ?? lastProvenanceId;
                await writeRecord(key, v, await findByKey(key), ownerGhii, provenanceId);   // content → authored by the calling agent
                if (item.isDoc && item.section) {
                    const secKey = `${root}.meta.sections.${item.space}`;
                    const secRec = await findByKey(secKey);
                    const sections = ((secRec?.value as { sections?: { id: string; name?: string; documents?: string[] }[] } | undefined)?.sections) ?? [];
                    const target = sections.find(s => s.id === item.section || s.name === item.section);
                    if (target) { target.documents = [...(target.documents ?? []).filter(d => d !== item.instanceId), item.instanceId]; await writeRecord(secKey, { sections }, secRec, ownerGhii); }  // section tree = creator meta
                }
                written.push({ written: key, id: item.instanceId, space: item.space, mode: item.isDoc ? 'document' : 'records', section: item.section ?? null });
            }
            emitChange('organisms');
            // The echo is the LAST item's record on a batch: every item was stamped, and repeating
            // twenty near-identical documents in a tool result would cost the agent more context than
            // the fact is worth. The per-record ids are on the records themselves.
            const echo = await writeProvenanceEcho(storage, config, lastProvenanceId);
            return ok(batch
                ? { count: written.length, items: written, ...echo }
                : { ...written[0], ...echo });
        });

    // ── aimeat_workspace_publish ──
    mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
        // expected_version: the publisher's optimistic lock — REQUIRED by namespaces whose manifest
        // sets requires_expected_version (TARGET-009 S1); pass the version you read.
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string(), expected_version: z.number().optional() },
        annotationsFor('aimeat_workspace_publish'),
        async ({ organism_id, ws, namespace, id, expected_version }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const role = await memberRoleOf(organism_id);
            if (!role || !canWriteNamespaceRule(role, namespace)) {
                return fail('Admin/creator role required to publish in a meta.* namespace');
            }
            const archived = await archivedRefusal(storage, `${wsRoot(organism_id, ws)}.`);
            if (archived) return fail(archived);
            // Read across every owner, as routes/organisms/shared.ts does. The config normally
            // belongs to the organism's creator, so the per-owner read this used to do returned
            // nothing for any OTHER member — the gate read as absent and the publish went through.
            const cfg = await readOrganismConfig(storage, organism_id);
            const gate = (cfg as { gates?: { publish?: { enabled?: boolean } } } | null)?.gates?.publish?.enabled;
            if (gate) return fail('Publishing requires human approval (the publish gate is on). Leave it as a draft for the owner to review and publish.');
            const base = `${wsRoot(organism_id, ws)}.${namespace}.${id}`;
            // Value-free version handling: the scan skips `.version.N` rows (their full values were
            // loaded just to find maxN); the version numbers come from the key names alone below.
            const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000, excludeVersionRows: true });
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
            const versionRefs = await listVersionRefs(storage, base);
            const maxN = maxVersionOf(versionRefs);
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
            // TARGET-058. Publishing MOVES the content, so the statement about how it was made moves
            // with it. Without this the draft carried a record and `.latest` — the copy the workspace
            // read serves and the visible label renders from — carried none, so publishing was where
            // an agent-written record quietly became origin-unstated. Carried rather than re-minted:
            // the record says how the content was MADE, and publishing does not change that. Same
            // caveat as the REST path in routes/organisms/shared.ts — an image-URL rewrite above can
            // leave the record's contentHash describing the draft bytes rather than the published ones.
            const provenanceId = draft.aiProvenanceId ?? undefined;
            // Attribution: the immutable .version.N snapshot is authored by the PUBLISHER (writerGaii).
            // The .latest pointer (current state) is owned by a member's GHII — ONE owner per key, so it
            // never forks into per-agent duplicates that a read then has to disambiguate. Preserve the
            // record's existing owner (normalised to their GHII — never a raw agent GAII); a brand-new
            // record is owned by the caller's GHII. collapseTo removes any copy left under another identity.
            const latestOwner = existingLatest ? `${bareOwner(existingLatest.ownerGaii)}@${config.nodeId}` : ownerGhii;
            if (versioned) {
                await storage.setMemory({ key: `${base}.version.${n}`, ownerGaii: writerGaii, value: draftValue, ...(provenanceId ? { aiProvenanceId: provenanceId } : {}), visibility: draft.visibility, tags, ttlHours: null, version: 1, createdAt: now, updatedAt: now });
                // Retention: prune history beyond the space's window (append-only spaces never pruned).
                await pruneVersionsAfterPublish(storage, config, { refs: versionRefs, publishedN: n, ot: publishOt });
            }
            await storage.setMemory({ key: `${base}.latest`, ownerGaii: latestOwner, value: draftValue, ...(provenanceId ? { aiProvenanceId: provenanceId } : {}), visibility: draft.visibility, tags, ttlHours: null, version: (existingLatest?.version ?? 0) + 1, createdAt: existingLatest?.createdAt ?? now, updatedAt: now });
            await collapseTo(`${base}.latest`, latestOwner);
            await storage.deleteMemory(draft.ownerGaii, `${base}.draft`);
            emitChange('organisms');
            // Memory Contracts (reactive): publishing a watched record (e.g. a bug → status:done)
            // fires Tracked Response evaluation. Gated O(1) on the track-registry in the subscriber.
            emitMemoryWritten(latestOwner, `${base}.latest`);
            void updateOrganismStructure(storage, config, organism_id, { event: 'content published', actor: writerGaii }).catch(err => { logger.warn('publishOt: timeline best-effort', { error: String(err) }); });
            return ok({ published: base, version: n });
        });

    // ── aimeat_workspace_revert_to_draft ──
    mcp.tool('aimeat_workspace_revert_to_draft', descriptionFor('aimeat_workspace_revert_to_draft'),
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string() },
        annotationsFor('aimeat_workspace_revert_to_draft'),
        async ({ organism_id, ws, namespace, id }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const revertRole = await memberRoleOf(organism_id);
            if (!revertRole || !canWriteNamespaceRule(revertRole, namespace)) {
                return fail('Admin/creator role required to reopen a meta.* record');
            }
            const base = `${wsRoot(organism_id, ws)}.${namespace}.${id}`;
            // Reopening needs only .draft/.latest/bare — never the `.version.N` history values.
            const { items } = await storage.listAllMemory({ prefix: `${base}.`, limit: 2000, excludeVersionRows: true });
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
            // Archived is read-only, and structure is exactly what it protects. The web door has
            // refused a rename, a manifest replacement, a new space or a repinned app inside an
            // archived organism since the archive shipped; this tool checked nothing, so the owner's
            // "this is finished" held on one surface.
            const archived = await archivedRefusal(storage, `organism.${organism_id}.w.${ws}.`);
            if (archived) return fail(archived);
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
                void updateOrganismStructure(storage, config, organism_id, { event: 'workspace updated', actor: writerGaii }).catch(err => { logger.warn('async: timeline best-effort', { error: String(err) }); });
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
    // Extracted to workspace-create.ts (max-file-lines); registered here to preserve tool order.
    registerWorkspaceCreateTool(mcp, storage, config, { ownerName, ownerGhii, writerGaii, ok, fail,
        denyReason, parseObj, wsRoot, writeRecord });

    // ── aimeat_workspace_access + the member-role tools (member_grant, member_revoke, members) ──
    // Extracted to workspace-members.ts — access is the REQUEST half of the same membership
    // concern the grant tools serve. Registered here to preserve tool order.

    registerWorkspaceMemberTools(mcp, storage, config, { ownerName, ownerGhii, ok, fail, denyReason,
        wsManager, setWsRole, revokeWsRole, findWsEntry, roleOf, writeRecord, ensureConsent, bareOwner });

    // ── aimeat_workspace_transfer ── (workspace export/import as a base64 ZIP)
    // Extracted to workspace-transfer.ts; registered here to preserve tool order.
    registerWorkspaceTransferTool(mcp, storage, config, { ownerName, ownerGhii, ok, fail, denyReason, findWsEntry, roleOf });
}
