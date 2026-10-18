/**
 * @file src/routes/organisms/workspace-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace operations: contract engagements, activity/participant feeds, the in-place
 *   workspace update, public document sharing (+ share meta + password unlock), workspace/organism
 *   export/import, workspace wipe, and archive/unarchive. Extracted from src/routes/organisms.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.23.0 -- 2026-10-18 -- A renamed workspace's name meets the detection rules written for
 *     workspaces (classifyContainerAfterWrite; plan doc-mvdipuyqraas, L1.6).
 *   v1.22.0 -- 2026-10-18 -- PUT …/workspace/share asks the publish gate: opening the share to anyone
 *     with the link by an agent without publish:public stores the rest and answers 202 with
 *     `publish_request` (plan doc-mvcn6c7e4e5q, V4).
 *   v1.21.0 -- 2026-10-17 -- A share for the organism's members refuses a signed-in outsider with 403 SHARE_MEMBERS_ONLY (V3.4).
 *   v1.20.0 -- 2026-10-16 -- The share routes decide each item's AI label for the reader the share
 *     serves (shareServedVisibility: public on an open share); it was decided as private, so an
 *     AI-made page on an open link owed no label. ?format=md carries each page's provenance note.
 *     The member records read counts what an open share serves as public (shareOpenedIdsOf).
 *   v1.19.0 -- 2026-10-16 -- PUT …/workspace/share runs setWorkspaceShareOp (services/workspace-share.ts),
 *     the code the MCP tool aimeat_workspace_share runs; the share takes end dates (`until`). The
 *     public document reads give an HTML page its `frame_url` (services/page-frame.ts) and record
 *     the day each page was opened (services/workspace-opened.ts).
 *   v1.18.0 -- 2026-10-13 -- PUT /v1/organisms/:id/workspace hands the session to updateWorkspaceMeta,
 *     which refuses a change to the list of extensions of a space an app closed to agents unless the
 *     account holder makes it in person or the session covers organism:direct (403 ACCESS_DENIED,
 *     details.reason FENCE_CHANGE, nothing written); POST .../workspace/records/delete hands the
 *     session's scopes to the fenced-space rule (services/fenced-space.ts, ruled 2026-10-13).
 *   v1.17.0 -- 2026-10-13 -- GET .../workspace/public/records?format=ics serves one shared records
 *     space as a calendar feed, and PUT .../workspace/share { ics_key } makes or clears the feed key
 *     that opens that format for a share with a password or an account (services/calendar-feed.ts).
 *   v1.16.0 -- 2026-10-12 -- POST .../workspace/records/delete puts the records in the bin and asks
 *     memory:delete, as aimeat_workspace_object_delete does (ruling
 *     decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan, item 9).
 *   v1.15.0 -- 2026-10-09 -- The share unlock mints a token bound to the current password's version, so
 *     a password change ends it (secrets audit 2026-10-09, S-6).
 *   v1.14.0 -- 2026-10-08 -- The share reads (public documents, document, records) and the member read
 *     of records serve each item's `ai_provenance` block; the single public document also sends the
 *     AI-Disclosure and Link headers (both formats) and `meta.provenance`. A shared page carried no
 *     mark of how it was made (aiprov E1).
 *   v1.13.0 -- 2026-10-06 -- POST .../workspace/records/delete runs deleteRecordsBatchOp
 *     (services/workspace-tool-ops.ts), the function ctx.workspace.deleteRecords runs. An id given
 *     twice is decided once.
 *   v1.12.0 -- 2026-10-02 -- DELETE /v1/organisms/:id/workspace asks memory:purge beside organism:write:
 *     it removes every record and its history for good (Jouni, 2026-10-02).
 *   v1.11.0 -- 2026-10-02 -- POST .../workspace/records/delete asks memory:purge: it removes for good.
 *   v1.10.0 -- 2026-09-29 -- TARGET-082 review: the three public share reads answer the 404
 *     no-disclosure check and the share gate BEFORE the classification reader runs, so a visitor the
 *     gate refuses writes no refusal row into the organism's audit log.
 *   v1.9.0 -- 2026-09-29 -- The public documents and records, the member records, the activity feed and
 *     the agents' activity pass the caller's classification reader; a share passes show and leave
 *     (TARGET-082).
 *   v1.8.1 -- 2026-09-26 -- Whether the caller owns the agent is asked with localAccountName
 *     (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local
 *     namesake (secaudit 2026-09, F-1).
 *   v1.8.0 -- 2026-09-25 -- PUT /workspace takes `member_changes`, the workspace's rule for a plain
 *     member's change ('direct' | 'suggest'), which updateWorkspaceMeta writes as `…meta.rules`.
 *   v1.7.0 -- 2026-09-24 -- The activity feeds read the workspace manifest, and the share write the
 *     share record, through services/workspace-meta.ts: the copy that counts, not the first the scan
 *     returned. The share write updates that copy, so what it writes is what the readers take.
 *   v1.6.0 -- 2026-09-06 -- Review item 2.7: workspace update/delete, organism import and
 *     archive/unarchive carry organism:write, the word their MCP twins publish and their sibling
 *     doors in this same file already had.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 *   v1.1.0 — 2026-07-15 — Org managers (creator/admin) see every workspace in the agents/activity feed
 *     (isOrgManager), matching their automatic workspace read access.
 *   v1.2.0 — 2026-07-16 — agents/activity readable-workspace resolution batches every manifest read into
 *     ONE cross-owner key-IN query (readWsManifests + canReadWsManifest), not one canReadWs scan per ws.
 *   v1.3.0 — 2026-07-17 — GET /v1/organisms/:id/workspace/public/records — the generic no-auth read for
 *     records spaces a workspace marked public (meta.share), mirroring the public documents path.
 *   v1.4.0 — 2026-08-14 — SECURITY: POST /v1/organisms/:id/workspaces is gated by
 *     requireScope('organism:write'); requireRoleOrScope('agent', …) let every agent through on role.
 */
import type { Router, Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity, parseGaiiLoose, isSameOwner, localAccountName } from '../../utils/gaii.js';
import { authorizeRead } from '../../services/access-guard.js';
import { emitChange } from '../../services/event-bus.js';
import { verifyPassword } from '../../services/password.js';
import { setWorkspaceShareOp, shareServedVisibility, type SetShareBody } from '../../services/workspace-share.js';
import { servePublicDocs } from '../../services/page-frame.js';
import { markPageOpened, markPagesOpened } from '../../services/workspace-opened.js';
import { generateShareToken, shareTokenVersionOf, SHARE_TOKEN_TTL_SECONDS } from '../../services/share-token.js';
import { recordsToIcs, icsKeyMatches } from '../../services/calendar-feed.js';
import { updateWorkspaceMeta, WorkspaceMetaError, workspaceMetaReader } from '../../services/workspace-meta.js';
import { provisionWorkspace, WorkspaceProvisionError } from '../../services/workspace-provision.js';
import { deriveWorkspaceEvents } from '../../services/workspace-enrichment.js';
import { activateEngagement, retireEngagement, listByWorkspace as listEngagementsByWorkspace } from '../../services/workspace-engagements.js';
import { isKeyArchived } from '../../services/archive.js';
import { callerOf } from '../../middleware/caller.js';
import { workspaceCallerOf, deleteRecordsBatchOp } from '../../services/workspace-tool-ops.js';
import { updateOrganismStructure } from '../../services/structure-snapshot.js';
import { isOrgManager } from '../../services/workspace-access.js';
import { readerFor } from '../../services/classification/reader.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { workspaceTarget } from '../../services/classification/containers.js';
import { classifyContainerAfterWrite } from '../../services/classify-on-write.js';
import { withItemProvenance, shareOpenedIdsOf } from '../../services/share-provenance.js';
import { loadServedProvenance, loadServedProvenanceMany, setProvenanceHeaders, envelopeMeta, provenanceMarkdownNote } from '../../services/ai-provenance-marks.js';
import type { OrganismHelpers } from './shared.js';
import { logger } from '../../utils/logger.js';

export function registerOrganismWorkspaceOpsRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const {
    memberRole, toAgentGaii, findWsEntry, bareOwner, wsRegPrefix, canReadWs, canReadWsManifest, readWsManifests,
    readShareMeta, collectPublicDocs, collectPublicRecords, collectWsRecords, shareGateDenied, docsToMarkdown, redactShare, archiveHandler, readWsManifestValue,
  } = H;

  /* ── Contract engagements — the first-class link between an agent's contract capability and a
   * workspace, with an active/retired lifecycle (docs/agent-workspace-contracts.md §7d). Adopt
   * writes an `active` engagement; Retire flips it to `retired` (kept as history). Distinct from the
   * derived "active here" trace: the engagement is INTENT, the trace is EVIDENCE. ── */

  /* ── POST /v1/organisms/:id/workspace/engagements — ACTIVATE (adopt) a contract engagement. Body:
   * { ws, agent, contract? }. The caller must own the agent (you bring your OWN agent in) and be a
   * member of the organism. ── */
  router.post('/v1/organisms/:id/workspace/engagements', requireAuth(), requireScope('organism:write'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, agent, contract } = req.body ?? {};
    if (!ws || typeof ws !== 'string' || !agent || typeof agent !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and agent are required')); return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const agentGaii = toAgentGaii(agent, req.auth!.owner as string);
    if (localAccountName(agentGaii) !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only adopt a contract for an agent you own')); return;
    }
    const eng = await activateEngagement(storage, config.nodeId, { orgId: id, ws, agentGaii, contract: typeof contract === 'string' ? contract : undefined, by: req.auth!.owner as string });
    emitChange('organisms');
    res.json(success(config.nodeId, { engagement: eng }));
  });

  /* ── POST /v1/organisms/:id/workspace/engagements/retire — RETIRE a contract engagement (real
   * off-switch: an agent's processing loop skips a workspace whose engagement is retired). Body:
   * { ws, agent, contract? }. Allowed for the agent's OWNER (my agent, I pull it) OR the workspace
   * creator/admin (I run this workspace, I remove your agent). ── */
  router.post('/v1/organisms/:id/workspace/engagements/retire', requireAuth(), requireScope('organism:write'), async (req, res) => {
    const id = req.params.id as string;
    const { ws, agent, contract } = req.body ?? {};
    if (!ws || typeof ws !== 'string' || !agent || typeof agent !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and agent are required')); return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const callerRole = await memberRole(req, organism, id);
    if (!callerRole) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const agentGaii = toAgentGaii(agent, req.auth!.owner as string);
    const ownsAgent = localAccountName(agentGaii) === req.auth!.owner;
    if (!ownsAgent) {
      // Not my agent → I must be able to manage this workspace's access to retire someone else's.
      const entry = await findWsEntry(id, ws);
      const createdBy = entry ? (entry.createdBy ?? bareOwner(entry.ownerGaii)) : null;
      const isManager = createdBy === req.auth!.owner || callerRole === 'creator' || callerRole === 'admin';
      if (!isManager) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the agent’s owner or the workspace creator can retire a contract')); return; }
    }
    const eng = await retireEngagement(storage, config.nodeId, { orgId: id, ws, agentGaii, contract: typeof contract === 'string' ? contract : undefined, by: req.auth!.owner as string });
    emitChange('organisms');
    res.json(success(config.nodeId, { engagement: eng }));
  });

  /* ── GET /v1/organisms/:id/workspace/engagements?ws= — list the contract engagements declared in a
   * workspace (active + retired), for the People panel chips. Member-gated. ── */
  router.get('/v1/organisms/:id/workspace/engagements', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const engagements = await listEngagementsByWorkspace(storage, id, ws);
    res.json(success(config.nodeId, { ws, engagements }));
  });

  /* ── GET /v1/organisms/:id/workspace/activity?ws= — deterministic activity feed for a workspace,
   * derived from the version history: who did what, in which space, draft-edit vs publish, when.
   * Each .version.N = a publish event; each .draft = an edit event. Member-gated; access-filtered. ── */
  router.get('/v1/organisms/:id/workspace/activity', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });
    const manifest = ((await workspaceMetaReader(storage, id, config.nodeId).pick(ws, 'meta.manifest', items))?.value as Record<string, unknown> | undefined) ?? null;

    // Read-authorize each record (the caller's own records AND their own agents' records — same owner,
    // different GAII — are always theirs to see; only genuinely other-owner records hit the consent
    // check), then derive the events via the shared helper so the activity feed, the workspace list's
    // lastEvent, and the agents/activity aggregate all reconstruct events identically.
    const readable: typeof items = [];
    for (const r of items) {
      if (r.ownerGaii !== callerGaii && !isSameOwner(r.ownerGaii, callerGaii)) {
        const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: callerGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
        if (!d.allowed) continue;
      }
      readable.push(r);
    }
    // The classification reader (TARGET-082): an event about a record the caller may not see is not shown.
    const shown = await readerFor({ storage, config }, req.auth).show(readable, r => memoryTarget(r.ownerGaii, r.key));
    const events = deriveWorkspaceEvents(shown, manifest, root);
    events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json(success(config.nodeId, { ws, events: events.slice(0, 300), total: events.length }));
  });

  /* ── GET /v1/organisms/:id/agents/activity — agent activity context aggregated across EVERY workspace
   * the caller can read, in ONE request (replaces the organism Agents tab's per-workspace
   * getWorkspaceActivity fan-out). Same read-authorized event derivation as GET /workspace/activity.
   * Returns { agents: { agentName: { count, lastAt, workspaces:[names] } } }. ── */
  router.get('/v1/organisms/:id/agents/activity', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const ownerName = req.auth!.owner as string;
    // An org manager (creator/admin) can read every workspace → skip the per-ws probe.
    const manager = await isOrgManager(storage, id, ownerName);
    // Registry → readable workspaces + names.
    const reg = await storage.listAllMemory({ prefix: wsRegPrefix(id), limit: 1000 });
    const candidates: Array<{ id: string; name: string; createdBy: string }> = [];
    const seenWs = new Set<string>();
    for (const rec of reg.items) {
      if (rec.key !== wsRegPrefix(id)) continue;
      for (const w of ((rec.value as { workspaces?: Array<{ id?: string; name?: string; createdBy?: string }> } | null)?.workspaces ?? [])) {
        if (!w.id || seenWs.has(w.id)) continue;
        seenWs.add(w.id);
        candidates.push({ id: w.id, name: w.name ?? w.id, createdBy: w.createdBy ?? bareOwner(rec.ownerGaii) });
      }
    }
    // Readable workspaces: own + (manager ? all : per-ws read-authz). Batch the non-owner probes' manifest
    // reads into ONE cross-owner key-IN query, then decide each from its pre-fetched manifest (identical
    // semantics to per-ws canReadWs).
    const wss: Array<{ id: string; name: string }> = [];
    const toProbe = candidates.filter(w => w.createdBy !== ownerName && !manager);
    const manifests: Map<string, MemoryRecord> = toProbe.length ? await readWsManifests(id, toProbe.map(w => w.id)) : new Map();
    for (const w of candidates) {
      if (w.createdBy === ownerName || manager) { wss.push({ id: w.id, name: w.name }); continue; }
      if (await canReadWsManifest(callerGaii, `organism.${id}.w.${w.id}.meta.manifest`, manifests.get(w.id) ?? null)) wss.push({ id: w.id, name: w.name });
    }
    // Single scan of organism.{id}.w. → bucket by ws (per-ws fallback above the cap).
    const wRoot = `organism.${id}.w.`;
    const ENRICH_SCAN_CAP = 20000;
    const buckets = new Map<string, MemoryRecord[]>();
    let perWsScan = false;
    const scan = await storage.listAllMemory({ prefix: wRoot, limit: ENRICH_SCAN_CAP });
    if (scan.total > ENRICH_SCAN_CAP) perWsScan = true;
    else for (const r of scan.items) {
      const wsId = r.key.slice(wRoot.length).split('.')[0];
      if (!wsId) continue;
      let arr = buckets.get(wsId); if (!arr) { arr = []; buckets.set(wsId, arr); } arr.push(r);
    }
    const agg: Record<string, { count: number; lastAt: string; workspaces: Set<string> }> = {};
    const metaReader = workspaceMetaReader(storage, id, config.nodeId);
    const reader = readerFor({ storage, config }, req.auth);
    for (const w of wss) {
      const root = `organism.${id}.w.${w.id}`;
      const bucket = perWsScan ? (await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 })).items : (buckets.get(w.id) ?? []);
      const readable: MemoryRecord[] = [];
      for (const r of bucket) {
        if (r.ownerGaii !== callerGaii && !isSameOwner(r.ownerGaii, callerGaii)) {
          const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: callerGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
          if (!d.allowed) continue;
        }
        readable.push(r);
      }
      const manifest = ((await metaReader.pick(w.id, 'meta.manifest', bucket))?.value as Record<string, unknown> | undefined) ?? null;
      // The classification reader (TARGET-082), as in the workspace activity feed above.
      const shown = await reader.show(readable, r => memoryTarget(r.ownerGaii, r.key));
      for (const e of deriveWorkspaceEvents(shown, manifest, root)) {
        if (!e.agent) continue;
        const a = agg[e.agent] ?? (agg[e.agent] = { count: 0, lastAt: '', workspaces: new Set<string>() });
        a.count++; a.workspaces.add(w.name);
        if (!a.lastAt || (e.at || '') > a.lastAt) a.lastAt = e.at;
      }
    }
    const agents: Record<string, { count: number; lastAt: string; workspaces: string[] }> = {};
    for (const [name, v] of Object.entries(agg)) agents[name] = { count: v.count, lastAt: v.lastAt, workspaces: [...v.workspaces] };
    res.json(success(config.nodeId, { agents }));
  });

  /* ── GET /v1/organisms/:id/workspace/participants?ws= — who takes part in this workspace, derived
   * from the records' ownerGaii traces (humans + their agents leave their identity on what they write)
   * plus organism membership. Builds a node → owner → agents hierarchy. Agent NAMES are revealed only
   * for the CALLER's own agents; every other owner's agents come back anonymized (name: null), so the
   * caller sees their own agents named and everyone else's only as ghost boxes + counts. ── */
  router.get('/v1/organisms/:id/workspace/participants', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const viewerOwner = req.auth!.owner as string;
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });

    interface OwnerAgg { owner: string; node: string; human: number; agents: Map<string, number> }
    const byKey = new Map<string, OwnerAgg>();
    const ensure = (owner: string, node: string) => {
      const k = `${owner}@${node}`;
      let a = byKey.get(k);
      if (!a) { a = { owner, node, human: 0, agents: new Map() }; byKey.set(k, a); }
      return a;
    };
    for (const r of items) {
      const rel = r.key.slice(root.length + 1);
      if (rel.startsWith('access.')) continue;            // access requests are plumbing, not participation
      const p = parseGaiiLoose(r.ownerGaii);
      if (!p.owner || !p.node) continue;
      const agg = ensure(p.owner, p.node);
      if (p.agent) agg.agents.set(p.agent, (agg.agents.get(p.agent) || 0) + 1);
      else agg.human++;
    }
    // Organism members are humans with access — include them even if they have not written anything yet.
    for (const m of (organism.members || [])) ensure(m, config.nodeId);

    const wsEntry = await findWsEntry(id, ws);
    const creator = wsEntry?.createdBy;
    const memberSet = new Set(organism.members || []);

    const nodesMap = new Map<string, OwnerAgg[]>();
    for (const agg of byKey.values()) {
      const list = nodesMap.get(agg.node) ?? [];
      list.push(agg);
      nodesMap.set(agg.node, list);
    }
    const nodes = [...nodesMap.entries()].map(([node, owners]) => ({
      id: node,
      isLocal: node === config.nodeId,
      owners: owners.map(o => {
        const isSelf = o.owner === viewerOwner && o.node === config.nodeId;
        return {
          owner: o.owner,
          isSelf,
          isMember: memberSet.has(o.owner),
          isCreator: o.owner === creator,
          contributions: o.human,
          // Show every agent's identifier + what it has done (its trace count); `isOwn` only drives
          // the visual emphasis. A non-own agent's LIVE status / current task is never exposed here —
          // this endpoint only ever reports the historical trace, so others' agents stay greyed-out.
          agents: [...o.agents.entries()].map(([name, count]) => ({ name, isOwn: isSelf, contributions: count })),
        };
      }),
    }));
    res.json(success(config.nodeId, { ws, viewerOwner, nodes }));
  });

  /* ── PUT /v1/organisms/:id/workspace?ws= — update a workspace's name and/or readme IN PLACE (no new
   * id, no touch to objectTypes/schemas/content), keeping the name synced across manifest + registry,
   * and its rule for members' changes (`member_changes`: 'direct' | 'suggest').
   * Creator-only (or an org admin). A member adds a space or changes sections through the member
   * change doors (./workspace-member-changes.ts). ── */
  router.put('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), requireScope('organism:write'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : (req.body?.ws as string | undefined);
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    // Archived workspace/organism is read-only — block structure/name/readme edits.
    const wsGuard = await isKeyArchived(storage, `organism.${id}.w.${ws}.`);
    if (wsGuard.archived) { res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${wsGuard.level} is archived (read-only). Unarchive it before editing.`)); return; }
    try {
      // The session rides along: a change to the list of extensions of a space an app closed to
      // agents is the account holder's in person, or a session's that covers organism:direct
      // (services/fenced-space.ts). The service compares the manifest and refuses before any write.
      const who = callerOf(req, config.nodeId, storage);
      const result = await updateWorkspaceMeta(storage, config, {
        orgId: id, ws, callerOwner: req.auth!.owner as string,
        isAdmin: role === 'admin' || role === 'creator',
        caller: { principal: who.principal, roles: who.roles, scopes: who.scopes },
        name: req.body?.name, readme: req.body?.readme,
        addObjectTypes: Array.isArray(req.body?.add_object_types) ? req.body.add_object_types : (Array.isArray(req.body?.add_spaces) ? req.body.add_spaces : undefined),
        manifest: req.body?.manifest, schemas: req.body?.schemas,
        apps: Array.isArray(req.body?.apps) ? req.body.apps : undefined,
        memberChanges: req.body?.member_changes,
      });
      emitChange('organisms');
      // A new name meets the detection rules written for workspaces (plan doc-mvdipuyqraas, L1.6).
      if (result.name) classifyContainerAfterWrite({ storage, config }, workspaceTarget(id, ws), result.name);
      res.json(success(config.nodeId, result));
      // Manifest/space/name edits change the structure → record a timeline snapshot (dedup handles no-ops).
      void updateOrganismStructure(storage, config, id, { event: 'workspace updated', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(err => { logger.warn('PUT /v1/organisms/:id/workspace: best-effort', { error: String(err) }); });
    } catch (e) {
      if (e instanceof WorkspaceMetaError) {
        const status = e.code === 'WS_NOT_FOUND' ? 404 : e.code === 'NOT_CREATOR' || e.code === 'ACCESS_DENIED' ? 403 : 400;
        res.status(status).json(error(config.nodeId, e.code, e.message, status, e.details));
        return;
      }
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', (e as Error).message || 'Could not update the workspace'));
    }
  });

  /* ── POST /v1/organisms/:id/workspaces — CREATE a new workspace from a manifest + per-namespace JSON
     schemas (locked strict). Any active member may create; the workspace meta + schema locks are owned
     by the caller's OWNER GHII (resolveIdentity). Mirrors the MCP aimeat_workspace_create — both share
     services/workspace-provision.ts. The gate is requireScope('organism:write'): requireRoleOrScope
     ('agent', …) admitted every agent before it read the word, so the permission that hides
     aimeat_workspace_create from an agent's MCP surface did nothing here. Reasoning and measurement on
     POST /v1/organisms in crud.ts. Owner/operator sessions bypass scopes; membership is unchanged. ── */
  router.post('/v1/organisms/:id/workspaces', requireAuth(), requireScope('organism:write'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const name = req.body?.name;
    if (!name || typeof name !== 'string' || !name.trim()) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'name is required')); return; }
    const ownerName = req.auth!.owner as string;
    try {
      const result = await provisionWorkspace(storage, config, {
        orgId: id, ownerName, ownerGhii: `${ownerName}@${config.nodeId}`,
        name: name.trim(), manifest: req.body?.manifest, schemas: req.body?.schemas, readme: req.body?.readme,
      });
      emitChange('organisms');
      void updateOrganismStructure(storage, config, id, { event: 'workspace created', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(err => { logger.warn('POST /v1/organisms/:id/workspaces: best-effort', { error: String(err) }); });
      res.status(201).json(success(config.nodeId, { created: true, ...result }));
    } catch (e) {
      if (e instanceof WorkspaceProvisionError || e instanceof WorkspaceMetaError) {
        res.status(400).json(error(config.nodeId, (e as WorkspaceMetaError).code ?? 'INVALID_MANIFEST', e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'CREATE_FAILED', (e as Error).message || 'Could not create the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/workspace/public/documents?ws=&space=&format= — NO AUTH. The published
   * document-space pages a workspace has marked public (via meta.share). ?space= limits to one space;
   * ?format=md returns a single concatenated markdown document. 404 (no disclosure) if nothing public. ── */
  router.get('/v1/organisms/:id/workspace/public/documents', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const space = typeof req.query.space === 'string' ? req.query.space : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism || !ws) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    // What the share opens (404 no-disclosure), then the share gate, then the classification reader:
    // a visitor the gate refuses leaves no classification audit row (TARGET-082 review).
    const found = await collectPublicDocs(id, ws, share, space ? { type: space } : undefined);
    if (found.count === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public documents')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(denied.code === 'SHARE_MEMBERS_ONLY' ? 403 : 401).json(error(config.nodeId, denied.code, denied.message)); return; }
    const docs = await found.release(readerFor({ storage, config }, req.auth));
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public documents')); return; }
    void markPagesOpened(storage, config, id, ws, docs.map(d => ({ space: d.type, id: d.id })));
    // Each label is decided for the reader this share serves: public on an open share.
    const surface = { visibility: shareServedVisibility(share) };
    if (req.query.format === 'md') {
      const entry = await findWsEntry(id, ws);
      const prov = await loadServedProvenanceMany(storage, config, docs.map(d => d.aiProvenanceId), { surface });
      res.type('text/markdown; charset=utf-8').send(docsToMarkdown(entry?.name, docs,
        d => provenanceMarkdownNote(d.aiProvenanceId ? prov.get(d.aiProvenanceId) : undefined)));
      return;
    }
    // Each document carries its own record, `ai_provenance` (aiprov E1): a page of documents is
    // not one piece of content, so there is no page-level header. An HTML page carries its frame
    // address, minted here because this caller has just passed the share's gate.
    const served = await servePublicDocs(config, await withItemProvenance(storage, config, docs, { surface }), { orgId: id, ws, withHtml: false });
    res.json(success(config.nodeId, { organism_id: id, ws, documents: served }));
  });

  /* ── GET /v1/organisms/:id/workspace/public/document?ws=&type=&id=&format= — NO AUTH. A single
   * published+public document-space page. ?format=md returns its raw markdown. 404 otherwise. ── */
  router.get('/v1/organisms/:id/workspace/public/document', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const docId = typeof req.query.id === 'string' ? req.query.id : '';
    const organism = await storage.getOrganism(id);
    if (!organism || !ws || !type || !docId) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    const found = await collectPublicDocs(id, ws, share, { type, id: docId });
    if (found.count === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Document not found or not public')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(denied.code === 'SHARE_MEMBERS_ONLY' ? 403 : 401).json(error(config.nodeId, denied.code, denied.message)); return; }
    const [doc] = await found.release(readerFor({ storage, config }, req.auth));
    if (!doc) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Document not found or not public')); return; }
    // ONE document is one piece of content: its record rides the AI-Disclosure and Link headers in
    // both formats, `meta.provenance` and the item's block in JSON (aiprov E1), and its note in the
    // Markdown body. The label is decided for the reader this share serves.
    const surface = { visibility: shareServedVisibility(share) };
    const prov = await loadServedProvenance(storage, config, doc.aiProvenanceId, { surface });
    setProvenanceHeaders(res, prov);
    void markPageOpened(storage, config, id, ws, doc.type, doc.id);
    if (req.query.format === 'md') {
      const note = provenanceMarkdownNote(prov);
      res.type('text/markdown; charset=utf-8').send(`# ${doc.title}\n\n${note ? `${note}\n\n` : ''}${doc.markdown.trim()}\n`);
      return;
    }
    const [served] = await servePublicDocs(config, await withItemProvenance(storage, config, [doc], { surface }), { orgId: id, ws, withHtml: true });
    res.json(success(config.nodeId, { organism_id: id, ws, document: served }, undefined, envelopeMeta(prov)));
  });

  /* ── GET /v1/organisms/:id/workspace/public/records?ws=&space= — NO AUTH. The PUBLISHED (.latest)
   * records a workspace has marked public (via meta.share — the SAME public/spaces/docs gate as the
   * public documents path, so a records space is opted into anonymous read exactly like a document
   * space). ?space= limits to one records space. Each entry is { type, id, value } (the full record).
   * 404 (no disclosure) if nothing is public; the share access mode (open/account/password) still gates
   * the read like the public documents path. This is the generic anonymous read for public record
   * spaces — any public showroom / catalogue / knowledge client reads its structured data through it. ── */
  // A calendar program fetches its feed every few minutes to hours. This bounds what one address
  // can cost the node, and applies to the calendar format only; the JSON read is as it was.
  const icsLimit = rateLimit({ windowMs: 15 * 60_000, max: 120, keyBy: 'ip' });
  const icsFeedLimit = (req: Request, res: Response, next: NextFunction): void => {
    if (req.query.format === 'ics') icsLimit(req, res, next); else next();
  };

  // ?format=ics is the same read as an RFC 5545 calendar, for a calendar program to subscribe to
  // (services/calendar-feed.ts). It names ONE space, whose records are events in the shape the
  // served library aimeat-calendar defines; only an event's own fields are written. A calendar
  // program cannot sign in or send a share token, so for this format alone `?key=` (the share's
  // feed key, made with PUT …/workspace/share { ics_key: true }) passes the access mode. The key
  // opens nothing the share does not open, and nothing in any other format.
  router.get('/v1/organisms/:id/workspace/public/records', icsFeedLimit, async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const space = typeof req.query.space === 'string' ? req.query.space : undefined;
    const asIcs = req.query.format === 'ics';
    const organism = await storage.getOrganism(id);
    if (!organism || !ws) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    if (asIcs && !space) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'format=ics takes one space: add space=<the records space that holds the events>')); return; }
    const share = await readShareMeta(id, ws);
    const found = await collectPublicRecords(id, ws, share, space ? { space } : undefined);
    // A calendar with no event yet is still a calendar: when the share opens the WHOLE space the
    // feed names (the space's own setting, else the workspace's), the feed answers an empty
    // calendar where the JSON read answers 404. A person subscribes before they add their first
    // event, and a calendar program shows a 404 as a broken subscription. Nothing new is told: the
    // space is one the share made public, and the access mode below still applies.
    const emptyFeed = asIcs && !!space && (space in share.spaces ? !!share.spaces[space] : !!share.public)
      && ((await readWsManifestValue(id, ws))?.objectTypes as Array<Record<string, unknown>> | undefined ?? []).some(ot => ot.name === space && ot.mode === 'records');
    if (found.count === 0 && !emptyFeed) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public records')); return; }
    const denied = asIcs && icsKeyMatches(share.icsKeyHash, req.query.key) ? null : await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(denied.code === 'SHARE_MEMBERS_ONLY' ? 403 : 401).json(error(config.nodeId, denied.code, denied.message)); return; }
    const records = await found.release(readerFor({ storage, config }, req.auth));
    if (records.length === 0 && !emptyFeed) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public records')); return; }
    if (asIcs) {
      const feed = await recordsToIcs(records, (await findWsEntry(id, ws))?.name);
      // The address may carry the feed key: no shared cache keeps the answer, and no page it is opened from learns the address.
      res.set({ 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer', 'X-Calendar-Events': String(feed.events), 'X-Calendar-Skipped': String(feed.skipped) });
      res.type('text/calendar; charset=utf-8').send(feed.ics);
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, records: await withItemProvenance(storage, config, records, { surface: { visibility: shareServedVisibility(share) } }) }));
  });

  /* ── GET /v1/organisms/:id/workspace/records?ws=&space= — AUTHENTICATED member read of a
   * workspace's PUBLISHED (.latest) records: the members-only analogue of /workspace/public/records,
   * with the same { type, id, value } rows. No share gating — authorization IS the workspace read
   * authz (canReadWs: same-owner, membership/consent, GEAI data-area). Owner sessions bypass scopes;
   * an app session (H-2) needs the owner-granted `organism:read` scope, which is how a published app
   * (e.g. the Experience Center's gated business levels) reads members-only curriculum for the
   * signed-in user — access is granted/revoked per user via workspace membership. Agents use the MCP
   * workspace_read surface; this REST route serves browser sessions and scoped app grants.
   * 404 (no disclosure) for a missing organism/workspace AND for an unauthorized caller. ── */
  router.get('/v1/organisms/:id/workspace/records', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const space = typeof req.query.space === 'string' ? req.query.space : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism || !ws) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    if (!(await canReadWs(id, ws, callerGaii))) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const records = await collectWsRecords(id, ws, readerFor({ storage, config }, req.auth), space ? { space } : undefined);
    // A record the workspace shares on an open link is public, and a member sees the label it owes there.
    const alsoPublic = shareOpenedIdsOf(await readShareMeta(id, ws), records);
    res.json(success(config.nodeId, { organism_id: id, ws, records: await withItemProvenance(storage, config, records, { alsoPublic }) }));
  });

  /* ── GET /v1/organisms/:id/workspace/share?ws= — the current share state (for the UI toggles).
   * Any active member may read it. Owner sessions bypass scopes; app/agent tokens need memory:read
   * (sharing lives in a memory record — without this gate ANY app grant could read/flip it). ── */
  router.get('/v1/organisms/:id/workspace/share', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    res.json(success(config.nodeId, { organism_id: id, ws, share: redactShare(await readShareMeta(id, ws)) }));
  });

  /* ── PUT /v1/organisms/:id/workspace/share?ws= — set the share state. Body { public?, spaces?, docs?,
   * access?, password?, ics_key?, until? } is MERGED into the existing meta.share. The workspace creator
   * or an org admin only. services/workspace-share.ts holds the whole rule, end dates and the HTML page
   * default included, and the MCP tool aimeat_workspace_share runs it too. ── */
  router.put('/v1/organisms/:id/workspace/share', requireAuth(), requireScope('memory:write'), async (req, res) => {
    // The resolved caller, as the MCP tool passes it: an organism agent is matched by its GAII.
    const r = await setWorkspaceShareOp({ storage, config }, { sub: resolveIdentity(req.auth!, config.nodeId), owner: req.auth!.owner as string | undefined }, {
      orgId: req.params.id as string,
      ws: typeof req.query.ws === 'string' ? req.query.ws : '',
      body: (req.body ?? {}) as SetShareBody,
      // Opening it to anyone with the link asks the node's publish gate (plan doc-mvcn6c7e4e5q, V4).
    }, { caller: callerOf(req, config.nodeId, storage), ...(req.auth?.app ? { app: req.auth.app } : {}) });
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    // 202 when the opening part waits for the owner; the rest of the change is stored.
    res.status(r.asked ? 202 : 200).json(success(config.nodeId, r.data));
  });

  /* ── POST /v1/organisms/:id/workspace/share/unlock — NO AUTH. Exchange the share password for a
   * short-lived share token (X-Share-Token on the public reads). Body { ws, password }. Tightly
   * rate-limited PER IP (keyBy:'ip' — anonymous mode would otherwise share one bucket) and
   * timing-uniform: a workspace without a password verifies against a dummy hash so the response
   * time does not disclose whether password mode is even configured. Always a generic 401 on
   * failure — no hints. ── */
  const SHARE_UNLOCK_DUMMY_HASH = 'v2:' + '0'.repeat(32) + ':' + '0'.repeat(128);
  router.post('/v1/organisms/:id/workspace/share/unlock',
    rateLimit({ windowMs: 15 * 60_000, max: 10, keyBy: 'ip' }),
    async (req, res) => {
      const id = req.params.id as string;
      const body = (req.body ?? {}) as { ws?: unknown; password?: unknown };
      const ws = typeof body.ws === 'string' ? body.ws : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!ws || !password) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and password are required')); return; }
      const organism = await storage.getOrganism(id);
      const share = organism ? await readShareMeta(id, ws) : null;
      const usable = !!share && share.access === 'password' && !!share.passwordHash;
      const ok = await verifyPassword(password, usable ? share!.passwordHash! : SHARE_UNLOCK_DUMMY_HASH);
      if (!usable || !ok) { res.status(401).json(error(config.nodeId, 'INVALID_PASSWORD', 'Invalid password')); return; }
      // Bound to this password: a change ends the token (secrets audit 2026-10-09, S-6).
      const shareToken = await generateShareToken({ org: id, ws, pwv: shareTokenVersionOf(share!.passwordHash!) });
      res.json(success(config.nodeId, {
        organism_id: id, ws, share_token: shareToken, expires_in: SHARE_TOKEN_TTL_SECONDS,
      }, [{ description: 'Read the shared documents (send the token as X-Share-Token)', method: 'GET', url: `/v1/organisms/${id}/workspace/public/documents?ws=${ws}` }]));
    });

  /* ── DELETE /v1/organisms/:id/workspace — wipe the workspace (manifest + readme + config + ALL
   * object data: drafts, latest, version history) and unregister its schema locks. The organism
   * itself (membership, etc.) stays — it returns to "no workspace yet". Creator/admin only; the
   * deliberate typed-confirmation lives in the UI. Memory under organism.{id}.* is removed entirely.
   * memory:purge beside organism:write, because nothing of it can come back (Jouni, 2026-10-02). */
  router.delete('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), requireScope('organism:write', 'memory:purge'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the creator or an admin can delete the workspace'));
      return;
    }
    // Scope the wipe to one workspace (organism.{id}.w.{ws}.*) when ?ws= is given; without it, the
    // legacy organism-level wipe. The registry entry (organism.{id}.meta.workspaces) is managed by
    // the client, which removes the entry after this succeeds.
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const prefix = ws ? `organism.${id}.w.${ws}.` : `organism.${id}.`;
    // Data-access redesign (Phase 2): wipe the container in ONE statement (all rows under the prefix,
    // active AND archived) instead of a per-key deleteMemory loop over thousands of rows.
    let memoryKeys: number;
    if (storage.deleteMemoryByPrefix) {
      memoryKeys = await storage.deleteMemoryByPrefix(prefix);
    } else {
      const { items } = await storage.listAllMemory({ prefix, limit: 100000, archived: 'include' });
      memoryKeys = 0;
      for (const r of items) { if (await storage.deleteMemory(r.ownerGaii, r.key)) memoryKeys++; }
    }
    let schemas = 0;
    for (const s of await storage.listSchemas(prefix)) { if (await storage.deleteSchema(s.keyPattern)) schemas++; }
    res.json(success(config.nodeId, { deleted: true, memoryKeys, schemas }));
    emitChange('organisms');
    if (ws) void updateOrganismStructure(storage, config, id, { event: 'workspace deleted', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(err => { logger.warn('DELETE /v1/organisms/:id/workspace: timeline best-effort', { error: String(err) }); });
  });

  /* ── POST /v1/organisms/:id/workspace/records/delete — BATCHED record-family delete (Phase 2, data-
   * access redesign). Deletes MANY workspace records in ONE request: resolves the organism + membership
   * + the append-only guard ONCE, removes each record's whole family (bare / .draft / .latest /
   * .version.N) that is owned by the CALLER'S OWN identity family (cross-owner rows are never touched —
   * a member can only delete their own records), and commits every deletion in one batch. Replaces N
   * single object-delete calls (a 549-record CADENCE teardown was 549 round-trips + per-key deletes).
   * Body: { ws?, namespace, ids: [] }. Mirrors aimeat_workspace_object_delete's own/same-owner + role
   * + append-only semantics.
   *
   * `memory:delete` since 2026-10-12: the records go to the deleted-memory bin and come back with
   * aimeat_memory_restore for the node's grace period, the undoable delete DELETE /v1/memory/:key and
   * aimeat_workspace_object_delete make (ruling decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-
   * mukaan, item 9). From 2026-10-02 it asked memory:purge, because it removed the rows for good.
   * `memory:purge` stays the word for what cannot come back: a whole workspace (above) and rows. ── */
  router.post('/v1/organisms/:id/workspace/records/delete', requireAuth(), requireExternalPrincipal(), requireScope('memory:delete'), async (req, res) => {
    // The body is deleteRecordsBatchOp (services/workspace-tool-ops.ts), which
    // ctx.workspace.deleteRecords runs too: membership, the append-only guard, the caller-owned family.
    const who = callerOf(req, config.nodeId, storage);
    if (who.visitor) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'A session from another node is not a member of this organism.')); return; }
    const body = req.body ?? {};
    const r = await deleteRecordsBatchOp({ storage, config },
      workspaceCallerOf({ principal: who.principal, ownerName: who.owner, roles: [...who.roles], scopes: who.scopes }, config), {
        organismId: req.params.id as string,
        ws: typeof body.ws === 'string' && body.ws ? body.ws : undefined,
        namespace: body.namespace,
        ids: Array.isArray(body.ids) ? body.ids : [],
      });
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message, r.status, r.details)); return; }
    res.json(success(config.nodeId, r.data));
  });

  /* ── Archive / Unarchive ──────────────────────────────────────────────────────────────────────
   * Flag an organism, a workspace, a record-table/document-space, or a single record as read-only +
   * archived so it drops out of every AI-facing material (overview, workspace read, search) yet stays
   * findable via archive search and resolvable by key. Cascades down a container with smart restore
   * (see services/archive.ts). Creator/admin only — archiving is a structural, destructive-adjacent op.
   * Body: { level: 'organism'|'workspace'|'space'|'record', ws?, namespace?, key? }. */

  // aimeat_organism_archive publishes organism:write; these are the routes behind it.
  router.post('/v1/organisms/:id/archive', requireAuth(), requireRole('agent'), requireScope('organism:write'), archiveHandler('archive'));
  router.post('/v1/organisms/:id/unarchive', requireAuth(), requireRole('agent'), requireScope('organism:write'), archiveHandler('unarchive'));
}
