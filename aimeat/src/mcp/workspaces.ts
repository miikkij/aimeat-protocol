/**
 * @file workspaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.22.0 -- 2026-09-05 -- The bodies of _read, _write and _publish move to
 *     services/workspace-tool-ops.ts, a pure extraction, so the extension sandbox's ctx.workspace
 *     runs the same three operations as its caller instead of a fourth copy of who may write a
 *     workspace record. The tools render the same messages they always did.
 *   v1.21.0 -- 2026-09-03 -- The index read returns `schemas`, the locked JSON Schemas keyed by
 *     namespace, in the shape _update takes back. An agent could replace a workspace's schemas but
 *     had no way to read them: _update's own advice was GET /v1/memory/{key}/schema, a call an
 *     MCP-only client cannot make, so the safe read-edit-write round-trip was impossible and an
 *     update dropped whatever the previous schema said. Index only: the batch-open branch is about
 *     one record's content. Same field on the REST read and the connector door.
 *   v1.20.0 -- 2026-08-26 -- Workspace ROW spaces. The index read reports a row space as a COUNT and
 *     a span rather than as rows, which is the property the whole backing exists for: this read
 *     materialises every memory value to derive a title and truncates at 5000 with no signal, so a
 *     space holding a group's accumulated rows would be both expensive and quietly incomplete here.
 *     The four row TOOLS are ./workspace-rows.ts — a pure extraction at the max-file-lines boundary,
 *     calling the same service the REST routes call.
 *   v1.19.0 -- 2026-08-11 -- August 2026 audit step 8: the WRITE moves out. _publish and
 *     _revert_to_draft call the same publishDraft / revertToDraft that POST /v1/organisms/:id/publish
 *     and /revert call, so the copy that refused a co-member's draft, wrote no decision-log entry and
 *     counted no activation is gone. The record write, the fork collapse and the instance delete are
 *     services/workspace-write.ts, which also runs the fan-out a workspace write always set off from
 *     the web door and never from here: Tracked Response, event-triggered workflows, ecosystem push,
 *     automation recipes, federation replication and emitChange('memory'). _object_delete resolves
 *     the section tree across owners (reading it under the caller found nothing whenever the tree
 *     belonged to the workspace creator, so the unfile did nothing) and records a timeline snapshot.
 *     The idempotent consent grant is the helpers' ensureConsent. Nothing in this file writes to
 *     storage any more.
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
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { canWriteNamespaceRule, createOrganismHelpers } from '../routes/organisms/shared.js';
import { registerWorkspaceCreateTool } from './workspace-create.js';
import { registerWorkspaceRowTools } from './workspace-rows.js';
import { registerWorkspaceDocumentTools } from './workspace-documents.js';
import { archivedRefusal } from '../services/workspace-write-guards.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { checkDeleteGuard } from '../services/write-guards.js';
import { canReadWorkspace } from '../services/workspace-access.js';
import { buildOrganismOverview, buildWorkspaceOverview } from '../services/structure-overview.js';
import { updateWorkspaceMeta, WorkspaceMetaError, listOrganismWorkspaceEntries } from '../services/workspace-meta.js';
import { emitChange } from '../services/event-bus.js';
import { updateOrganismStructure } from '../services/structure-snapshot.js';
import { MAX_BATCH_ITEMS } from '../services/workspace-write-items.js';
import { findWorkspaceRecord, writeWorkspaceRecord, deleteWorkspaceInstance } from '../services/workspace-write.js';
import { workspaceCallerOf, readWorkspaceOp, writeWorkspaceDraftsOp, publishWorkspaceOp } from '../services/workspace-tool-ops.js';
import { grantWorkspaceRole, revokeWorkspaceRole as revokeWsRoleSvc, type WsRole } from '../services/workspace-roles.js';
import { registerWorkspaceMemberTools } from './workspace-members.js';
import { registerWorkspaceTransferTool } from './workspace-transfer.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
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
    // The organism route helpers, built from the same factory routes/organisms/organisms.ts uses.
    // Publishing a draft, reopening one and appending the gate's decision entry are the SAME
    // operations POST /v1/organisms/:id/publish and /revert perform, and they are already written as
    // plain functions that take identities and return a result rather than an HTTP response — so
    // this door calls them and renders the answer as text, instead of carrying a second copy that
    // drifted apart on the audit trail, the draft owner and the cross-owner draft lookup.
    const H = createOrganismHelpers(config, storage);
    const agentGaii = getAgentGaii();
    const parsed = parseGAII(agentGaii);
    const ownerName = parsed ? parsed.owner : agentGaii;
    const ownerGhii = `${ownerName}@${config.nodeId}`;
    // The identity that AUTHORS content: an agent's own GAII when an agent is calling (so the activity
    // feed + participants attribute the work to the AGENT, not its owner — the MCP-serve path used to
    // write everything under ownerGhii, collapsing every agent action onto the owner), else the owner
    // GHII. Workspace META (manifest / registry / schemas / sections) stays under ownerGhii.
    const writerGaii = parsed ? agentGaii : ownerGhii;
    // The same caller, in the shape services/workspace-tool-ops.ts takes: the read, the draft
    // write and the publish run there, so the extension sandbox can run them as its caller too.
    // Roles stay ['agent'] — an MCP session is always an agent record (mcp/index.ts).
    const opsCaller = workspaceCallerOf({ principal: agentGaii, ownerName, roles: ['agent'] }, config);
    const wsRoot = (orgId: string, ws: string) => `organism.${orgId}.w.${ws}`;

    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });

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

    /** The freshest record at an EXACT key, whichever identity owns it — services/workspace-write.ts. */
    const findByKey = (key: string): Promise<MemoryRecord | null> => findWorkspaceRecord(storage, key);
    /** Write one workspace record: ONE owner per key, forked copies collapsed, and the fan-out every
     *  other write surface runs. The whole of it is services/workspace-write.ts; `owner` defaults to
     *  the member GHII and is named explicitly only for META that must stay under a given identity. */
    const writeRecord = (
        key: string, value: unknown, prev: MemoryRecord | null, owner: string = ownerGhii,
        aiProvenanceId?: string,
    ): Promise<void> => writeWorkspaceRecord({ storage, config },
        // `owner` is the namespace, `principal` is the hand. An agent writing a member's record is
        // both, and the write tally is what tells them apart.
        // The outcome is dropped on purpose: with no `ifVersion` the write cannot be refused, so
        // there is nothing here to check. The in-place document edits pass one and do check.
        { key, value, owner, prev, aiProvenanceId, principal: agentGaii }).then(() => undefined);

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
    /** Create a consent grant if no equivalent active one exists (idempotent) — the same function the
     *  workspace-access REST routes call, so the request half of membership has one implementation. */
    const ensureConsent = H.ensureConsent;
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
            // The work is services/workspace-tool-ops.ts, which the extension sandbox's
            // ctx.workspace calls as well: a workspace is SHARED, authorization is at the workspace
            // level (whoever may read the manifest sees all of its content), version history is
            // never surfaced, and row spaces answer with a count.
            const r = await readWorkspaceOp({ storage, config }, opsCaller, { organismId: organism_id, ws, ids, space, includeArchived: include_archived });
            return r.ok ? ok(r.data) : fail(r.message);
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
            // services/workspace-tool-ops.ts: membership, the organism namespace rule, every item
            // resolved and schema-validated before any is written, the archive flags, the memory
            // ceilings, one provenance record per item, and the fan-out a workspace write sets off.
            // The extension sandbox's ctx.workspace.write is the same function.
            const r = await writeWorkspaceDraftsOp({ storage, config }, opsCaller, {
                organismId: organism_id, ws, space, value, id, section, items,
                aiProvenance: toDeclaredProvenance(ai_provenance), aiProvenanceId: ai_provenance_id,
                pipeline: 'mcp.workspace_write',
            });
            return r.ok ? ok(r.data) : fail(r.message);
        });

    // ── aimeat_workspace_publish ──
    mcp.tool('aimeat_workspace_publish', descriptionFor('aimeat_workspace_publish'),
        // expected_version: the publisher's optimistic lock — REQUIRED by namespaces whose manifest
        // sets requires_expected_version (TARGET-009 S1); pass the version you read.
        { organism_id: z.string(), ws: z.string(), namespace: z.string(), id: z.string(), expected_version: z.number().optional() },
        annotationsFor('aimeat_workspace_publish'),
        async ({ organism_id, ws, namespace, id, expected_version }): Promise<TextResult> => {
            // services/workspace-tool-ops.ts: membership, the meta.* role, the archive flag, the
            // publish gate (read across every owner), then the same publishDraft POST
            // /v1/organisms/:id/publish calls, the decision-log entry and the timeline snapshot.
            const r = await publishWorkspaceOp({ storage, config }, opsCaller, { organismId: organism_id, ws, namespace, id, expectedVersion: expected_version ?? null });
            return r.ok ? ok(r.data) : fail(r.message);
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
            // Organism membership is not workspace access, and reverting COPIES the published
            // record's full value into a draft the caller then owns. Without this, an agent whose
            // owner holds no grant on this workspace reads its records one revert at a time, while
            // aimeat_workspace_read answers them "no access". Same gate as the REST door.
            const revertOrg = await storage.getOrganism(organism_id);
            if (!revertOrg || !(await canReadWorkspace(storage, config, revertOrg, agentGaii, ownerName, ownerGhii, ws))) {
                return fail(`No access to workspace ${ws} — request access with aimeat_workspace_access.`);
            }
            const base = `${wsRoot(organism_id, ws)}.${namespace}.${id}`;
            // The same revertToDraft POST /v1/organisms/:id/revert calls: copy `.latest` (or the bare
            // key) into `.draft` and refuse to clobber a draft already in progress. The reopened draft
            // is owned by the member GHII rather than the calling agent's GAII — one owner per key, as
            // every other current-state write in this file. The REST door passes its raw session
            // identity here, which is why a web-reopened draft can land under an agent GAII.
            const result = await H.revertToDraft(organism_id, ws, namespace, id, ownerGhii);
            if (!result.ok) {
                return fail(result.code === 'DRAFT_EXISTS'
                    ? `A draft already exists at ${base}.draft — edit it directly instead of reopening.`
                    : `No published record at ${base}.latest to reopen.`);
            }
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
            schemas: z.any().optional().describe('Map of namespace → JSON Schema (object) to lock (strict) for a records space. REPLACES the locked schema rather than merging into it, so read the current ones first: aimeat_workspace_read (the default index call) returns them as `schemas`, keyed by namespace, in exactly this shape — read, edit the one entry, send the map back. Do not invent a maxLength — the real ceiling is the memory value budget the node enforces on the whole record.'),
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
    // The four ROW-space tools live in ./workspace-rows.ts — a pure extraction at the
    // max-file-lines boundary. They call services/workspace-rows/row-service.ts, which is what
    // the REST routes call too, so neither door can answer differently from the other.
    registerWorkspaceRowTools(mcp, { storage, config, agentGaii, writerGaii, ownerName });
    // The two in-place DOCUMENT edits, extracted for the same reason and calling the same service
    // the REST routes call: services/workspace-doc-edit.ts.
    registerWorkspaceDocumentTools(mcp, { storage, config, agentGaii, ownerName });

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
            // The whole instance — the bare key plus `.draft` / `.latest` / every `.version.N`, own
            // and same-owner only — through services/workspace-write.ts, which is the predicate the
            // batched REST delete applies too.
            const deleted = await deleteWorkspaceInstance(storage, { base, callerGhii: ownerGhii });
            if (deleted === 0) return fail(`Nothing to delete at ${base} (no record/draft/latest/version).`);
            // Best-effort: unfile the id from the document section tree (find the type by namespace).
            const man = await readManifest(organism_id, ws);
            const ot = (man?.objectTypes ?? []).find(o => o.namespace === namespace);
            if (ot) {
                const secKey = `${root}.meta.sections.${ot.name}`;
                // Resolved across owners, as the write path resolves the same key. Reading it under
                // the caller's own GHII found nothing whenever the section tree belonged to the
                // workspace creator, so the tree kept the id and the delete was only half applied.
                const secRec = await findByKey(secKey);
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
            // The structure history records creates and publishes; without this it silently skipped an
            // agent's deletes, so a shrinking workspace had no recorded cause.
            void updateOrganismStructure(storage, config, organism_id, { event: `deleted record ${namespace}.${id}`, actor: writerGaii }).catch(err => { logger.warn('object_delete: timeline best-effort', { error: String(err) }); });
            return ok({ deleted: base, keys: deleted });
        });

    // ── aimeat_workspace_create ──
    // Extracted to workspace-create.ts (max-file-lines); registered here to preserve tool order.
    registerWorkspaceCreateTool(mcp, storage, config, { ownerName, ownerGhii, writerGaii, ok, fail,
        denyReason, parseObj });

    // ── aimeat_workspace_access + the member-role tools (member_grant, member_revoke, members) ──
    // Extracted to workspace-members.ts — access is the REQUEST half of the same membership
    // concern the grant tools serve. Registered here to preserve tool order.

    registerWorkspaceMemberTools(mcp, storage, config, { ownerName, ownerGhii, ok, fail, denyReason,
        wsManager, setWsRole, revokeWsRole, findWsEntry, roleOf, writeRecord, ensureConsent, bareOwner });

    // ── aimeat_workspace_transfer ── (workspace export/import as a base64 ZIP)
    // Extracted to workspace-transfer.ts; registered here to preserve tool order.
    registerWorkspaceTransferTool(mcp, storage, config, { ownerName, ownerGhii, ok, fail, denyReason, findWsEntry, roleOf });
}
