/**
 * @file src/routes/organisms/workspace-ops.ts
 * @description Workspace operations: contract engagements, activity/participant feeds, the in-place
 *   workspace update, public document sharing (+ share meta + password unlock), workspace/organism
 *   export/import, workspace wipe, and archive/unarchive. Extracted from src/routes/organisms.ts to
 *   satisfy max-file-lines.
 * @version-history
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
import { raw, type Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity, parseGaiiLoose, isSameOwner } from '../../utils/gaii.js';
import { authorizeRead } from '../../services/access-guard.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import { hashPassword, verifyPassword } from '../../services/password.js';
import { generateShareToken, SHARE_TOKEN_TTL_SECONDS } from '../../services/share-token.js';
import { exportWorkspace } from '../../services/workspace-export.js';
import { importWorkspace } from '../../services/workspace-import.js';
import { exportOrganism } from '../../services/organism-export.js';
import { importOrganism } from '../../services/organism-import.js';
import { ZipSecurityError } from '../../services/safe-zip.js';
import { recordSecurityIncident } from '../../services/security-incident.js';
import { updateWorkspaceMeta, WorkspaceMetaError } from '../../services/workspace-meta.js';
import { provisionWorkspace, WorkspaceProvisionError } from '../../services/workspace-provision.js';
import { deriveWorkspaceEvents } from '../../services/workspace-enrichment.js';
import { activateEngagement, retireEngagement, listByWorkspace as listEngagementsByWorkspace } from '../../services/workspace-engagements.js';
import { isKeyArchived } from '../../services/archive.js';
import { checkDeleteGuard } from '../../services/write-guards.js';
import { updateOrganismStructure } from '../../services/structure-snapshot.js';
import { isOrgManager } from '../../services/workspace-access.js';
import type { OrganismHelpers, ShareMeta, ResolvedShare } from './shared.js';
import { logger } from '../../utils/logger.js';

export function registerOrganismWorkspaceOpsRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const {
    memberRole, toAgentGaii, findWsEntry, bareOwner, wsRegPrefix, canReadWs, canReadWsManifest, readWsManifests,
    readShareMeta, collectPublicDocs, collectPublicRecords, collectWsRecords, shareGateDenied, docsToMarkdown, redactShare, archiveHandler,
  } = H;

  /* ── Contract engagements — the first-class link between an agent's contract capability and a
   * workspace, with an active/retired lifecycle (docs/agent-workspace-contracts.md §7d). Adopt
   * writes an `active` engagement; Retire flips it to `retired` (kept as history). Distinct from the
   * derived "active here" trace: the engagement is INTENT, the trace is EVIDENCE. ── */

  /* ── POST /v1/organisms/:id/workspace/engagements — ACTIVATE (adopt) a contract engagement. Body:
   * { ws, agent, contract? }. The caller must own the agent (you bring your OWN agent in) and be a
   * member of the organism. ── */
  router.post('/v1/organisms/:id/workspace/engagements', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const { ws, agent, contract } = req.body ?? {};
    if (!ws || typeof ws !== 'string' || !agent || typeof agent !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws and agent are required')); return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const agentGaii = toAgentGaii(agent, req.auth!.owner as string);
    if ((parseGaiiLoose(agentGaii).owner || '') !== req.auth!.owner) {
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
  router.post('/v1/organisms/:id/workspace/engagements/retire', requireAuth(), async (req, res) => {
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
    const ownsAgent = (parseGaiiLoose(agentGaii).owner || '') === req.auth!.owner;
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
  router.get('/v1/organisms/:id/workspace/engagements', requireAuth(), async (req, res) => {
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
  router.get('/v1/organisms/:id/workspace/activity', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    const root = `organism.${id}.w.${ws}`;
    const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });
    const manifest = (items.find(r => r.key === `${root}.meta.manifest`)?.value as Record<string, unknown> | undefined) ?? null;

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
    const events = deriveWorkspaceEvents(readable, manifest, root);
    events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    res.json(success(config.nodeId, { ws, events: events.slice(0, 300), total: events.length }));
  });

  /* ── GET /v1/organisms/:id/agents/activity — agent activity context aggregated across EVERY workspace
   * the caller can read, in ONE request (replaces the organism Agents tab's per-workspace
   * getWorkspaceActivity fan-out). Same read-authorized event derivation as GET /workspace/activity.
   * Returns { agents: { agentName: { count, lastAt, workspaces:[names] } } }. ── */
  router.get('/v1/organisms/:id/agents/activity', requireAuth(), async (req, res) => {
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
      const manifest = (bucket.find(r => r.key === `${root}.meta.manifest`)?.value as Record<string, unknown> | undefined) ?? null;
      for (const e of deriveWorkspaceEvents(readable, manifest, root)) {
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
  router.get('/v1/organisms/:id/workspace/participants', requireAuth(), async (req, res) => {
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
   * id, no touch to objectTypes/schemas/content), keeping the name synced across manifest + registry.
   * Creator-only (or an org admin). ── */
  router.put('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), async (req, res) => {
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
      const result = await updateWorkspaceMeta(storage, config, {
        orgId: id, ws, callerOwner: req.auth!.owner as string,
        isAdmin: role === 'admin' || role === 'creator',
        name: req.body?.name, readme: req.body?.readme,
        addObjectTypes: Array.isArray(req.body?.add_object_types) ? req.body.add_object_types : (Array.isArray(req.body?.add_spaces) ? req.body.add_spaces : undefined),
        manifest: req.body?.manifest, schemas: req.body?.schemas,
        apps: Array.isArray(req.body?.apps) ? req.body.apps : undefined,
      });
      emitChange('organisms');
      res.json(success(config.nodeId, result));
      // Manifest/space/name edits change the structure → record a timeline snapshot (dedup handles no-ops).
      void updateOrganismStructure(storage, config, id, { event: 'workspace updated', actor: resolveIdentity(req.auth!, config.nodeId) }).catch(err => { logger.warn('PUT /v1/organisms/:id/workspace: best-effort', { error: String(err) }); });
    } catch (e) {
      if (e instanceof WorkspaceMetaError) {
        const status = e.code === 'WS_NOT_FOUND' ? 404 : e.code === 'NOT_CREATOR' ? 403 : 400;
        res.status(status).json(error(config.nodeId, e.code, e.message));
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
    let docs = await collectPublicDocs(id, ws, share);
    if (space) docs = docs.filter(d => d.type === space);
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public documents')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(401).json(error(config.nodeId, denied.code, denied.message)); return; }
    if (req.query.format === 'md') {
      const entry = await findWsEntry(id, ws);
      res.type('text/markdown; charset=utf-8').send(docsToMarkdown(entry?.name, docs));
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, documents: docs }));
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
    const docs = await collectPublicDocs(id, ws, share, { type, id: docId });
    if (docs.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Document not found or not public')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(401).json(error(config.nodeId, denied.code, denied.message)); return; }
    const doc = docs[0];
    if (req.query.format === 'md') {
      res.type('text/markdown; charset=utf-8').send(`# ${doc.title}\n\n${doc.markdown.trim()}\n`);
      return;
    }
    res.json(success(config.nodeId, { organism_id: id, ws, document: doc }));
  });

  /* ── GET /v1/organisms/:id/workspace/public/records?ws=&space= — NO AUTH. The PUBLISHED (.latest)
   * records a workspace has marked public (via meta.share — the SAME public/spaces/docs gate as the
   * public documents path, so a records space is opted into anonymous read exactly like a document
   * space). ?space= limits to one records space. Each entry is { type, id, value } (the full record).
   * 404 (no disclosure) if nothing is public; the share access mode (open/account/password) still gates
   * the read like the public documents path. This is the generic anonymous read for public record
   * spaces — any public showroom / catalogue / knowledge client reads its structured data through it. ── */
  router.get('/v1/organisms/:id/workspace/public/records', async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const space = typeof req.query.space === 'string' ? req.query.space : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism || !ws) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Not found')); return; }
    const share = await readShareMeta(id, ws);
    const records = await collectPublicRecords(id, ws, share, space ? { space } : undefined);
    if (records.length === 0) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No public records')); return; }
    const denied = await shareGateDenied(req, organism, id, ws, share);
    if (denied) { res.status(401).json(error(config.nodeId, denied.code, denied.message)); return; }
    res.json(success(config.nodeId, { organism_id: id, ws, records }));
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
    const records = await collectWsRecords(id, ws, space ? { space } : undefined);
    res.json(success(config.nodeId, { organism_id: id, ws, records }));
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

  /* ── PUT /v1/organisms/:id/workspace/share?ws= — set the share state. Body { public?, spaces?, docs? }
   * is MERGED into the existing meta.share. The workspace creator or an org admin only. The record is
   * stored under the workspace creator's GHII so there is exactly one canonical share record. ── */
  router.put('/v1/organisms/:id/workspace/share', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : '';
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can change sharing')); return;
    }
    const body = (req.body ?? {}) as ShareMeta & { password?: string | null };
    const isBoolMap = (m: unknown): m is Record<string, boolean> =>
      !!m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every(v => typeof v === 'boolean');
    if (body.spaces !== undefined && !isBoolMap(body.spaces)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'spaces must be a map of name → boolean')); return; }
    if (body.docs !== undefined && !isBoolMap(body.docs)) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'docs must be a map of key → boolean')); return; }
    if (body.access !== undefined && body.access !== 'open' && body.access !== 'password' && body.access !== 'account') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', "access must be 'open', 'password' or 'account'")); return;
    }
    if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password must be a string (set) or null (clear)')); return;
    }
    if (typeof body.password === 'string' && (body.password.length < 4 || body.password.length > 128)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'password must be 4–128 characters')); return;
    }
    const prev = await readShareMeta(id, ws);
    // password: string sets a new scrypt hash, null clears it, absent keeps the previous one.
    const nextHash = typeof body.password === 'string' ? await hashPassword(body.password)
      : body.password === null ? null : prev.passwordHash;
    const next: ResolvedShare = {
      public: typeof body.public === 'boolean' ? body.public : prev.public,
      spaces: { ...prev.spaces, ...(body.spaces ?? {}) },
      docs: { ...prev.docs, ...(body.docs ?? {}) },
      access: body.access ?? prev.access,
      passwordHash: nextHash,
    };
    if (next.access === 'password' && !next.passwordHash) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', "access 'password' requires a password to be set")); return;
    }
    const key = `organism.${id}.w.${ws}.meta.share`;
    const existing = (await storage.listAllMemory({ prefix: key, limit: 10 })).items.find(r => r.key === key);
    const now = new Date().toISOString();
    await storage.setMemory({
      key, ownerGaii: entry.ownerGaii, value: next, visibility: 'private', tags: ['share'], ttlHours: null,
      version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('organisms');
    res.json(success(config.nodeId, { organism_id: id, ws, share: redactShare(next) }));
    // Public landing feed — fire once on the FIRST public edge of this PUT: the whole
    // workspace, any space, or any document transitioning private→public ("publish to feed").
    const newlyPublic = (
      (next.public === true && prev.public === false) ||
      Object.entries(next.spaces).some(([k, v]) => v === true && prev.spaces[k] !== true) ||
      Object.entries(next.docs).some(([k, v]) => v === true && prev.docs[k] !== true)
    );
    if (newlyPublic) {
      void recordPublicActivity(storage, config, {
        category: 'organisms',
        actor: req.auth!.owner as string,
        summary: `Workspace "${entry.name ?? ws}" published publicly`,
        detail: organism.name ? `In organism "${organism.name}"` : '',
        link: `/v1/publicworkspaceviewer?org=${encodeURIComponent(id)}&ws=${encodeURIComponent(ws)}`,
      }).catch(err => { logger.warn('newlyPublic: feed is best-effort', { error: String(err) }); });
    }
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
      const shareToken = await generateShareToken({ org: id, ws });
      res.json(success(config.nodeId, {
        organism_id: id, ws, share_token: shareToken, expires_in: SHARE_TOKEN_TTL_SECONDS,
      }, [{ description: 'Read the shared documents (send the token as X-Share-Token)', method: 'GET', url: `/v1/organisms/${id}/workspace/public/documents?ws=${ws}` }]));
    });

  /* ── GET /v1/organisms/:id/workspace/export?ws= — download a full-fidelity ZIP backup of a
   * workspace (workspace.json + images/). The workspace creator (or an org admin) only. ── */
  router.get('/v1/organisms/:id/workspace/export', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const ws = typeof req.query.ws === 'string' ? req.query.ws : undefined;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!ws) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ws is required')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const entry = await findWsEntry(id, ws);
    if (!entry) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Workspace not found')); return; }
    const createdBy = entry.createdBy ?? bareOwner(entry.ownerGaii);
    if (createdBy !== (req.auth!.owner as string) && role !== 'creator' && role !== 'admin') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the workspace creator or an org admin can export')); return;
    }
    const { buffer, filename } = await exportWorkspace(storage, config, {
      orgId: id, ws, exporterGaii: resolveIdentity(req.auth!, config.nodeId), exportedAt: new Date().toISOString(),
      isOrgManager: role === 'creator' || role === 'admin',
    });
    // Programmatic/MCP callers can request the ZIP as base64 JSON (size-capped to keep it out of an
    // agent's context); the UI downloads the binary directly.
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) {
        res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Workspace too large for inline (base64) export — use the UI/REST binary download.'));
        return;
      }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/:id/workspace/import — restore a workspace ZIP as a NEW workspace in this
   * organism. Body is the raw ZIP (Content-Type application/zip). Member of the target org only;
   * the importer becomes the new workspace's creator. ── */
  router.post('/v1/organisms/:id/workspace/import', requireAuth(),
    // Raw-parse the body EXCEPT application/json (which the global json parser handles → { zip_base64 }).
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '64mb' }),
    async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the workspace ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importWorkspace(storage, config, { orgId: id, importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'workspace_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the workspace'));
    }
  });

  /* ── GET /v1/organisms/:id/export — download a ZIP backup of the WHOLE organism (settings + all
   * its workspaces). Any ACTIVE MEMBER (membership keyed by the bare owner name — org agents in
   * agentGaiis don't qualify): the bundle contains only what the member can already read live, so
   * the gate matches the read model instead of silently 403ing members the UI shows the button to.
   * ?format=base64 for a size-capped JSON payload. ── */
  router.get('/v1/organisms/:id/export', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const ownerName = req.auth!.owner as string | undefined;
    const m = ownerName ? await storage.getMembership(id, ownerName) : null;
    if (!m || m.status !== 'active') { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an active member of the organism can export it')); return; }
    // Export as the member's owner GHII — a member reads the whole organism live, and the per-creator
    // registry + records are GHII-owned (an agent-session GAII used to yield a near-empty bundle).
    const { buffer, filename } = await exportOrganism(storage, config, { orgId: id, exporterGaii: `${ownerName}@${config.nodeId}`, exportedAt: new Date().toISOString() });
    if (req.query.format === 'base64') {
      if (buffer.length > 1_500_000) { res.status(413).json(error(config.nodeId, 'TOO_LARGE', 'Organism too large for inline (base64) export — use the UI/REST binary download.')); return; }
      res.json(success(config.nodeId, { filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') }));
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  /* ── POST /v1/organisms/import — restore an organism bundle ZIP as a NEW organism (the importer
   * becomes its creator). Body is the raw ZIP (application/zip) or JSON { zip_base64 }. ── */
  router.post('/v1/organisms/import', requireAuth(), requireRole('agent'),
    raw({ type: (r) => !/application\/json/i.test(r.headers['content-type'] || ''), limit: '128mb' }),
    async (req, res) => {
    const b64 = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) ? (req.body as { zip_base64?: string }).zip_base64 : undefined;
    const buf = Buffer.isBuffer(req.body) ? req.body : (typeof b64 === 'string' ? Buffer.from(b64, 'base64') : null);
    if (!buf || buf.length === 0) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Send the organism ZIP as the raw body (Content-Type: application/zip) or JSON { zip_base64 }')); return; }
    try {
      const result = await importOrganism(storage, config, { importerGaii: resolveIdentity(req.auth!, config.nodeId), importerOwner: req.auth!.owner as string, zip: buf });
      emitChange('organisms');
      res.status(201).json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof ZipSecurityError) {
        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: resolveIdentity(req.auth!, config.nodeId), actorName: req.auth!.owner as string, detail: e.message, source: 'organism_import', blob: buf });
        res.status(422).json(error(config.nodeId, 'ZIP_REJECTED', `Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`));
        return;
      }
      res.status(400).json(error(config.nodeId, 'IMPORT_FAILED', (e as Error).message || 'Could not import the organism'));
    }
  });

  /* ── DELETE /v1/organisms/:id/workspace — wipe the workspace (manifest + readme + config + ALL
   * object data: drafts, latest, version history) and unregister its schema locks. The organism
   * itself (membership, etc.) stays — it returns to "no workspace yet". Creator/admin only; the
   * deliberate typed-confirmation lives in the UI. Memory under organism.{id}.* is removed entirely. */
  router.delete('/v1/organisms/:id/workspace', requireAuth(), requireRole('agent'), async (req, res) => {
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
   * + append-only semantics. ── */
  router.post('/v1/organisms/:id/workspace/records/delete', requireAuth(), requireExternalPrincipal(), requireScope('memory:delete'), async (req, res) => {
    const id = req.params.id as string;
    const body = req.body ?? {};
    const namespace = body.namespace;
    const rawIds = Array.isArray(body.ids) ? body.ids : null;
    if (typeof namespace !== 'string' || !namespace || !rawIds || rawIds.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace (string) and ids (non-empty array) are required'));
      return;
    }
    if (rawIds.length > 2000) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'At most 2000 ids per request'));
      return;
    }
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    if (!(await memberRole(req, organism, id))) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const ws = typeof body.ws === 'string' && body.ws ? body.ws : undefined;
    const wsRoot = ws ? `organism.${id}.w.${ws}` : `organism.${id}`;
    const callerGhii = resolveIdentity(req.auth!, config.nodeId);
    const ids = rawIds.filter((x: unknown): x is string => typeof x === 'string' && !!x);

    // Append-only guard ONCE (per-namespace policy): a create_only namespace refuses record deletion on
    // every path — existing events can never be erased. If it's append-only, refuse the whole batch.
    const guard = await checkDeleteGuard(`${wsRoot}.${namespace}.${ids[0]}.latest`, storage);
    if (!guard.valid) {
      res.status(409).json(error(config.nodeId, 'WRITE_CONFLICT', guard.errors?.[0]?.message ?? 'namespace is append-only', 409, { violations: guard.errors }));
      return;
    }

    // A key's role suffix must be the RECORD itself (bare), its .draft/.latest, or a .version.N — never a
    // sibling instance (`${base}0`) or unrelated child. Mirrors object_delete's per-row guard.
    const roleOk = (base: string, key: string): boolean => {
      const role = key === base ? '' : key.slice(base.length + 1);
      return role === '' || role === 'draft' || role === 'latest' || /^version\.\d+$/.test(role);
    };

    const refs: { ownerGaii: string; key: string }[] = [];
    const deleted: { id: string; keys: number }[] = [];
    const failed: { id: string; reason: string }[] = [];
    // ONE value-free (ownerGaii, key) scan of the namespace — the delete needs only addresses, so it
    // never loads a single value (a per-record listAllMemory scan loaded every record's value, which
    // dominated the delete cost). Fall back to per-record value scans only if the backend lacks the
    // key-only primitive. Then filter each requested id's family in memory (own/same-owner + role).
    const nsPrefix = `${wsRoot}.${namespace}.`;
    const nsKeys = storage.listMemoryKeysByPrefix
      ? await storage.listMemoryKeysByPrefix(nsPrefix)
      : (await storage.listAllMemory({ prefix: nsPrefix, limit: 100000 })).items.map(r => ({ ownerGaii: r.ownerGaii, key: r.key }));
    for (const rid of ids) {
      const base = `${wsRoot}.${namespace}.${rid}`;
      const family = nsKeys.filter(r =>
        (r.key === base || r.key.startsWith(`${base}.`)) && roleOk(base, r.key)
        && (r.ownerGaii === callerGhii || isSameOwner(r.ownerGaii, callerGhii)));
      if (family.length === 0) { failed.push({ id: rid, reason: 'nothing to delete (or not owned by you)' }); continue; }
      for (const r of family) refs.push({ ownerGaii: r.ownerGaii, key: r.key });
      deleted.push({ id: rid, keys: family.length });
    }

    // ONE batched delete of every collected ref (SQLite: one transaction; Prisma: chunked deleteMany).
    let removed = 0;
    if (refs.length) {
      if (storage.bulkDeleteMemory) removed = await storage.bulkDeleteMemory(refs);
      else for (const r of refs) { if (await storage.deleteMemory(r.ownerGaii, r.key)) removed++; }
    }

    if (removed > 0) {
      emitChange('organisms');
      void updateOrganismStructure(storage, config, id, { event: `deleted ${deleted.length} record(s) in ${namespace}`, actor: callerGhii }).catch(err => { logger.warn('roleOk: timeline best-effort', { error: String(err) }); });
    }
    res.json(success(config.nodeId, { deleted, failed, rows_removed: removed }));
  });

  /* ── Archive / Unarchive ──────────────────────────────────────────────────────────────────────
   * Flag an organism, a workspace, a record-table/document-space, or a single record as read-only +
   * archived so it drops out of every AI-facing material (overview, workspace read, search) yet stays
   * findable via archive search and resolvable by key. Cascades down a container with smart restore
   * (see services/archive.ts). Creator/admin only — archiving is a structural, destructive-adjacent op.
   * Body: { level: 'organism'|'workspace'|'space'|'record', ws?, namespace?, key? }. */

  router.post('/v1/organisms/:id/archive', requireAuth(), requireRole('agent'), archiveHandler('archive'));
  router.post('/v1/organisms/:id/unarchive', requireAuth(), requireRole('agent'), archiveHandler('unarchive'));
}
